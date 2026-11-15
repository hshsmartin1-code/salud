"""Validate public/data/foods-*.json against the catalog contract + nutrition sanity checks.

Usage: python -I -X utf8 validate_foods.py      (exit code 1 on any failed assertion)
"""
from __future__ import annotations

import csv
import glob
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pho_common import HERE, IDX, NUTRIENT_CODES, OUT_DIR  # noqa: E402

KINDS = {'generic', 'raw', 'cooked', 'prepared', 'packaged', 'recipe', 'user'}
BASES = {'100g', '100ml'}
MASS_MACROS = ['protein', 'carbs', 'carbsAvail', 'fat', 'satFat', 'monoFat', 'polyFat', 'transFat', 'fiber',
               'sugars', 'addedSugars', 'water']
# id, expected description, expected kcal per 100 g
GOLDEN = [
    ('usda_sr:171477', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 165),
    ('usda_sr:168878', 'Rice, white, long-grain, regular, enriched, cooked', 130),
    ('usda_sr:171287', 'Egg, whole, raw, fresh', 143),
    ('usda_sr:173944', 'Bananas, raw', 89),
    ('usda_sr:171265', 'Milk, whole, 3.25% milkfat, with added vitamin D', 61),
]
SRC_PREFIX = {'sr': 'usda_sr', 'foundation': 'usda_foundation', 'fndds': 'usda_fndds'}


class Report:
    def __init__(self):
        self.failures = []
        self.lines = []

    def check(self, cond, msg):
        if not cond:
            self.failures.append(msg)
        return cond

    def info(self, msg):
        self.lines.append(msg)
        print(msg)


def atwater_ok(row):
    n = row[8]
    k, p, c, f = n[IDX['kcal']], n[IDX['protein']], n[IDX['carbs']], n[IDX['fat']]
    if None in (k, p, c, f):
        return None
    est = 4 * p + 4 * c + 9 * f
    return abs(k - est) <= 0.25 * max(k, est) if max(k, est) > 0 else True


def validate(out_dir: str = OUT_DIR) -> dict:
    rep = Report()
    summary = {'files': {}}
    all_ids = set()
    by_id = {}
    for path in sorted(glob.glob(os.path.join(out_dir, 'foods-*.json'))):
        name = os.path.basename(path)
        with open(path, encoding='utf-8') as f:
            doc = json.load(f)
        fs = {'rows': 0}
        rep.check(doc.get('format') == 'pho-catalog-foods', f'{name}: bad format')
        rep.check(doc.get('version') == 1, f'{name}: bad version')
        for k in ('source', 'datasetVersion', 'generatedAt', 'license', 'attribution', 'counts', 'foods'):
            rep.check(k in doc, f'{name}: missing {k}')
        rep.check(doc.get('nutrientOrder') == NUTRIENT_CODES, f'{name}: nutrientOrder != contract NUTRIENTS order')
        order = doc.get('nutrientOrder') or []
        foods = doc.get('foods') or []
        fs['rows'] = len(foods)
        rep.check(sum(doc.get('counts', {}).values()) == len(foods), f'{name}: counts do not sum to len(foods)')
        dup = 0
        bad_len = bad_row = macro_bad = neg = nan = 0
        at_total = at_ok = 0
        barcodes = set()
        dup_bar = 0
        for r in foods:
            if not (isinstance(r, list) and len(r) == 12):
                bad_row += 1
                continue
            rid = r[0]
            if rid in all_ids:
                dup += 1
            all_ids.add(rid)
            by_id[rid] = r
            if not (isinstance(r[1], str) and r[1] and r[6] in KINDS and r[7] in BASES):
                bad_row += 1
            if r[11] is not None and not re.fullmatch(r'[a-z0-9_]+(;[a-z0-9_]+)*', r[11]):
                bad_row += 1
            if r[10] is not None and not re.fullmatch(r'[a-z0-9]+( [a-z0-9]+)*', r[10]):
                bad_row += 1
            if r[9] is not None and not all(isinstance(p, list) and len(p) == 2 and isinstance(p[0], str)
                                            and isinstance(p[1], (int, float)) and p[1] > 0 for p in r[9]):
                bad_row += 1
            if r[4] is not None:
                if r[4] in barcodes:
                    dup_bar += 1
                barcodes.add(r[4])
            nut = r[8]
            if len(nut) != len(order):
                bad_len += 1
                continue
            for v in nut:
                if v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(v)):
                    nan += 1
                elif v is not None and v < 0:
                    neg += 1
            if any(nut[IDX[m]] is not None and nut[IDX[m]] > 105 for m in MASS_MACROS if m != 'water'):
                macro_bad += 1
            a = atwater_ok(r)
            if a is not None:
                at_total += 1
                at_ok += bool(a)
        pct = 100.0 * at_ok / at_total if at_total else 100.0
        fs.update({'duplicate_ids': dup, 'bad_rows': bad_row, 'bad_nutrient_len': bad_len, 'macro_gt_105': macro_bad,
                   'negative_values': neg, 'non_numeric': nan, 'atwater_rows': at_total,
                   'atwater_within_25pct': round(pct, 2), 'duplicate_barcodes': dup_bar})
        rep.check(dup == 0, f'{name}: {dup} duplicate ids')
        rep.check(bad_row == 0, f'{name}: {bad_row} malformed rows')
        rep.check(bad_len == 0, f'{name}: {bad_len} nutrient arrays with wrong length')
        rep.check(macro_bad == 0, f'{name}: {macro_bad} rows with a macro > 105 g/100')
        rep.check(neg == 0 and nan == 0, f'{name}: {neg} negative / {nan} non-numeric nutrient values')
        rep.check(dup_bar == 0, f'{name}: {dup_bar} duplicate barcodes')
        rep.check(pct >= 95.0, f'{name}: Atwater agreement {pct:.2f}% < 95%')
        rep.info(f'{name}: {len(foods)} rows; ids unique={dup == 0}; nutrient arrays ok={bad_len == 0}; '
                 f'macros>105: {macro_bad}; Atwater within 25%: {at_ok}/{at_total} = {pct:.2f}%')
        summary['files'][name] = fs

    # golden values
    golden = []
    for gid, gdesc, gk in GOLDEN:
        r = by_id.get(gid)
        if not rep.check(r is not None, f'golden {gid} missing'):
            continue
        rep.check(r[1] == gdesc, f'golden {gid}: description "{r[1]}" != "{gdesc}"')
        k = r[8][IDX['kcal']]
        ok = k is not None and abs(k - gk) <= 0.03 * gk
        rep.check(ok, f'golden {gid} ({gdesc}): kcal {k} not within ±3% of {gk}')
        golden.append({'id': gid, 'description': r[1], 'expected_kcal': gk, 'actual_kcal': k, 'ok': ok})
        rep.info(f'golden {gid} {r[1]!r}: {k} kcal (expected ≈{gk}, ±3%) -> {"OK" if ok else "FAIL"}')
    summary['golden'] = golden

    # curated Spanish rows
    cur_path = os.path.join(HERE, 'es_curated.csv')
    n_cur = n_cur_ok = 0
    if os.path.exists(cur_path):
        with open(cur_path, encoding='utf-8', newline='') as f:
            for row in csv.DictReader(f):
                n_cur += 1
                rid = f"{SRC_PREFIX.get(row['source'], row['source'])}:{row['fdc_id']}"
                r = by_id.get(rid)
                if not rep.check(r is not None, f'curated {rid} ({row["name_es"]}) not found in catalog'):
                    continue
                ok = rep.check(r[1] == row['fdc_description'],
                               f'curated {rid}: catalog description "{r[1]}" != "{row["fdc_description"]}"')
                ok &= rep.check(r[2] == row['name_es'], f'curated {rid}: nameEs not applied')
                ok &= rep.check('curated_es' in (r[11] or ''), f'curated {rid}: missing curated_es flag')
                n_cur_ok += bool(ok)
    summary['curated'] = {'rows': n_cur, 'verified': n_cur_ok}
    rep.info(f'curated Spanish rows: {n_cur_ok}/{n_cur} verified (id exists, description matches, nameEs + flag)')

    summary['failures'] = rep.failures
    if rep.failures:
        print(f'VALIDATION FAILED ({len(rep.failures)}):')
        for m in rep.failures[:50]:
            print('  - ' + m)
    else:
        print('VALIDATION PASSED')
    return summary


if __name__ == '__main__':
    s = validate()
    sys.exit(1 if s['failures'] else 0)
