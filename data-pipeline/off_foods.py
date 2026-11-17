"""Open Food Facts - Colombia product snapshot -> public/data/foods-off-co.json

Usage:
  python -I -X utf8 off_foods.py fetch      # download/resume pages into raw/off/page_N.json
  python -I -X utf8 off_foods.py build      # build foods-off-co.json from cached pages
  python -I -X utf8 off_foods.py            # fetch + build

Downloaded pages are untrusted data: parsed as JSON only.
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pho_common import (HTTP_HEADERS, IDX, NUTRIENT_CODES, OUT_DIR, RAW_DIR, dedupe, norm_tokens,  # noqa: E402
                        round_grams, round_nutrient, write_catalog)

OFF_RAW = os.path.join(RAW_DIR, 'off')
FIELDS = ('code,product_name,product_name_es,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments,'
          'categories_tags,nutrition_data_per,product_quantity,product_quantity_unit')
SEARCH_URL = ('https://world.openfoodfacts.org/api/v2/search?countries_tags_en=colombia&page_size=100'
              '&page={page}&fields=' + FIELDS)
MAX_PAGES = 150
SLEEP_S = 6.6

LICENSE = 'ODbL-1.0'
ATTRIBUTION = ('Datos de Open Food Facts (openfoodfacts.org) bajo Open Database License (ODbL) 1.0; '
               'contenidos individuales bajo Database Contents License 1.0. Imágenes no incluidas. '
               'Instantánea de productos de Colombia.')
OUT_PATH = os.path.join(OUT_DIR, 'foods-off-co.json')


class AnonymousLimit(Exception):
    pass


def page_path(n: int, prefix: str = 'page') -> str:
    return os.path.join(OFF_RAW, f'{prefix}_{n}.json')


_last_request = [0.0]


def _get_json(session, url, params, label):
    import requests

    for attempt in range(5):
        wait = SLEEP_S - (time.monotonic() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.monotonic()
        try:
            r = session.get(url, params=params, timeout=120)
        except requests.RequestException as e:
            print(f'  {label}: network error {e!r}; retry {attempt + 1}', flush=True)
            time.sleep(min(120, 10 * 2 ** attempt))
            continue
        if r.status_code in (401, 403):
            raise AnonymousLimit(f'{label}: HTTP {r.status_code}')
        if r.status_code == 429 or r.status_code >= 500:
            backoff = min(120, 15 * 2 ** attempt)
            print(f'  {label}: HTTP {r.status_code}; backoff {backoff}s', flush=True)
            time.sleep(backoff)
            continue
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            print(f'  {label}: non-JSON response; retry', flush=True)
            time.sleep(min(300, 15 * 2 ** attempt))
    raise RuntimeError(f'{label} failed after retries; rerun to resume')


def _save(p, data):
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, p)


def fetch(max_pages: int = MAX_PAGES, force: bool = False) -> dict:
    import requests  # local import: build step must not need network libs

    os.makedirs(OFF_RAW, exist_ok=True)
    stats_path = os.path.join(OFF_RAW, 'fetch_stats.json')
    if not force and os.path.exists(stats_path):
        with open(stats_path, encoding='utf-8') as f:
            prev = json.load(f)
        blocked = prev.get('v2_blocked_at_page')
        if blocked and not os.path.exists(page_path(blocked)):
            print(f'  OFF: previous run hit the anonymous limit at page {blocked}; using {blocked - 1} cached pages '
                  f'(pass force=True / --off-refetch to retry)', flush=True)
            prev['note'] = 'reused cached pages; network not contacted'
            return prev
    session = requests.Session()
    session.headers.update(HTTP_HEADERS)
    # OFF answers HTTP 401 ("not available to anonymous users") beyond page 10 of the v2 search
    # (observed 2026-11-14). We respect that limit: the snapshot stops there (no account, no workaround).
    stats = {'v2_fetched': 0, 'v2_cached': 0, 'v2_count': None, 'v2_blocked_at_page': None}
    for page in range(1, max_pages + 1):
        p = page_path(page)
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                data = json.load(f)
            stats['v2_cached'] += 1
        else:
            try:
                data = _get_json(session, SEARCH_URL.format(page=page), None, f'v2 page {page}')
            except AnonymousLimit as e:
                print(f'  {e} -> OFF anonymous pagination limit reached; snapshot stops here', flush=True)
                stats['v2_blocked_at_page'] = page
                break
            except RuntimeError as e:  # persistent 5xx: keep what is cached, rerun later to resume
                print(f'  {e}; stopping fetch, building from cached pages', flush=True)
                stats['v2_failed_at_page'] = page
                break
            _save(p, data)
            stats['v2_fetched'] += 1
        stats['v2_count'] = data.get('count', stats['v2_count'])
        n = len(data.get('products') or [])
        if page % 10 == 0 or n == 0:
            print(f'  v2 page {page}: {n} products (count={stats["v2_count"]})', flush=True)
        if n == 0:
            break
    with open(stats_path, 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=1)
    return stats


# ---------------------------------------------------------------- build helpers
def num(v):
    """Parse an OFF numeric value (number or numeric string). None if not parseable/finite."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    else:
        s = str(v).strip().replace(',', '.')
        if not re.fullmatch(r'-?\d+(\.\d+)?', s):
            return None
        f = float(s)
    if f != f or f in (float('inf'), float('-inf')):
        return None
    return f


_LIQUID_UNITS = {'ml', 'l', 'cl', 'dl', 'mL', 'L'}
_QTY_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grs|gramos|mg|ml|cl|dl|l|lt|lts|litro|litros|cc|oz|fl\s*oz)\b',
                     re.IGNORECASE)


def is_liquid(prod: dict) -> bool:
    u = str(prod.get('product_quantity_unit') or '').strip().lower()
    if u:
        return u in {'ml', 'l', 'cl', 'dl'}
    q = str(prod.get('quantity') or '')
    m = _QTY_RE.search(q)
    if m:
        unit = re.sub(r'\s+', ' ', m.group(2).lower())
        return unit in {'ml', 'cl', 'dl', 'l', 'lt', 'lts', 'litro', 'litros', 'cc', 'fl oz'}
    return False


def product_quantity(prod: dict):
    """(normalized amount, explicit g/ml), or None; never infer a density."""
    pq = num(prod.get('product_quantity'))
    unit = normalized_unit(prod.get('product_quantity_unit'))
    raw = text_measure(prod.get('quantity'))
    if pq is not None and pq <= 0:
        return None
    if prod.get('product_quantity_unit') is not None and (unit is None or (raw and raw[1] != unit)):
        return None
    if pq is not None and unit:
        normalized = pq, unit
        return None if raw and not measures_agree(raw, normalized) else normalized
    if pq is not None:
        return raw if raw and abs(raw[0] - pq) <= 0.02 else None
    return raw


def normalized_unit(value):
    unit = str(value or '').strip().lower()
    return unit if unit in {'g', 'ml'} else None


def text_measure(value):
    text = str(value or '')
    if re.search(r'\d\s*[x×]\s*\d', text, re.IGNORECASE):
        return None
    matches = list(_QTY_RE.finditer(text))
    if len(matches) != 1:
        return None
    m = matches[0]
    u = re.sub(r'\s+', ' ', m.group(2).lower())
    factors = {'kg': 1000, 'mg': 0.001, 'g': 1, 'gr': 1, 'grs': 1, 'gramos': 1,
               'ml': 1, 'cl': 10, 'dl': 100, 'l': 1000, 'lt': 1000,
               'lts': 1000, 'litro': 1000, 'litros': 1000, 'cc': 1}
    if u not in factors:
        return None
    amount = float(m.group(1).replace(',', '.')) * factors[u]
    unit = 'g' if u in {'kg', 'mg', 'g', 'gr', 'grs', 'gramos'} else 'ml'
    return (amount, unit) if amount > 0 and amount != float('inf') else None


def measures_agree(a, b):
    return a[1] == b[1] and abs(a[0] - b[0]) <= 0.02


def serving_quantity(prod: dict):
    if re.search(r'\d\s*[x×]\s*\d', str(prod.get('serving_size') or ''), re.IGNORECASE):
        return None
    sq = num(prod.get('serving_quantity'))
    unit = normalized_unit(prod.get('serving_quantity_unit'))
    raw = text_measure(prod.get('serving_size'))
    if sq is not None and sq <= 0:
        return None
    if prod.get('serving_quantity_unit') is not None and (unit is None or (raw and raw[1] != unit)):
        return None
    if sq is not None and unit:
        normalized = sq, unit
        return None if raw and not measures_agree(raw, normalized) else normalized
    if not raw:
        return None
    return raw if sq is None or abs(sq - raw[0]) <= 0.02 else None


def clean_category(tags):
    if not tags:
        return None
    for t in tags:
        if not isinstance(t, str):
            continue
        s = re.sub(r'^[a-z]{2}:', '', t).replace('-', ' ').strip()
        if s:
            return s[:1].upper() + s[1:]
    return None


# (OFF nutriment key, contract code, multiplier from OFF *_100g stored unit)
# OFF stores *_100g in grams for all mass nutrients (minerals/vitamins included),
# energy-kcal in kcal and energy-kj in kJ. Verified on cached products (see verify_units()).
NUTRIENT_MAP = [
    ('proteins', 'protein', 1),
    ('carbohydrates', 'carbs', 1),
    ('fat', 'fat', 1),
    ('saturated-fat', 'satFat', 1),
    ('monounsaturated-fat', 'monoFat', 1),
    ('polyunsaturated-fat', 'polyFat', 1),
    ('trans-fat', 'transFat', 1),
    ('fiber', 'fiber', 1),
    ('sugars', 'sugars', 1),
    ('added-sugars', 'addedSugars', 1),
    ('cholesterol', 'cholesterol', 1000),
    ('potassium', 'potassium', 1000),
    ('calcium', 'calcium', 1000),
    ('iron', 'iron', 1000),
    ('magnesium', 'magnesium', 1000),
    ('phosphorus', 'phosphorus', 1000),
    ('zinc', 'zinc', 1000),
    ('vitamin-a', 'vitA', 1e6),
    ('vitamin-d', 'vitD', 1e6),
    ('vitamin-b12', 'vitB12', 1e6),
    ('vitamin-c', 'vitC', 1000),
    ('vitamin-e', 'vitE', 1000),
]


def build_row(prod: dict, drops: dict):
    code = str(prod.get('code') or '').strip()
    if not re.fullmatch(r'\d{6,14}', code):
        drops['bad_barcode'] = drops.get('bad_barcode', 0) + 1
        return None
    name = (prod.get('product_name_es') or '').strip() or (prod.get('product_name') or '').strip()
    if not name or not re.search(r'[A-Za-zÀ-ÿ]', name):  # empty or digits-only (e.g. a barcode as name)
        drops['no_name'] = drops.get('no_name', 0) + 1
        return None
    nm = prod.get('nutriments') or {}
    if not isinstance(nm, dict):
        nm = {}
    flags = []
    nut = [None] * len(NUTRIENT_CODES)

    kcal = num(nm.get('energy-kcal_100g'))
    kj = num(nm.get('energy-kj_100g'))
    if kcal is None and kj is not None:
        kcal = kj / 4.184
        flags.append('kcal_from_kj')
    if kcal is None:
        drops['no_energy'] = drops.get('no_energy', 0) + 1
        return None
    # kJ that contradicts kcal (e.g. kJ = 0 with kcal > 0) is a data-entry error: keep kcal, null kJ.
    if kj is not None and 'kcal_from_kj' not in flags and abs(kj / 4.184 - kcal) > 0.15 * max(kj / 4.184, kcal, 1):
        kj = None
        flags.append('kj_inconsistent_nulled')
    nut[IDX['kcal']] = kcal
    nut[IDX['kj']] = kj

    for key, code_, mult in NUTRIENT_MAP:
        v = num(nm.get(f'{key}_100g'))
        if v is not None:
            nut[IDX[code_]] = v * mult
    # folate: OFF uses vitamin-b9 (and sometimes folates)
    fol = num(nm.get('vitamin-b9_100g'))
    if fol is None:
        fol = num(nm.get('folates_100g'))
    if fol is not None:
        nut[IDX['folate']] = fol * 1e6
    sod = num(nm.get('sodium_100g'))
    salt = num(nm.get('salt_100g'))
    if sod is not None:
        nut[IDX['sodium']] = sod * 1000
    elif salt is not None:
        nut[IDX['sodium']] = salt / 2.5 * 1000
        flags.append('sodium_from_salt')

    # sanity
    if any(v is not None and v < 0 for v in nut):
        drops['negative_value'] = drops.get('negative_value', 0) + 1
        return None
    p, c, f = nut[IDX['protein']], nut[IDX['carbs']], nut[IDX['fat']]
    if sum(x for x in (p, c, f) if x is not None) > 105:
        drops['macros_gt_105'] = drops.get('macros_gt_105', 0) + 1
        return None
    if any(nut[IDX[k]] is not None and nut[IDX[k]] > 105 for k in
           ('protein', 'carbs', 'fat', 'satFat', 'monoFat', 'polyFat', 'transFat', 'fiber', 'sugars', 'addedSugars')):
        drops['macros_gt_105'] = drops.get('macros_gt_105', 0) + 1
        return None
    if kcal > 950:
        drops['kcal_gt_950'] = drops.get('kcal_gt_950', 0) + 1
        return None
    if p is not None and c is not None and f is not None:
        est = 4 * p + 4 * c + 9 * f
        if est > 0 or kcal > 0:
            if abs(kcal - est) > 0.25 * max(est, kcal):
                flags.append('atwater_mismatch')

    nut = [round_nutrient(c_, v) for c_, v in zip(NUTRIENT_CODES, nut)]
    basis = '100ml' if is_liquid(prod) else '100g'

    portions = []
    serving = serving_quantity(prod)
    expected_unit = 'ml' if basis == '100ml' else 'g'
    pq = product_quantity(prod)
    if (serving is not None and serving[1] == expected_unit and round_grams(serving[0]) > 0
            and not (pq is not None and pq[1] == expected_unit and serving[0] > pq[0] + 0.02)):
        ss = str(prod.get('serving_size') or '').strip()
        label = f'1 porción ({ss})' if ss else '1 porción'
        portions.append([label[:80], round_grams(serving[0])])
    if pq is not None and pq[1] == expected_unit and round_grams(pq[0]) > 0:
        portions.append(['Envase completo', round_grams(pq[0])])
    if portions:
        flags.append('portion_units_checked')

    brands = prod.get('brands') or ''
    if isinstance(brands, list):
        brands = ','.join(str(b) for b in brands)
    brand = next((b.strip() for b in str(brands).split(',') if b.strip()), None)
    category = clean_category(prod.get('categories_tags'))
    syn = dedupe(norm_tokens(name) + (norm_tokens(brand) if brand else []))
    return [
        f'off:{code}', name, name, brand, code, category, 'packaged', basis, nut,
        portions or None, ' '.join(syn) or None, ';'.join(flags) or None,
    ]


def _page_files(prefix):
    files = glob.glob(os.path.join(OFF_RAW, f'{prefix}_*.json'))
    return sorted(files, key=lambda p: int(re.search(r'_(\d+)\.json$', p).group(1)))


def load_pages():
    for fp in _page_files('page'):
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        for prod in data.get('products') or []:
            if isinstance(prod, dict):
                yield prod


def verify_units(sample=8):
    """Print a few products' raw nutriments vs value/unit fields to check the *_100g unit convention."""
    shown = 0
    for prod in load_pages():
        nm = prod.get('nutriments') or {}
        for key in ('sodium', 'calcium', 'iron', 'vitamin-c', 'vitamin-a'):
            if f'{key}_100g' in nm and f'{key}_unit' in nm and nm.get('nutrition_data_per', '100g'):
                print(f"  {prod.get('code')} {key}: _100g={nm.get(f'{key}_100g')} value={nm.get(f'{key}_value')} "
                      f"unit={nm.get(f'{key}_unit')} per={prod.get('nutrition_data_per')}")
                shown += 1
        if shown >= sample:
            break


def build() -> dict:
    drops: dict = {}
    rows = []
    seen = set()
    total = 0
    for prod in load_pages():
        total += 1
        row = build_row(prod, drops)
        if row is None:
            continue
        if row[4] in seen:
            drops['duplicate_barcode'] = drops.get('duplicate_barcode', 0) + 1
            continue
        seen.add(row[4])
        rows.append(row)
    rows.sort(key=lambda r: r[0])
    v2_pages = len(_page_files('page'))
    snap_date = None
    p1 = page_path(1)
    if os.path.exists(p1):
        snap_date = time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(p1)))
    dv = (f'Open Food Facts Colombia snapshot {snap_date}: API v2 search countries_tags_en=colombia '
          f'({v2_pages} pages)')
    size = write_catalog(OUT_PATH, source='off', dataset_version=dv, license_=LICENSE, attribution=ATTRIBUTION,
                         counts={'off': len(rows)}, foods=rows)
    stats = {
        'input_products': total, 'kept': len(rows), 'drops': drops, 'bytes': size, 'datasetVersion': dv,
        'liquids_100ml': sum(1 for r in rows if r[7] == '100ml'),
        'flag_counts': {},
    }
    for r in rows:
        for fl in (r[11] or '').split(';'):
            if fl:
                stats['flag_counts'][fl] = stats['flag_counts'].get(fl, 0) + 1
    print(f'OFF: {total} products in snapshot -> {len(rows)} kept; drops={drops}; {size / 1e6:.2f} MB')
    return stats


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if cmd in ('fetch', 'all'):
        print('OFF fetch:', fetch(), flush=True)
    if cmd == 'verify':
        verify_units()
    if cmd in ('build', 'all'):
        st = build()
        with open(os.path.join(OFF_RAW, 'build_stats.json'), 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
