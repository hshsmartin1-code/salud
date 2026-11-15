"""USDA FoodData Central (Foundation + SR Legacy + FNDDS) -> public/data/foods-usda.json

Usage:
  python -I -X utf8 usda_foods.py download   # fetch bulk zips into raw/usda/ (skips existing)
  python -I -X utf8 usda_foods.py build      # build foods-usda.json
  python -I -X utf8 usda_foods.py            # download + build

Bulk files are untrusted data: parsed as CSV/JSON only.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pho_common import (HERE, HTTP_HEADERS, IDX, NUTRIENT_CODES, OUT_DIR, RAW_DIR, dedupe, norm_tokens,  # noqa: E402
                        round_grams, round_nutrient, write_catalog)
from usda_es import category_es, translate_portion  # noqa: E402

USDA_RAW = os.path.join(RAW_DIR, 'usda')
BASE_URL = 'https://fdc.nal.usda.gov/fdc-datasets/'
FILES = {
    # Foundation CSV 2026-10-29 lacks food.csv/food_nutrient.csv/food_portion.csv -> use the JSON release.
    'foundation': 'FoodData_Central_foundation_food_json_2026-10-29.zip',
    'sr': 'FoodData_Central_sr_legacy_food_csv_2018-04.zip',
    'fndds': 'FoodData_Central_survey_food_csv_2024-10-31.zip',
}
DATASET_VERSION = ('Foundation Foods 2026-10-29 (JSON); SR Legacy 2018-04 (CSV); '
                   'FNDDS 2021-2023 / Survey Foods 2024-10-31 (CSV)')
LICENSE = 'CC0-1.0'
ATTRIBUTION = 'USDA ARS, FoodData Central, 2026. fdc.nal.usda.gov (CC0 1.0)'
OUT_PATH = os.path.join(OUT_DIR, 'foods-usda.json')
CURATED_CSV = os.path.join(HERE, 'es_curated.csv')
TERMS_CSV = os.path.join(HERE, 'es_terms.csv')
MAX_PORTIONS = 6
ES_STOPWORDS = {'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'a', 'al', 'un', 'una', 'para', 'tipo'}

# contract code -> [(FDC nutrient id, flag when used as fallback or None), ...]
NUTRIENT_SOURCES = {
    'kcal': [(1008, None), (2048, 'kcal_atwater_specific'), (2047, 'kcal_atwater_general')],
    'kj': [(1062, None)],
    'protein': [(1003, None)],
    'carbs': [(1005, None), (1050, 'carbs_by_summation')],
    'carbsAvail': [],  # intentionally not computed
    'fat': [(1004, None), (1085, 'fat_nlea')],
    'satFat': [(1258, None)],
    'monoFat': [(1292, None)],
    'polyFat': [(1293, None)],
    'transFat': [(1257, None)],
    'fiber': [(1079, None)],
    'sugars': [(2000, None), (1063, None)],
    'addedSugars': [(1235, None)],
    'sodium': [(1093, None)],
    'cholesterol': [(1253, None)],
    'potassium': [(1092, None)],
    'calcium': [(1087, None)],
    'iron': [(1089, None)],
    'magnesium': [(1090, None)],
    'phosphorus': [(1091, None)],
    'zinc': [(1095, None)],
    'vitA': [(1106, None)],
    'vitC': [(1162, None)],
    'vitD': [(1114, None)],
    'vitE': [(1109, None)],
    'vitB12': [(1178, None)],
    'folate': [(1177, None), (1190, 'folate_dfe')],
    'water': [(1051, None)],
}
# Expected (name regex, unit) per FDC nutrient id, checked against every dataset's nutrient table.
EXPECTED = {
    1008: (r'^Energy$', 'kcal'), 2048: (r'Atwater Specific', 'kcal'), 2047: (r'Atwater General', 'kcal'),
    1062: (r'^Energy$', 'kj'), 1003: (r'^Protein$', 'g'), 1005: (r'Carbohydrate, by difference', 'g'),
    1050: (r'Carbohydrate, by summation', 'g'), 1004: (r'Total lipid \(fat\)', 'g'),
    1085: (r'Total fat \(NLEA\)', 'g'), 1258: (r'total saturated', 'g'), 1292: (r'total monounsaturated', 'g'),
    1293: (r'total polyunsaturated', 'g'), 1257: (r'total trans$', 'g'), 1079: (r'Fiber, total dietary', 'g'),
    2000: (r'(Total Sugars|Sugars, Total)$', 'g'), 1063: (r'Sugars, Total', 'g'), 1235: (r'Sugars, added', 'g'),
    1093: (r'Sodium', 'mg'), 1253: (r'Cholesterol', 'mg'), 1092: (r'Potassium', 'mg'), 1087: (r'Calcium', 'mg'),
    1089: (r'Iron', 'mg'), 1090: (r'Magnesium', 'mg'), 1091: (r'Phosphorus', 'mg'), 1095: (r'Zinc', 'mg'),
    1106: (r'Vitamin A, RAE', 'ug'), 1162: (r'Vitamin C', 'mg'), 1114: (r'Vitamin D \(D2 \+ D3\)$', 'ug'),
    1109: (r'Vitamin E \(alpha-tocopherol\)', 'mg'), 1178: (r'^Vitamin B-12$', 'ug'),
    1177: (r'^Folate, total$', 'ug'), 1190: (r'^Folate, DFE$', 'ug'), 1051: (r'^Water$', 'g'),
}

_RAW_RE = re.compile(r'\braw\b', re.I)
_COOKED_RE = re.compile(r'\b(cooked|boiled|roasted|fried|baked|grilled|broiled|steamed|stewed|braised|microwaved|'
                        r'sauteed|toasted|poached|scrambled|simmered)\b', re.I)


def classify_kind(source: str, desc: str) -> str:
    if source == 'fndds':
        return 'prepared'
    if _RAW_RE.search(desc):
        return 'raw'
    if _COOKED_RE.search(desc):
        return 'cooked'
    return 'generic'


# ---------------------------------------------------------------- download
def download():
    import requests

    os.makedirs(USDA_RAW, exist_ok=True)
    for name in FILES.values():
        p = os.path.join(USDA_RAW, name)
        if os.path.exists(p) and os.path.getsize(p) > 0:
            print(f'  cached {name} ({os.path.getsize(p)} B)')
            continue
        print(f'  downloading {name}')
        with requests.get(BASE_URL + name, headers=HTTP_HEADERS, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(p + '.part', 'wb') as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        os.replace(p + '.part', p)


# ---------------------------------------------------------------- readers
def _zip_csv(z: zipfile.ZipFile, name: str):
    member = next((n for n in z.namelist() if n.endswith('/' + name) or n == name), None)
    if member is None:
        raise FileNotFoundError(name)
    with z.open(member) as fb:
        yield from csv.DictReader(io.TextIOWrapper(fb, encoding='utf-8', newline=''))


def _check_nutrient_table(label: str, table: dict, verify_log: list):
    """table: id -> (name, unit). Assert each mapped id has the expected name/unit."""
    for nid, (rx, unit) in EXPECTED.items():
        if nid not in table:
            verify_log.append(f'{label}: nutrient {nid} absent from nutrient table')
            continue
        name, u = table[nid]
        u = u.lower().replace('µg', 'ug')
        if not re.search(rx, name) or u != unit:
            raise AssertionError(f'{label}: nutrient {nid} is "{name}" [{u}], expected /{rx}/ [{unit}]')
    verify_log.append(f'{label}: all {len(EXPECTED)} mapped nutrient ids verified (name + unit)')


def load_csv_dataset(source: str, path: str, verify_log: list):
    z = zipfile.ZipFile(path)
    nut_table = {}
    nbr_to_id = {}
    for r in _zip_csv(z, 'nutrient.csv'):
        nid = int(r['id'])
        nut_table[nid] = (r['name'], r['unit_name'])
        nbr = (r.get('nutrient_nbr') or '').strip()
        if nbr:
            key = nbr[:-2] if nbr.endswith('.0') else nbr
            nbr_to_id.setdefault(key, nid)
    _check_nutrient_table(source, nut_table, verify_log)

    if source == 'sr':
        cats = {r['id']: r['description'] for r in _zip_csv(z, 'food_category.csv')}
    else:
        cats = {r['wweia_food_category']: r['wweia_food_category_description']
                for r in _zip_csv(z, 'wweia_food_category.csv')}
    foods = {}
    for r in _zip_csv(z, 'food.csv'):
        foods[r['fdc_id']] = {'fdc_id': r['fdc_id'], 'desc': r['description'].strip(),
                              'category': cats.get(r['food_category_id']), 'nut': {}, 'portions': []}
    wanted = {nid for srcs in NUTRIENT_SOURCES.values() for nid, _ in srcs}
    # FNDDS 2024-10-31 food_nutrient.csv stores the nutrient NUMBER (e.g. 208) in nutrient_id; SR stores the id.
    raw_rows = list(_zip_csv(z, 'food_nutrient.csv'))
    vals = Counter(r['nutrient_id'] for r in raw_rows)
    in_ids = sum(c for v, c in vals.items() if v.isdigit() and int(v) in nut_table)
    use_nbr = in_ids < 0.5 * sum(vals.values())
    verify_log.append(f'{source}: food_nutrient.nutrient_id interpreted as '
                      f'{"nutrient_nbr (mapped via nutrient.csv)" if use_nbr else "nutrient id"}')
    for r in raw_rows:
        f = foods.get(r['fdc_id'])
        if f is None:
            continue
        v = r['nutrient_id']
        nid = nbr_to_id.get(v) if use_nbr else int(v)
        if nid not in wanted:
            continue
        amt = (r.get('amount') or '').strip()
        if amt == '':
            continue
        f['nut'][nid] = float(amt)
    mu = {r['id']: r['name'] for r in _zip_csv(z, 'measure_unit.csv')}
    for r in _zip_csv(z, 'food_portion.csv'):
        f = foods.get(r['fdc_id'])
        if f is None:
            continue
        try:
            g = float(r['gram_weight'] or 0)
        except ValueError:
            continue
        seq = int(r['seq_num']) if (r.get('seq_num') or '').isdigit() else 999
        if source == 'fndds':
            text, amount = r['portion_description'], None
        else:
            unit = mu.get(r['measure_unit_id'], '')
            text = r['modifier'] if unit in ('undetermined', '') else f"{unit} {r['modifier']}".strip()
            if not text:
                text = r['portion_description']
            try:
                amount = float(r['amount']) if r['amount'] else None
            except ValueError:
                amount = None
        f['portions'].append((seq, amount, text, g))
    return list(foods.values())


def load_foundation(path: str, verify_log: list):
    z = zipfile.ZipFile(path)
    member = next(n for n in z.namelist() if n.endswith('.json'))
    data = json.loads(z.read(member))
    foods = []
    table = {}
    for item in data['FoundationFoods']:
        nut = {}
        for fn in item.get('foodNutrients') or []:
            n = fn.get('nutrient') or {}
            nid = n.get('id')
            if nid is None:
                continue
            table.setdefault(nid, (n.get('name', ''), n.get('unitName', '')))
            if 'amount' in fn and fn['amount'] is not None:
                nut[nid] = float(fn['amount'])
        portions = []
        for p in item.get('foodPortions') or []:
            unit = ((p.get('measureUnit') or {}).get('name') or '').strip()
            mod = (p.get('modifier') or '').strip()
            if unit.lower() == 'undetermined':
                unit = ''
            text = f'{unit} {mod}'.strip() if unit != 'RACC' else 'RACC'
            amount = p.get('value', p.get('amount'))
            portions.append((p.get('sequenceNumber') or 999, amount, text, float(p.get('gramWeight') or 0)))
        foods.append({'fdc_id': str(item['fdcId']), 'desc': item['description'].strip(),
                      'category': (item.get('foodCategory') or {}).get('description'), 'nut': nut,
                      'portions': portions})
    # nutrient ids that never occur in Foundation can't be checked there (e.g. 1190, 1235): log only.
    present = {k: v for k, v in table.items() if k in EXPECTED}
    for nid, (rx, unit) in EXPECTED.items():
        if nid in present:
            name, u = present[nid]
            u = u.lower().replace('µg', 'ug')
            if not re.search(rx, name) or u != unit:
                raise AssertionError(f'foundation: nutrient {nid} is "{name}" [{u}], expected /{rx}/ [{unit}]')
    verify_log.append(f'foundation: {len(present)}/{len(EXPECTED)} mapped nutrient ids present and verified')
    return foods


# ---------------------------------------------------------------- spanish layer
def load_terms(path=TERMS_CSV):
    terms = {}
    with open(path, encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            en = ' '.join(norm_tokens(r['en_term']))
            es = norm_tokens(r['es_terms'])
            if en and es:
                terms[en] = es
    return terms


def load_curated(path=CURATED_CSV):
    cur = {}
    if not os.path.exists(path):
        return cur
    with open(path, encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            key = (r['source'].strip(), r['fdc_id'].strip())
            cur[key] = {'name_es': r['name_es'].strip(), 'synonyms': norm_tokens(r.get('synonyms') or ''),
                        'fdc_description': (r.get('fdc_description') or '').strip()}
    return cur


def translate_tokens(desc: str, terms: dict, max_n: int = 3) -> list[str]:
    toks = norm_tokens(desc)
    out = []
    i = 0
    while i < len(toks):
        for n in range(max_n, 0, -1):
            if i + n <= len(toks):
                ph = ' '.join(toks[i:i + n])
                if ph in terms:
                    out.extend(terms[ph])
                    i += n
                    break
        else:
            i += 1
    return out


# ---------------------------------------------------------------- build
def build_portions(portions, max_n=MAX_PORTIONS):
    out = []
    seen = set()
    for seq, amount, text, g in sorted(portions, key=lambda p: (p[0], p[3])):
        if not g or g <= 0:
            continue
        label = translate_portion(amount, text)
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        gr = round_grams(g)
        if gr <= 0:
            continue
        seen.add(key)
        out.append([label, gr])
        if len(out) >= max_n:
            break
    return out or None


def build(fndds_max_portions: int = MAX_PORTIONS) -> dict:
    verify_log = []
    datasets = {
        'foundation': load_foundation(os.path.join(USDA_RAW, FILES['foundation']), verify_log),
        'sr': load_csv_dataset('sr', os.path.join(USDA_RAW, FILES['sr']), verify_log),
        'fndds': load_csv_dataset('fndds', os.path.join(USDA_RAW, FILES['fndds']), verify_log),
    }
    terms = load_terms()
    curated = load_curated()
    used_curated = set()
    prefix = {'foundation': 'usda_foundation', 'sr': 'usda_sr', 'fndds': 'usda_fndds'}
    rows = []
    counts = {}
    drops = defaultdict(Counter)
    flag_counts = Counter()
    kinds = Counter()
    for src, foods in datasets.items():
        n_kept = 0
        for f in foods:
            nut_raw = f['nut']
            vals = [None] * len(NUTRIENT_CODES)
            flags = []
            for code, srcs in NUTRIENT_SOURCES.items():
                for nid, flag in srcs:
                    if nid in nut_raw:
                        vals[IDX[code]] = nut_raw[nid]
                        if flag:
                            flags.append(flag)
                        break
            if all(v is None for v in vals):
                drops[src]['no_nutrients'] += 1
                continue
            # Foundation reports slightly negative "carbohydrate by difference" for some raw meats/fish
            # (analytical artifact, e.g. -0.47 g). Keep the food, set that value to unknown, flag it.
            for i, v in enumerate(vals):
                if v is not None and v < 0:
                    vals[i] = None
                    flags.append(f'{NUTRIENT_CODES[i]}_negative_nulled')
                    drops[src][f'negative_{NUTRIENT_CODES[i]}_nulled (row kept)'] += 1
            vals = [round_nutrient(c, v) for c, v in zip(NUTRIENT_CODES, vals)]
            desc = f['desc']
            cur = curated.get((src, f['fdc_id']))
            name_es = None
            syn = []
            if cur:
                name_es = cur['name_es']
                syn.extend(cur['synonyms'])
                syn.extend(norm_tokens(name_es))
                flags.append('curated_es')
                used_curated.add((src, f['fdc_id']))
            syn.extend(translate_tokens(desc, terms))
            syn = dedupe(t for t in syn if t not in ES_STOPWORDS)
            kind = classify_kind(src, desc)
            kinds[(src, kind)] += 1
            for fl in flags:
                flag_counts[fl] += 1
            portions = build_portions(f['portions'], fndds_max_portions if src == 'fndds' else MAX_PORTIONS)
            rows.append([
                f'{prefix[src]}:{f["fdc_id"]}', desc, name_es, None, None, category_es(f['category']), kind,
                '100g', vals, portions, ' '.join(syn) or None, ';'.join(flags) or None,
            ])
            n_kept += 1
        counts[prefix[src]] = n_kept
    missing_curated = sorted(set(curated) - used_curated)
    rows.sort(key=lambda r: (r[0].split(':')[0], int(r[0].split(':')[1])))
    size = write_catalog(OUT_PATH, source='usda', dataset_version=DATASET_VERSION, license_=LICENSE,
                         attribution=ATTRIBUTION, counts=counts, foods=rows)
    stats = {
        'counts': counts, 'total': len(rows), 'bytes': size,
        'input': {k: len(v) for k, v in datasets.items()},
        'drops': {k: dict(v) for k, v in drops.items()},
        'flags': dict(flag_counts), 'kinds': {f'{a}/{b}': c for (a, b), c in sorted(kinds.items())},
        'curated_rows': len(curated), 'curated_applied': len(used_curated),
        'curated_missing': [f'{a}:{b}' for a, b in missing_curated],
        'terms': len(terms), 'nutrient_verification': verify_log,
        'with_portions': sum(1 for r in rows if r[9]), 'no_kcal': sum(1 for r in rows if r[8][IDX['kcal']] is None),
    }
    print(f'USDA: {counts} -> {len(rows)} rows, {size / 1e6:.2f} MB; curated {len(used_curated)}/{len(curated)}')
    for line in verify_log:
        print('  ' + line)
    if missing_curated:
        print('  WARNING curated ids not found:', stats['curated_missing'])
    return stats


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if cmd in ('download', 'all'):
        download()
    if cmd in ('build', 'all'):
        st = build()
        if st['bytes'] > 9_000_000:
            print('  > 9 MB: rebuilding with max 3 portions for FNDDS')
            st = build(fndds_max_portions=3)
            st['reduced'] = 'fndds_max_portions=3'
        with open(os.path.join(USDA_RAW, 'build_stats.json'), 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
