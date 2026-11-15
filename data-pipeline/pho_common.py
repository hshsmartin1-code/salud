"""Shared helpers for the food catalog pipeline (USDA + Open Food Facts).

Contract: app/src/db/catalogTypes.ts (do not change it from here).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(HERE)
RAW_DIR = os.path.join(HERE, 'raw')
OUT_DIR = os.path.join(APP_DIR, 'public', 'data')

USER_AGENT = 'salud-pwa/1.0 (personal non-commercial nutrition app)'
HTTP_HEADERS = {'User-Agent': USER_AGENT}

# Must match NUTRIENTS in src/db/catalogTypes.ts (same order).
NUTRIENTS = [
    ('kcal', 'kcal'), ('kj', 'kJ'), ('protein', 'g'), ('carbs', 'g'), ('carbsAvail', 'g'),
    ('fat', 'g'), ('satFat', 'g'), ('monoFat', 'g'), ('polyFat', 'g'), ('transFat', 'g'),
    ('fiber', 'g'), ('sugars', 'g'), ('addedSugars', 'g'), ('sodium', 'mg'),
    ('cholesterol', 'mg'), ('potassium', 'mg'), ('calcium', 'mg'), ('iron', 'mg'),
    ('magnesium', 'mg'), ('phosphorus', 'mg'), ('zinc', 'mg'), ('vitA', 'µg'),
    ('vitC', 'mg'), ('vitD', 'µg'), ('vitE', 'mg'), ('vitB12', 'µg'), ('folate', 'µg'),
    ('water', 'g'),
]
NUTRIENT_CODES = [c for c, _ in NUTRIENTS]
NUTRIENT_UNITS = dict(NUTRIENTS)
IDX = {c: i for i, c in enumerate(NUTRIENT_CODES)}

# Row field positions in a CatalogFoodRow.
R_ID, R_NAME, R_NAME_ES, R_BRAND, R_BARCODE, R_CAT, R_KIND, R_BASIS, R_NUT, R_PORT, R_SYN, R_FLAGS = range(12)


def round_nutrient(code: str, v):
    """Round per unit: g -> 2 dp, mg/µg/kcal/kJ -> 1 dp. None stays None."""
    if v is None:
        return None
    unit = NUTRIENT_UNITS[code]
    nd = 2 if unit == 'g' else 1
    r = round(float(v), nd)
    if r == int(r):
        return int(r)
    return r


def round_grams(v: float):
    """1 decimal (2 below 1 g so tiny portions such as a sweetener tablet don't round to 0)."""
    v = float(v)
    r = round(v, 2 if abs(v) < 1 else 1)
    return int(r) if r == int(r) else r


def strip_accents(s: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')


_TOKEN_RE = re.compile(r'[a-z0-9]+')


def norm_tokens(s: str) -> list[str]:
    """Lowercase, accent-free alphanumeric tokens."""
    return _TOKEN_RE.findall(strip_accents(s or '').lower())


def dedupe(seq):
    seen = set()
    out = []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def write_catalog(path: str, *, source: str, dataset_version: str, license_: str, attribution: str,
                  counts: dict, foods: list) -> int:
    doc = {
        'format': 'pho-catalog-foods',
        'version': 1,
        'source': source,
        'datasetVersion': dataset_version,
        'generatedAt': now_iso(),
        'license': license_,
        'attribution': attribution,
        'nutrientOrder': NUTRIENT_CODES,
        'counts': counts,
        'foods': foods,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    os.replace(tmp, path)
    return os.path.getsize(path)
