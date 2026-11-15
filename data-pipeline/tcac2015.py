#!/usr/bin/env python3
"""
Extractor for the ICBF "Tabla de Composicion de Alimentos Colombianos" (TCAC 2015) PDF.

PRIVATE DATA NOTICE
-------------------
ICBF requires authorization to reproduce the TCAC. This script therefore contains NO table
data (no food names, no values, no golden values). It reads the PDF and a golden-check file
from the private data folder (outside the public repo) and writes its output there too:

  default input   ../../private-data/raw/tcac_2015_final_para_imprimir.pdf
  default golden  ../../private-data/tcac_golden.json
  default output  ../../private-data/tcac2015.json   (CatalogFoodFile, see src/db/catalogTypes.ts)
  default report  ../../private-data/TCAC_REPORT.md

All default paths are relative to this script. Never point --out/--report inside the app repo.

How it parses
-------------
Every TCAC table page is a vector table: header cells are a green fill, data rows are
alternating blue/green fills, and column separators are vertical stroke lines in the header.
Cell geometry is rebuilt from those drawings and each word (PyMuPDF `page.get_text('words')`)
is assigned to the cell containing its centre. Tables split across facing pages are joined
row by row (the right-hand page has no id column; its row rectangles must coincide with the
left page's). Sections are recognised by their header labels, not by page numbers.

Usage:  python -I -X utf8 tcac2015.py [--pdf PDF] [--out JSON] [--golden JSON] [--report MD]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import random
import re
import sys
import unicodedata
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

try:
    import pymupdf  # PyMuPDF >= 1.24
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore

SCRIPT_DIR = Path(__file__).resolve().parent
PRIVATE_DIR = (SCRIPT_DIR / '..' / '..' / 'private-data').resolve()
DEFAULT_PDF = PRIVATE_DIR / 'raw' / 'tcac_2015_final_para_imprimir.pdf'
DEFAULT_OUT = PRIVATE_DIR / 'tcac2015.json'
DEFAULT_GOLDEN = PRIVATE_DIR / 'tcac_golden.json'
DEFAULT_REPORT = PRIVATE_DIR / 'TCAC_REPORT.md'
DEFAULT_SOURCE_URL = 'https://www.icbf.gov.co/system/files/tcac_2015_final_para_imprimir.pdf'
CATALOG_TYPES = (SCRIPT_DIR / '..' / 'src' / 'db' / 'catalogTypes.ts').resolve()

SOURCE = 'icbf_tcac2015'
ATTRIBUTION = ('Instituto Colombiano de Bienestar Familiar (ICBF). Tabla de Composición de '
               'Alimentos Colombianos, 2015. Uso personal; no redistribuir.')

# Contract order (src/db/catalogTypes.ts NUTRIENTS). Verified against the .ts file when present.
NUTRIENT_ORDER = [
    'kcal', 'kj', 'protein', 'carbs', 'carbsAvail', 'fat', 'satFat', 'monoFat', 'polyFat',
    'transFat', 'fiber', 'sugars', 'addedSugars', 'sodium', 'cholesterol', 'potassium',
    'calcium', 'iron', 'magnesium', 'phosphorus', 'zinc', 'vitA', 'vitC', 'vitD', 'vitE',
    'vitB12', 'folate', 'water',
]
NIDX = {c: i for i, c in enumerate(NUTRIENT_ORDER)}

# ----------------------------------------------------------------------------------------------
# Generic text helpers
# ----------------------------------------------------------------------------------------------

def strip_accents(s: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')


def norm_label(s: str) -> str:
    s = strip_accents(s or '').lower()
    s = re.sub(r'(\w)- (\w)', r'\1\2', s)  # header hyphenation "de- terminada"
    return re.sub(r'\s+', ' ', s).strip()


def norm_name_key(s: str) -> str:
    s = strip_accents(s or '').lower()
    return re.sub(r'[^a-z0-9]+', '', s)


def clean_text(s: str) -> str:
    s = (s or '').replace('­', '').replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def join_lines(lines: list[str]) -> str:
    """Join wrapped cell lines, undoing end-of-line hyphenation ("áci-" + "da" -> "ácida")."""
    out = ''
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if not out:
            out = ln
        elif re.search(r'[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]-$', out) and re.match(r'[a-záéíóúüñ]', ln):
            out = out[:-1] + ln
        else:
            out = out + ' ' + ln
    return clean_text(out)


def sentence_case(s: str) -> str:
    letters = [c for c in s if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        s = s.lower()
        return s[:1].upper() + s[1:]
    return s


NUM_RE = re.compile(r'^[<>]?\s*-?\d+(?:[.,]\d+)?$')
TRACE_RE = re.compile(r'^(tr|trazas?|traza)\.?$', re.I)
UNKNOWN_RE = re.compile(r'^(nd|n\.d\.|na|n\.a\.|-+|–+|—+|s\.d\.|sd)$', re.I)


class Unparsed(Exception):
    pass


def parse_value(raw: str):
    """Return (value, kind) with kind in {'num','trace','null'}; raise Unparsed otherwise."""
    s = clean_text(raw)
    if s == '':
        return None, 'null'
    if TRACE_RE.match(s):
        return 0.0, 'trace'
    if UNKNOWN_RE.match(s):
        return None, 'null'
    s2 = s.replace(' ', '')
    if NUM_RE.match(s2):
        if s2[0] in '<>':
            raise Unparsed(s)
        if '.' in s2 and ',' not in s2 and re.match(r'^\d{1,3}\.\d{3}$', s2):
            # thousands separator in a Spanish document ("1.185")
            return float(s2.replace('.', '')), 'num'
        return float(s2.replace(',', '.')), 'num'
    raise Unparsed(s)


# ----------------------------------------------------------------------------------------------
# Vector-table reconstruction
# ----------------------------------------------------------------------------------------------
HEADER_RGB = (0.563, 0.789, 0.393)
ROW_RGBS = ((0.819, 0.840, 0.891), (0.828, 0.910, 0.757))


def _close(c1, c2, tol=0.035):
    return c1 is not None and len(c1) >= 3 and all(abs(a - b) <= tol for a, b in zip(c1, c2))


def _merge_intervals(iv, gap=1.0):
    iv = sorted(iv)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


class Table:
    def __init__(self, page_no, band, cols, rows, words, groups):
        self.page_no = page_no  # 1-based
        self.band = band  # (x0,y0,x1,y1) header
        self.cols = cols  # [(x0,x1)]
        self.rows = rows  # [(y0,y1)]
        self.groups = groups  # [(x0,x1,y_split)] top-level header spans (multi-level headers)
        self.labels = [self._header_label(c, words) for c in cols]
        self.nlabels = [norm_label(l) for l in self.labels]
        self.cells = [[self._cell(c, r, words) for c in cols] for r in rows]
        self.rawrows = [self._rowtext(r, words) for r in rows]

    def _header_label(self, col, words):
        """Column label = group label (upper header level, spanning sub-columns) + own label."""
        x0, x1 = col
        bx0, by0, bx1, by1 = self.band
        cxm = (x0 + x1) / 2
        grp = next((g for g in self.groups if g[0] - 0.5 <= cxm <= g[1] + 0.5), None)
        upper, own = [], []
        for w in words:
            cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
            if not (by0 - 0.5 <= cy <= by1 + 0.5):
                continue
            if grp is not None and grp[2] is not None and cy < grp[2] and grp[0] <= cx <= grp[1]:
                upper.append(w)
            elif x0 <= cx < x1:
                own.append(w)
        key = lambda w: (round((w[1] + w[3]) / 2 / 3), w[0])
        return clean_text(' '.join(w[4] for w in sorted(upper, key=key) + sorted(own, key=key)))

    @staticmethod
    def _lines(ws):
        ws = sorted(ws, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
        lines = []
        for w in ws:
            cy = (w[1] + w[3]) / 2
            if lines and abs(lines[-1][0] - cy) <= 2.2:
                lines[-1][1].append(w)
            else:
                lines.append([cy, [w]])
        return [' '.join(x[4] for x in sorted(l[1], key=lambda w: w[0])) for l in lines]

    def _cell(self, col, row, words):
        x0, x1 = col
        y0, y1 = row
        ws = [w for w in words
              if x0 <= (w[0] + w[2]) / 2 < x1 and y0 <= (w[1] + w[3]) / 2 < y1]
        return join_lines(self._lines(ws))

    def _rowtext(self, row, words):
        y0, y1 = row
        bx0, _, bx1, _ = self.band
        ws = [w for w in words if y0 <= (w[1] + w[3]) / 2 < y1 and bx0 - 1 <= (w[0] + w[2]) / 2 <= bx1 + 1]
        return ' | '.join(self._lines(ws))

    def col_index(self, pred):
        for i, l in enumerate(self.nlabels):
            if pred(l):
                return i
        return None


def extract_tables(page, page_no):
    drawings = page.get_drawings()
    hdr_items, row_items, vlines = [], [], []
    for d in drawings:
        fill = d.get('fill')
        if fill is not None and d['type'] in ('f', 'fs'):
            is_hdr = _close(fill, HEADER_RGB)
            is_row = any(_close(fill, c) for c in ROW_RGBS)
            if is_hdr and any(it[0] in ('l', 'c') for it in d['items']):
                # header drawn as a polygon (fatty-acid pages): use the path's bounding box
                r = d['rect']
                hdr_items.append((r.x0, r.y0, r.x1, r.y1))
            if is_hdr or is_row:
                for it in d['items']:
                    if it[0] == 're':
                        r = it[1]
                    elif it[0] == 'qu':
                        r = it[1].rect
                    else:
                        continue
                    (hdr_items if is_hdr else row_items).append((r.x0, r.y0, r.x1, r.y1))
        if d['type'] in ('s', 'fs'):
            for it in d['items']:
                if it[0] == 'l':
                    p1, p2 = it[1], it[2]
                    if abs(p1.x - p2.x) < 0.6 and abs(p1.y - p2.y) > 2:
                        vlines.append(((p1.x + p2.x) / 2, min(p1.y, p2.y), max(p1.y, p2.y)))
    if not hdr_items:
        return []
    # header bands: merge header cells whose vertical extents touch
    bands = []
    for y0, y1 in _merge_intervals([(r[1], r[3]) for r in hdr_items], gap=1.2):
        xs = [r for r in hdr_items if r[1] >= y0 - 0.1 and r[3] <= y1 + 0.1]
        bx0 = min(r[0] for r in xs)
        bx1 = max(r[2] for r in xs)
        if bx1 - bx0 < 150:
            continue
        bands.append((bx0, y0, bx1, y1))
    bands.sort(key=lambda b: b[1])
    words = page.get_text('words')
    tables = []
    for bi, band in enumerate(bands):
        bx0, by0, bx1, by1 = band
        ylimit = bands[bi + 1][1] if bi + 1 < len(bands) else 1e9
        # rows
        ivs = sorted({(round(r[1], 1), round(r[3], 1)) for r in row_items
                      if r[1] >= by1 - 1.0 and r[3] <= ylimit + 0.5
                      and r[0] >= bx0 - 2 and r[2] <= bx1 + 2 and r[3] - r[1] > 2})
        rows = []
        for y0, y1 in ivs:
            if rows and abs(rows[-1][0] - y0) < 0.6:
                rows[-1] = (min(rows[-1][0], y0), max(rows[-1][1], y1))
            elif rows and y0 < rows[-1][1] - 0.6:
                # overlapping rectangles: keep the union (should not happen in TCAC)
                rows[-1] = (rows[-1][0], max(rows[-1][1], y1))
            else:
                rows.append((y0, y1))
        # columns from vertical lines that end at the bottom of the header band
        xs = [bx0, bx1]
        for x, y0, y1 in vlines:
            if bx0 - 1.5 <= x <= bx1 + 1.5 and abs(y1 - by1) <= 2.5 and y0 < by1 - 3:
                xs.append(x)
        xs.sort()
        cx = []
        for x in xs:
            if cx and x - cx[-1] < 1.5:
                continue
            cx.append(x)
        cols = [(cx[i], cx[i + 1]) for i in range(len(cx) - 1) if cx[i + 1] - cx[i] > 2]
        if not rows or len(cols) < 2:
            continue
        if by1 - by0 > 120:
            raise SystemExit(f'FATAL: p{page_no}: implausible header band height {by1 - by0:.0f}pt')
        # top-level spans: vertical lines that start at the top of the header band
        tx = [bx0, bx1] + [x for x, y0, y1 in vlines
                           if bx0 - 1.5 <= x <= bx1 + 1.5 and abs(y0 - by0) <= 2.5 and y1 > by0 + 3]
        tx.sort()
        gx = []
        for x in tx:
            if not gx or x - gx[-1] >= 1.5:
                gx.append(x)
        groups = []
        for a, b in zip(gx, gx[1:]):
            inner = [y0 for x, y0, y1 in vlines
                     if a + 1.5 < x < b - 1.5 and abs(y1 - by1) <= 2.5 and y0 > by0 + 3]
            groups.append((a, b, min(inner) if inner else None))
        tables.append(Table(page_no, band, cols, rows, words, groups))
    return tables


# ----------------------------------------------------------------------------------------------
# Section recognition and column mapping
# ----------------------------------------------------------------------------------------------

def classify(t: Table):
    L = ' || '.join(t.nlabels)
    has = lambda s: s in L
    if has('nombre del alimento') and has('codigo consecutivo'):
        return 'LIST', 'L'
    if has('generico') and has('codigo provisional'):
        return 'IDENT', 'L'
    if has('proceso i') and has('nombre regional'):
        return 'IDENT', 'R'
    if has('energia (kcal)'):
        return 'PROX', 'L'
    if has('lipidos promedio') and not has('nombre'):
        return 'PROX', 'R'
    if has('calcio promedio'):
        return 'MIN', 'L'
    if has('yodo promedio') and not has('nombre'):
        return 'MIN', 'R'
    if has('vitamina a promedio'):
        return 'VITA', 'L'
    if has('tiamina promedio'):
        return 'HYD', 'L'
    if has('pantotenico promedio') and not has('nombre'):
        return 'HYD', 'R'
    if has('saturados') and has('nombre'):
        return 'FAT', 'L'
    if has('azucares disponibles totales') and has('nombre'):
        return 'SUGAR', 'L'
    if has('fibra dietaria total') and has('nombre'):
        return 'AFIBER', 'L'
    if has('parte comestible') and has('nombre'):
        return 'EDIBLE', 'L'
    return None, None


def _is_id_label(l):
    return ('identificacion' in l or l.startswith('codigo provisional') or 'num. de id' in l
            or 'codigo consecutivo' in l)


def _is_name_label(l):
    return l in ('nombre', 'nombre del alimento')


# For each section: list of (internal key, predicate on normalized header label)
COLMAP = {
    'PROX': [
        ('kcal', lambda l: l.startswith('energia (kcal)')),
        ('kj', lambda l: l.startswith('energia (kj)')),
        ('water', lambda l: l == 'humedad promedio'),
        ('protein', lambda l: l == 'proteina promedio'),
        ('fat', lambda l: l == 'lipidos promedio'),
        ('carbs_printed', lambda l: l.startswith('carbohidratos') and l.endswith('promedio')),
        ('ash', lambda l: l == 'cenizas promedio'),
        ('fiber', lambda l: l.startswith('fibra dietaria') and l.endswith('promedio')),
    ],
    'MIN': [
        ('calcium', lambda l: l == 'calcio promedio'),
        ('iron', lambda l: l == 'hierro promedio'),
        ('sodium', lambda l: l == 'sodio promedio'),
        ('phosphorus', lambda l: l == 'fosforo promedio'),
        ('zinc', lambda l: l == 'zinc promedio'),
        ('magnesium', lambda l: l == 'magnesio promedio'),
        ('potassium', lambda l: l == 'potasio promedio'),
    ],
    'VITA': [('vitA', lambda l: l == 'vitamina a promedio')],
    'HYD': [
        ('vitB12', lambda l: l == 'vitamina b12 promedio'),
        ('vitC', lambda l: l == 'vitamina c promedio'),
        ('folate', lambda l: l == 'folatos promedio'),
    ],
    'FAT': [
        ('satFat', lambda l: 'saturados' in l and 'insaturados' not in l and l.endswith('promedio')),
        ('monoFat', lambda l: 'monoinsaturados' in l and l.endswith('promedio')),
        ('polyFat', lambda l: 'poliinsaturados' in l and l.endswith('promedio')),
        ('cholesterol', lambda l: l.startswith('colesterol') and l.endswith('promedio')),
        ('transFat', lambda l: 'trans' in l and 'grasos' in l and l.endswith('promedio')
         and not l.startswith('ac.')),
    ],
    'SUGAR': [('sugars', lambda l: 'azucares disponibles totales' in l and 'valor medio' in l)],
    'AFIBER': [('fiber_annex', lambda l: 'fibra dietaria total' in l and 'valor medio' in l)],
    'EDIBLE': [('edible_pct', lambda l: l.strip() == '%')],
    'IDENT': [('alt_names', lambda l: l.startswith('nombre regional'))],
    'LIST': [],
}

# Section -> human description for the report (units as printed in the PDF headers / unit table)
COLUMN_DOC = [
    ('PROX', 'Energía (kcal)', 'kcal', 'kcal', 'as printed'),
    ('PROX', 'Energía (kj)', 'kj', 'kJ', 'as printed'),
    ('PROX', 'Humedad promedio (g)', 'water', 'g', 'as printed'),
    ('PROX', 'Proteína promedio (g)', 'protein', 'g', 'as printed'),
    ('PROX', 'Lípidos promedio (g)', 'fat', 'g', 'as printed'),
    ('PROX', 'Carbohidratos por diferencia promedio (g)', 'carbs / carbsAvail', 'g',
     'see "Carbohydrate basis" below'),
    ('PROX', 'Fibra dietaria promedio (g)', 'fiber', 'g', 'as printed'),
    ('PROX', 'Cenizas promedio (g)', '(dropped; used only for the closure test)', 'g', ''),
    ('MIN', 'Calcio promedio (mg)', 'calcium', 'mg', 'as printed'),
    ('MIN', 'Hierro promedio (mg)', 'iron', 'mg', 'as printed'),
    ('MIN', 'Sodio promedio (mg)', 'sodium', 'mg', 'as printed'),
    ('MIN', 'Fósforo promedio (mg)', 'phosphorus', 'mg', 'as printed'),
    ('MIN', 'Zinc promedio (mg)', 'zinc', 'mg', 'as printed'),
    ('MIN', 'Magnesio promedio (mg)', 'magnesium', 'mg', 'as printed'),
    ('MIN', 'Potasio promedio (mg)', 'potassium', 'mg', 'as printed'),
    ('VITA', 'Vitamina A promedio (ER = µg equivalentes de retinol)', 'vitA', 'µg', 'RE stored as-is (contract label says ER/RAE)'),
    ('HYD', 'Vitamina C promedio (mg)', 'vitC', 'mg', 'as printed'),
    ('HYD', 'Vitamina B12 promedio', 'vitB12', 'µg', 'unit decided from the data, see below'),
    ('HYD', 'Folatos promedio', 'folate', 'µg', 'unit decided from the data, see below'),
    ('FAT', 'Ácidos grasos saturados promedio (g)', 'satFat', 'g', 'as printed'),
    ('FAT', 'Ácidos grasos monoinsaturados promedio (g)', 'monoFat', 'g', 'as printed'),
    ('FAT', 'Ácidos grasos poliinsaturados promedio (g)', 'polyFat', 'g', 'as printed'),
    ('FAT', 'Ácidos grasos trans promedio (g)', 'transFat', 'g', 'as printed'),
    ('FAT', 'Colesterol promedio (mg)', 'cholesterol', 'mg', 'as printed'),
    ('SUGAR', 'Anexo A C3: Azúcares disponibles totales (g), valor medio', 'sugars', 'g', 'as printed'),
    ('AFIBER', 'Anexo A C6: Fibra dietaria total (g), valor medio', 'fiber', 'g',
     'only when the proximal table has no fibre value (flag fiber_from_annex)'),
    ('EDIBLE', 'Anexo B: Parte comestible %', 'flag edible_pct=<n>', '%', 'from TCAC 2000 per the PDF'),
    ('IDENT', 'Nombre regional o alternativo', 'synonyms', '', 'lowercase, accent-free'),
]


class Row:
    __slots__ = ('section', 'page', 'code', 'name', 'group', 'vals', 'raw', 'trace', 'unparsed')

    def __init__(self, section, page, code, name, group):
        self.section, self.page, self.code, self.name, self.group = section, page, code, name, group
        self.vals, self.raw, self.trace, self.unparsed = {}, [], set(), []


def parse_sections(doc, log):
    """Return {section: [Row,...]} in document order plus page bookkeeping."""
    out = defaultdict(list)
    pages_used = defaultdict(set)
    ignored = Counter()
    last_left = {}  # section -> (page_no, Table, [Row])
    struct_errors = []
    for pno in range(doc.page_count):
        page = doc[pno]
        for t in extract_tables(page, pno + 1):
            sec, side = classify(t)
            if sec is None:
                ignored[' / '.join(l for l in t.labels[:6])[:90]] += 1
                continue
            pages_used[sec].add(pno + 1)
            if side == 'L':
                ic = t.col_index(_is_id_label)
                nc = t.col_index(_is_name_label)
                gc = t.col_index(lambda l: l == 'grupo')
                if ic is None or nc is None:
                    struct_errors.append(f'p{pno + 1} {sec}: id/name column not found: {t.labels}')
                    continue
                rows = []
                for ri, cells in enumerate(t.cells):
                    code = clean_text(cells[ic]).replace(' ', '')
                    name = cells[nc]
                    if not code and not name:
                        continue
                    r = Row(sec, pno + 1, code, name, cells[gc] if gc is not None else '')
                    r.raw.append(f'p{pno + 1}: {t.rawrows[ri]}')
                    _fill_values(r, t, ri, sec)
                    rows.append((ri, r))
                last_left[sec] = (pno + 1, t, rows)
                out[sec].extend(r for _, r in rows)
            else:  # right-hand continuation page
                prev = last_left.get(sec)
                if prev is None or prev[0] != pno:
                    struct_errors.append(f'p{pno + 1} {sec}: right page without left page on p{pno}')
                    continue
                lp, lt, lrows = prev
                if len(lt.rows) != len(t.rows) or any(
                        abs(a[0] - b[0]) > 1.2 or abs(a[1] - b[1]) > 1.2 for a, b in zip(lt.rows, t.rows)):
                    struct_errors.append(
                        f'p{pno + 1} {sec}: row geometry differs from p{lp} ({len(t.rows)} vs {len(lt.rows)} rows)')
                    continue
                for ri, r in lrows:
                    r.raw.append(f'p{pno + 1}: {t.rawrows[ri]}')
                    _fill_values(r, t, ri, sec)
    return out, pages_used, ignored, struct_errors


def _fill_values(r: Row, t: Table, ri: int, sec: str):
    for key, pred in COLMAP.get(sec, []):
        ci = t.col_index(pred)
        if ci is None:
            continue
        raw = t.cells[ri][ci]
        if key == 'alt_names':
            r.vals[key] = raw
            continue
        try:
            v, kind = parse_value(raw)
        except Unparsed:
            r.unparsed.append((key, raw))
            v, kind = None, 'null'
        if kind == 'trace':
            r.trace.add(key)
        if key not in r.vals or r.vals[key] is None:
            r.vals[key] = v


# ----------------------------------------------------------------------------------------------
# Joining sections into foods
# ----------------------------------------------------------------------------------------------

def index_rows(rows):
    """code -> list of rows (document order)."""
    idx = defaultdict(list)
    for r in rows:
        idx[r.code].append(r)
    return idx


def _n_mapped(r):
    return sum(1 for k, v in r.vals.items() if v not in (None, '') and k != 'alt_names')


def match_rows(food_code, food_name, occ, n_occ, idx, stats, sec):
    """Rows of a secondary section that belong to this food.

    Returns (rows, mode): rows[0] is the primary row (its values win), the rest only fill gaps.
    One-to-one by occurrence when the secondary table repeats the code as often as the proximal
    table; otherwise all same-name rows are merged (primary = most complete row)."""
    cands = idx.get(food_code, [])
    if not cands:
        return [], None
    key = norm_name_key(food_name)
    same = [c for c in cands if norm_name_key(c.name) == key]
    if not same:
        import difflib
        close = [c for c in cands
                 if difflib.SequenceMatcher(None, key, norm_name_key(c.name)).ratio() >= 0.85]
        if len(cands) == 1 and len(close) == 1 and n_occ == 1:
            stats[sec + ':name_differs_accepted'].append((food_code, food_name, cands[0].name))
            return close, 'name_differs'
        stats[sec + ':name_mismatch_rejected'].append((food_code, food_name, [c.name for c in cands]))
        return [], None
    if len(same) == 1:
        return same, 'single'
    if len(same) == n_occ:
        return [same[occ]], 'by_occurrence'
    primary = max(same, key=lambda r: (_n_mapped(r), -same.index(r)))
    return [primary] + [r for r in same if r is not primary], 'merged'


COOKED_RE = re.compile(
    r'\b(cocid[oa]s?|hervid[oa]s?|frit[oa]s?|asad[oa]s?|hornead[oa]s?|sudad[oa]s?|guisad[oa]s?|'
    r'al vapor|tostad[oa]s?|cocinad[oa]s?|sofrit[oa]s?|apanad[oa]s?|ahumad[oa]s?|escaldad[oa]s?)\b')
RAW_RE = re.compile(r'\b(crud[oa]s?|fresc[oa]s?)\b')


def food_kind(name: str, group: str) -> str:
    g = norm_label(group)
    if 'preparad' in g or 'preparacion' in g:
        return 'prepared'
    n = strip_accents(name.lower())
    if COOKED_RE.search(n):
        return 'cooked'
    if RAW_RE.search(n):
        return 'raw'
    return 'generic'


def synonyms_from(alt: str, name: str):
    if not alt:
        return None
    s = strip_accents(alt).lower()
    s = re.sub(r'[^a-z0-9ñ ]+', ' ', s.replace('ñ', 'n'))
    name_toks = set(re.sub(r'[^a-z0-9 ]+', ' ', strip_accents(name).lower()).split())
    toks, seen = [], set()
    for tok in s.split():
        if len(tok) < 2 or tok in seen or tok in {'de', 'la', 'el', 'los', 'las', 'y', 'o', 'con', 'en', 'del'}:
            continue
        seen.add(tok)
        toks.append(tok)
    if not toks or set(toks) <= name_toks:  # adds nothing beyond the name itself
        return None
    return ' '.join(toks)


def category_name(group: str) -> str:
    g = clean_text(group)
    return re.sub(r'^[A-Z]\s*\.\s*', '', g) or g


SECONDARY = ('MIN', 'VITA', 'HYD', 'FAT', 'SUGAR', 'AFIBER', 'EDIBLE', 'IDENT')
MULTI_FLAG = {'MIN': 'multi_entry_minerals', 'VITA': 'multi_entry_vita', 'HYD': 'multi_entry_hydrovit',
              'FAT': 'multi_entry_fattyacids', 'SUGAR': 'multi_entry_sugars', 'AFIBER': 'multi_entry_fiber'}


def _new_rec(r: Row):
    return {'code': r.code, 'name': r.name, 'group': r.group, 'vals': dict(r.vals),
            'trace': set(r.trace), 'raw': list(r.raw), 'flags': [], 'unparsed': list(r.unparsed),
            'pages': {r.section: r.page}, 'has_prox': r.section == 'PROX'}


def build_foods(sections, log, include_no_prox=False):
    stats = defaultdict(list)
    prox_all = sections.get('PROX', [])
    if not prox_all:
        raise SystemExit('FATAL: no proximal-analysis rows parsed')
    # drop byte-identical duplicate rows of the proximal table (same code, name and values)
    prox, seen_sig = [], set()
    for r in prox_all:
        sig = (r.code, norm_name_key(r.name), tuple(sorted((k, v) for k, v in r.vals.items())))
        if sig in seen_sig:
            stats['PROX:identical_duplicate_row_dropped'].append((r.page, r.code, r.name))
            continue
        seen_sig.add(sig)
        prox.append(r)
    other = {s: index_rows(sections.get(s, [])) for s in SECONDARY + ('LIST',)}
    used = {s: set() for s in other}
    n_occ = Counter(r.code for r in prox)
    occ_counter = Counter()
    foods = []
    base = list(prox)
    if include_no_prox:
        prox_codes = set(n_occ)
        # foods of the master list without proximal data (TCAC keeps them only in other tables)
        for lr in sections.get('LIST', []):
            if lr.code not in prox_codes:
                stub = Row('LIST', lr.page, lr.code, lr.name, lr.group)
                base.append(stub)
                n_occ[lr.code] += 1
    for r in base:
        if not re.fullmatch(r'\d+', r.code):
            stats['bad_code'].append((r.page, r.code, r.name))
            continue
        occ = occ_counter[r.code]
        occ_counter[r.code] += 1
        rec = _new_rec(r)
        for sec in SECONDARY:
            ms, mode = match_rows(r.code, r.name, occ, n_occ[r.code], other[sec], stats, sec)
            if not ms:
                continue
            if mode == 'merged':
                used[sec].update(id(x) for x in ms)
                if sec in MULTI_FLAG:
                    rec['flags'].append(MULTI_FLAG[sec])
                    stats[sec + ':merged_multiple_entries'].append((r.code, r.name, len(ms)))
            else:
                used[sec].add(id(ms[0]))
            rec['pages'][sec] = ms[0].page
            for m in ms:
                for k, v in m.vals.items():
                    if k == 'alt_names':
                        if v:
                            rec['vals'][k] = (rec['vals'].get(k, '') + ', ' + v).strip(', ')
                        continue
                    if k not in rec['vals'] or rec['vals'][k] is None:
                        rec['vals'][k] = v
                        if k in m.trace:
                            rec['trace'].add(k)
                rec['unparsed'] += m.unparsed
                if sec in ('MIN', 'VITA', 'HYD', 'FAT'):
                    rec['raw'] += m.raw
        if not rec['has_prox']:
            if not any(v is not None for k, v in rec['vals'].items()
                       if k not in ('alt_names', 'edible_pct')):
                stats['LIST:no_nutrient_data_anywhere'].append((r.code, r.name))
                continue
            rec['flags'].append('no_proximal')
        foods.append(rec)
    # rows in nutrient sections that never matched an emitted food
    for sec in ('MIN', 'VITA', 'HYD', 'FAT', 'SUGAR', 'AFIBER', 'EDIBLE'):
        for r in sections.get(sec, []):
            if id(r) not in used[sec]:
                stats[sec + ':unmatched'].append((r.page, r.code, r.name))
    # master-list foods that are not emitted
    emitted = {f['code'] for f in foods}
    for lr in sections.get('LIST', []):
        if lr.code not in emitted:
            secs = [s for s in ('MIN', 'VITA', 'HYD', 'FAT', 'EDIBLE') if lr.code in other[s]]
            stats['LIST:not_emitted(no_proximal)'].append((lr.code, lr.name, '+'.join(secs) or '-'))
    return foods, stats


def finalize(foods, b12_div, folate_div, log):
    rows = []
    seen = Counter()
    for f in foods:
        v = f['vals']
        nut = [None] * len(NUTRIENT_ORDER)
        flags = ['per_edible_portion'] + list(f['flags'])

        def put(code, val):
            if val is not None:
                nut[NIDX[code]] = round(float(val), 4)

        for code in ('kcal', 'kj', 'protein', 'fat', 'water', 'satFat', 'monoFat', 'polyFat',
                     'transFat', 'cholesterol', 'sodium', 'potassium', 'calcium', 'iron',
                     'magnesium', 'phosphorus', 'zinc', 'vitA', 'vitC', 'sugars'):
            put(code, v.get(code))
        if v.get('vitB12') is not None:
            put('vitB12', v['vitB12'] / b12_div)
        if v.get('folate') is not None:
            put('folate', v['folate'] / folate_div)
        fiber = v.get('fiber')
        if fiber is None and v.get('fiber_annex') is not None:
            fiber = v['fiber_annex']
            flags.append('fiber_from_annex')
        put('fiber', fiber)
        # carbohydrate basis: "por diferencia" sometimes excludes dietary fibre (methodology 3.2.2)
        cp = v.get('carbs_printed')
        basis = None
        if cp is not None:
            parts = [v.get(k) for k in ('water', 'protein', 'fat', 'ash')]
            if all(p is not None for p in parts):
                closure = sum(parts) + cp
                if fiber is not None and fiber > 0:
                    with_f = abs(closure + fiber - 100)
                    without = abs(closure - 100)
                    basis = 'avail' if with_f + 0.05 < without else 'total'
                else:
                    basis = 'total'
            else:
                basis = 'total'
                if fiber:
                    flags.append('carbs_basis_unverified')
            if basis == 'avail':
                put('carbsAvail', cp)
                put('carbs', cp + fiber)
                flags.append('carbs_total_derived')
            else:
                put('carbs', cp)
                if fiber is not None:
                    put('carbsAvail', max(cp - fiber, 0.0))
                    flags.append('carbs_avail_derived')
        f['carb_basis'] = basis
        # component > parent is impossible per 100 g: drop the component (keep the parent)
        f['dropped'] = []
        # Fatty-acid profile: some rows are clearly "% of total fatty acids" (sum ~100) or
        # otherwise exceed total fat; the whole profile of such a row is unreliable -> null all.
        fat_v = nut[NIDX['fat']]
        fa_codes = ('satFat', 'monoFat', 'polyFat', 'transFat')
        fa_vals = {c: nut[NIDX[c]] for c in fa_codes if nut[NIDX[c]] is not None}
        if fat_v is not None and fa_vals:
            main3 = [x for c, x in fa_vals.items() if c != 'transFat']
            s3 = sum(main3)
            pct_profile = len(main3) >= 2 and 95 <= s3 <= 105 and fat_v < 90  # % of total FA
            gross = s3 > fat_v * 1.25 + 0.5
            if pct_profile or gross:
                for c, x in fa_vals.items():
                    f['dropped'].append((c, x, 'fat', fat_v))
                    nut[NIDX[c]] = None
                flags.append('fatty_acids_inconsistent_dropped')
            else:
                for c, x in fa_vals.items():
                    if x > fat_v + 0.5:
                        f['dropped'].append((c, x, 'fat', fat_v))
                        nut[NIDX[c]] = None
                        if 'fatty_acid_gt_fat_dropped' not in flags:
                            flags.append('fatty_acid_gt_fat_dropped')
                if s3 > fat_v * 1.05 + 0.5:
                    flags.append('fatty_acid_sum_gt_fat')
        cv, pv = nut[NIDX['sugars']], nut[NIDX['carbs']]
        if cv is not None and pv is not None and cv > pv + 0.5:
            f['dropped'].append(('sugars', cv, 'carbs', pv))
            nut[NIDX['sugars']] = None
            flags.append('sugars_gt_carbs_dropped')
        p_, fa_, c_ = (nut[NIDX[k]] for k in ('protein', 'fat', 'carbs'))
        if sum(x for x in (p_, fa_, c_) if x is not None) > 105:
            flags.append('macro_sum_gt_105')
        if v.get('edible_pct') is not None:
            pct = v['edible_pct']
            flags.append('edible_pct=' + (str(int(pct)) if float(pct).is_integer() else str(pct)))
        if f['trace']:
            flags.append('trace_as_zero')
        seen[f['code']] += 1
        fid = f['code'] if seen[f['code']] == 1 else f"{f['code']}-{seen[f['code']]}"
        if seen[f['code']] > 1:
            flags.append('dup_code_in_source')
        name = sentence_case(clean_text(f['name']))
        rows.append([
            f'{SOURCE}:{fid}', name, name, None, None, category_name(f['group']) or None,
            food_kind(name, f['group']), '100g', nut, None,
            synonyms_from(v.get('alt_names', ''), name), ';'.join(flags) or None,
        ])
        f['row'] = rows[-1]
    # mark the first occurrence of duplicated codes too
    dups = {c for c, n in seen.items() if n > 1}
    for r in rows:
        code = r[0].split(':', 1)[1].split('-')[0]
        if code in dups and 'dup_code_in_source' not in (r[11] or ''):
            r[11] = (r[11] + ';' if r[11] else '') + 'dup_code_in_source'
    return rows


# ----------------------------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------------------------

def check_contract():
    if not CATALOG_TYPES.exists():
        return 'catalogTypes.ts not found; using built-in NUTRIENT_ORDER'
    src = CATALOG_TYPES.read_text(encoding='utf-8')
    m = re.search(r'export const NUTRIENTS = \[(.*?)\] as const', src, re.S)
    if not m:
        raise SystemExit('FATAL: could not locate NUTRIENTS in catalogTypes.ts')
    codes = re.findall(r"code:\s*'(\w+)'", m.group(1))
    if codes != NUTRIENT_ORDER:
        raise SystemExit(f'FATAL: NUTRIENT_ORDER differs from catalogTypes.ts: {codes}')
    return 'NUTRIENT_ORDER matches catalogTypes.ts'


def validate(rows, foods):
    problems = []
    ids = [r[0] for r in rows]
    dup = [k for k, n in Counter(ids).items() if n > 1]
    if dup:
        problems.append(f'duplicate ids: {dup[:10]}')
    for r in rows:
        if len(r) != 12:
            problems.append(f'{r[0]}: row length {len(r)}')
        if not r[1] or not r[5]:
            problems.append(f'{r[0]}: missing name/category')
        if len(r[8]) != len(NUTRIENT_ORDER):
            problems.append(f'{r[0]}: nutrients length {len(r[8])}')
    plaus = []
    g = lambda r, c: r[8][NIDX[c]]
    for r in rows:
        p, fa, c, w, k = g(r, 'protein'), g(r, 'fat'), g(r, 'carbs'), g(r, 'water'), g(r, 'kcal')
        macro = sum(x for x in (p, fa, c) if x is not None)
        if macro > 105:
            plaus.append((r[0], r[1], f'protein+fat+carbs={macro:.1f}'))
        if w is not None and w > 100:
            plaus.append((r[0], r[1], f'water={w}'))
        if k is not None and k > 900:
            plaus.append((r[0], r[1], f'kcal={k}'))
        kj = g(r, 'kj')
        if k and kj and abs(kj - 4.184 * k) > max(5.0, 0.03 * kj):
            plaus.append((r[0], r[1], f'kJ={kj} inconsistent with kcal={k}'))
        for code in NUTRIENT_ORDER:
            x = g(r, code)
            if x is not None and x < 0:
                plaus.append((r[0], r[1], f'{code}<0'))
    # Atwater with the carbohydrate value TCAC used for energy (printed "por diferencia")
    at_n = at_pass = 0
    outliers = []
    for f in foods:
        v = f['vals']
        p, fa, cp, k = v.get('protein'), v.get('fat'), v.get('carbs_printed'), v.get('kcal')
        if None in (p, fa, cp, k):
            continue
        at_n += 1
        calc = 4 * p + 4 * cp + 9 * fa
        dev = (k - calc) / calc if calc > 0 else (0 if k == 0 else 1)
        if abs(dev) <= 0.25 or abs(k - calc) <= 5:
            at_pass += 1
        else:
            outliers.append((f['row'][0], f['row'][1], k, round(calc, 1), round(dev * 100, 1)))
    return problems, plaus, (at_n, at_pass, outliers)


def golden_check(rows, foods, golden_path):
    """Golden file: {"foods":[{"id","name","category","pdf":{<parsed column key>: value|null},
    "output":{<contract code>: value|null}}]}. "pdf" keys are the parsed TCAC columns (kcal, kj,
    water, protein, fat, carbs_printed, ash, fiber, calcium, iron, sodium, phosphorus, zinc,
    magnesium, potassium, vitA, vitC, vitB12, folate, satFat, monoFat, polyFat, transFat,
    cholesterol, sugars, edible_pct); "output" keys are checked in the emitted row."""
    if not golden_path.exists():
        return None, [f'golden file not found: {golden_path}']
    gold = json.loads(golden_path.read_text(encoding='utf-8'))
    byid = {r[0]: r for r in rows}
    fbyid = {f['row'][0]: f for f in foods}
    results, fails = [], []

    def differs(got, exp):
        return (exp is None) != (got is None) or (exp is not None and abs(got - exp) > 1e-9)

    for item in gold.get('foods', []):
        rid = item['id']
        r = byid.get(rid)
        if r is None:
            fails.append(f'{rid}: not in output')
            results.append((rid, item.get('name', ''), 'MISSING', 0, 0))
            continue
        nfail = 0
        ncheck = 0
        detail = []
        if item.get('name') and norm_name_key(item['name']) != norm_name_key(r[1]):
            nfail += 1
            detail.append(f'name {r[1]!r} != {item["name"]!r}')
        for key, exp in item.get('pdf', {}).items():
            ncheck += 1
            got = fbyid[rid]['vals'].get(key)
            if differs(got, exp):
                nfail += 1
                detail.append(f'pdf.{key}: got {got} expected {exp}')
        for code, exp in item.get('output', {}).items():
            ncheck += 1
            got = r[8][NIDX[code]]
            if differs(got, exp):
                nfail += 1
                detail.append(f'output.{code}: got {got} expected {exp}')
        if item.get('category') and item['category'] != r[5]:
            nfail += 1
            detail.append(f'category {r[5]!r} != {item["category"]!r}')
        if item.get('kind') and item['kind'] != r[6]:
            nfail += 1
            detail.append(f'kind {r[6]!r} != {item["kind"]!r}')
        if nfail:
            fails.append(f'{rid}: ' + '; '.join(detail))
        results.append((rid, r[1], 'OK' if not nfail else 'FAIL', ncheck, nfail))
    return results, fails


# ----------------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def ranges(pages):
    pages = sorted(pages)
    out = []
    for p in pages:
        if out and p == out[-1][1] + 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return ', '.join(f'{a}-{b}' if a != b else f'{a}' for a, b in out)


def decide_unit_divisor(foods, key, label, log):
    """TCAC's unit table says mg for B12; folate has no unit. Decide µg vs mg from magnitudes."""
    vals = [f['vals'][key] for f in foods if f['vals'].get(key) not in (None, 0)]
    if not vals:
        return 1.0, f'{label}: no non-zero values; assumed µg'
    vals.sort()
    med = vals[len(vals) // 2]
    mx = vals[-1]
    # Foods rarely exceed ~100 µg B12 or ~3000 µg folate per 100 g. If the maximum is tiny (<1)
    # the column is in mg; otherwise it is already µg.
    head = f'{label}: {len(vals)} non-zero values, max={mx}, median={med}'
    if mx < 1.0:
        return 1 / 1000.0, head + ' -> interpreted as mg, converted x1000 to µg'
    return 1.0, (head + ' -> magnitudes only make sense as µg (read as mg they would be ~1000x too '
                 'high); stored as printed, unit µg')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--pdf', type=Path, default=DEFAULT_PDF)
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--golden', type=Path, default=DEFAULT_GOLDEN)
    ap.add_argument('--report', type=Path, default=DEFAULT_REPORT)
    ap.add_argument('--source-url', default=DEFAULT_SOURCE_URL)
    ap.add_argument('--seed', type=int, default=2015)
    ap.add_argument('--samples', type=int, default=5)
    ap.add_argument('--include-no-proximal', action='store_true',
                    help='also emit master-list foods that have no proximal row (no kcal/macros; '
                         'flag no_proximal). Off by default: TCAC only keeps foods with an energy value.')
    args = ap.parse_args(argv)

    app_dir = SCRIPT_DIR.parent.resolve()
    for p in (args.out, args.report):
        rp = p.resolve()
        if app_dir == rp or app_dir in rp.parents:
            raise SystemExit(f'FATAL: refusing to write private TCAC data inside the app repo: {rp}')

    log = []
    say = lambda *a: (print(*a), log.append(' '.join(str(x) for x in a)))
    say(check_contract())
    if not args.pdf.exists():
        raise SystemExit(f'FATAL: PDF not found: {args.pdf}')
    digest = sha256(args.pdf)
    size = args.pdf.stat().st_size
    say(f'PDF {args.pdf.name}: {size} bytes, sha256 {digest}')
    doc = pymupdf.open(str(args.pdf))
    if doc.needs_pass and not doc.authenticate(''):
        raise SystemExit('FATAL: PDF needs a password')

    sections, pages_used, ignored, struct_errors = parse_sections(doc, log)
    for s in sorted(sections):
        say(f'section {s:7s}: {len(sections[s]):4d} rows on pages {ranges(pages_used[s])}')
    if struct_errors:
        for e in struct_errors:
            say('STRUCTURE ERROR:', e)
        raise SystemExit('FATAL: structural problems while reading tables')

    foods, stats = build_foods(sections, log, include_no_prox=args.include_no_proximal)
    b12_div, b12_note = decide_unit_divisor(foods, 'vitB12', 'Vitamina B12', log)
    fol_div, fol_note = decide_unit_divisor(foods, 'folate', 'Folatos', log)
    say(b12_note)
    say(fol_note)
    rows = finalize(foods, b12_div, fol_div, log)

    problems, plaus, (at_n, at_pass, outliers) = validate(rows, foods)
    unparsed = [(f['row'][0], f['row'][1], k, raw) for f in foods for k, raw in f['unparsed']]
    say(f'foods: {len(rows)}  unique ids: {len(set(r[0] for r in rows))}')
    for k, v in sorted(stats.items()):
        say(f'join note {k}: {len(v)}')
    if unparsed:
        say(f'unparsed cell values (set to null): {len(unparsed)}')
    if problems:
        for p in problems[:50]:
            say('PROBLEM:', p)
        raise SystemExit('FATAL: structural validation failed')
    say(f'plausibility flags: {len(plaus)}')
    at_pct = 100.0 * at_pass / at_n if at_n else 0.0
    say(f'Atwater (4p+4c+9f, c = carbohidratos por diferencia as printed): {at_pass}/{at_n} '
        f'within 25% (or 5 kcal) = {at_pct:.1f}%')

    gres, gfails = golden_check(rows, foods, args.golden)
    if gres is None:
        say('GOLDEN: ' + gfails[0])
    else:
        ok = sum(1 for g in gres if g[2] == 'OK')
        say(f'GOLDEN: {ok}/{len(gres)} foods OK, {sum(g[3] for g in gres)} values checked')
        for f in gfails:
            say('  GOLDEN FAIL:', f)

    # random samples next to the raw PDF row text
    rnd = random.Random(args.seed)
    sample = rnd.sample(foods, min(args.samples, len(foods)))
    print('\n=== random samples (parsed row vs raw PDF row text) ===')
    sample_txt = []
    for f in sample:
        r = f['row']
        nz = {c: r[8][NIDX[c]] for c in NUTRIENT_ORDER if r[8][NIDX[c]] is not None}
        block = [f'{r[0]} | {r[1]} | {r[5]} | {r[6]} | flags={r[11]} | syn={r[10]}',
                 '  parsed: ' + json.dumps(nz, ensure_ascii=False)]
        block += ['  raw ' + x for x in f['raw']]
        print('\n'.join(block))
        sample_txt.append('\n'.join(block))

    # output
    counts_group = Counter(r[5] for r in rows)
    out = OrderedDict([
        ('format', 'pho-catalog-foods'), ('version', 1), ('source', SOURCE),
        ('datasetVersion', 'TCAC 2015'),
        ('generatedAt', _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')),
        ('license', 'private-personal-use'), ('attribution', ATTRIBUTION),
        ('nutrientOrder', NUTRIENT_ORDER), ('counts', {SOURCE: len(rows)}), ('foods', rows),
    ])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    say(f'wrote {args.out} ({args.out.stat().st_size} bytes)')

    write_report(args, digest, size, sections, pages_used, ignored, stats, rows, foods, plaus,
                 (at_n, at_pass, outliers), gres, gfails, unparsed, b12_note, fol_note,
                 sample_txt, counts_group, log)
    say(f'wrote {args.report}')
    if gres is not None and gfails:
        raise SystemExit('FATAL: golden check failed')
    if at_n and at_pct < 90:
        raise SystemExit('FATAL: Atwater pass rate below 90%')
    return 0


def write_report(args, digest, size, sections, pages_used, ignored, stats, rows, foods, plaus,
                 atw, gres, gfails, unparsed, b12_note, fol_note, sample_txt, counts_group, log):
    at_n, at_pass, outliers = atw
    L = []
    w = L.append
    w('# TCAC 2015 extraction report (PRIVATE — do not commit or redistribute)\n')
    w(f'Generated by `app/data-pipeline/tcac2015.py` on '
      f'{_dt.datetime.now().astimezone().replace(microsecond=0).isoformat()}.\n')
    w('## Source\n')
    w(f'- URL: {args.source_url}')
    w(f'- File: `{args.pdf.name}` — {size:,} bytes')
    w(f'- sha256: `{digest}`')
    w('- Edition: Tabla de Composición de Alimentos Colombianos (TCAC) 2015, ICBF / Universidad Nacional; '
      '321 PDF pages, text layer present (vector tables).')
    w(f'- Output: `{args.out}` — {len(rows)} foods, nutrients per 100 g edible portion.\n')
    others = sorted(p for p in args.pdf.parent.glob('*.pdf') if p.resolve() != args.pdf.resolve())
    if others:
        w('Other PDFs found next to the input (not parsed; text-layer check only):\n')
        for p in others:
            try:
                od = pymupdf.open(str(p))
                txt = sum(1 for i in range(od.page_count) if len(od[i].get_text().strip()) > 200)
                img = sum(1 for i in range(od.page_count) if od[i].get_images())
                w(f'- `{p.name}`: {p.stat().st_size:,} bytes, sha256 `{sha256(p)}`, {od.page_count} pages, '
                  f'{txt} pages with a text layer, {img} pages with images'
                  + (' -> image-only, would need OCR' if txt == 0 else ''))
            except Exception as e:  # pragma: no cover
                w(f'- `{p.name}`: could not open ({e})')
        w('')
    w('## Page ranges parsed (PDF page index, 1-based)\n')
    w('| Section | Rows | PDF pages |')
    w('|---|---:|---|')
    names = {'LIST': 'Lista de alimentos (not used for values)', 'IDENT': 'Tabla de identificación',
             'PROX': 'Análisis proximal', 'MIN': 'Minerales', 'VITA': 'Vitaminas liposolubles (A)',
             'HYD': 'Vitaminas hidrosolubles', 'FAT': 'Ácidos grasos (first page of each block)',
             'SUGAR': 'Anexo A C3 azúcares', 'AFIBER': 'Anexo A C6 fibra', 'EDIBLE': 'Anexo B parte comestible'}
    for s in ('LIST', 'IDENT', 'PROX', 'MIN', 'VITA', 'HYD', 'FAT', 'SUGAR', 'AFIBER', 'EDIBLE'):
        w(f'| {names[s]} | {len(sections.get(s, []))} | {ranges(pages_used.get(s, []))} |')
    w('\nTables recognised but not used (header starts): ' +
      '; '.join(f'{k} (x{n})' for k, n in ignored.most_common()) + '\n')
    w('## Column mapping\n')
    w('| TCAC section | TCAC column (unit) | Contract code | Contract unit | Note |')
    w('|---|---|---|---|---|')
    for sec, col, code, unit, note in COLUMN_DOC:
        w(f'| {sec} | {col} | {code} | {unit} | {note} |')
    w('\nDropped (not in contract): desviación / calificación columns, cenizas, yodo, flúor, manganeso, '
      'tiamina, riboflavina, niacina, ácido pantoténico, piridoxina, individual fatty acids, amino acids, '
      'Anexo A C1/C2/C4/C5/C7/C8 (mono/disaccharides, starch, amylose, pectin, crude fibre), Anexo C. '
      'Not provided by TCAC 2015 (always null): vitD, vitE, addedSugars.\n')
    w(f'- {b12_note}')
    w(f'- {fol_note}')
    w('- Vitamin A is given in ER (µg retinol equivalents, converted by ICBF from IU). Stored unchanged in '
      '`vitA` (the contract labels it ER/RAE; RE is not RAE for carotenoid sources — RE overstates vs RAE).')
    w('- Empty cells -> null (unknown). Values "Tr"/"trazas" -> 0 with flag `trace_as_zero` '
      f'(occurrences: {sum(1 for f in foods if f["trace"])} foods). Unparseable cells -> null '
      f'({len(unparsed)} cells, listed below).\n')
    w('### Carbohydrate basis\n')
    w('TCAC prints a single column "Carbohidratos por diferencia". Methodology §3.2.2 says the difference '
      'subtracts dietary fibre when it was measured, otherwise it is total carbohydrate. The script decides per '
      'food with a closure test: if water+protein+fat+ash+carbs+fibre ≈ 100 the printed value excludes fibre '
      '(`carbsAvail` = printed, `carbs` = printed + fibre, flag `carbs_total_derived`); otherwise the printed '
      'value is total (`carbs` = printed, and when fibre is known `carbsAvail` = carbs − fibre, flag '
      '`carbs_avail_derived`). Energy in TCAC was computed from the printed value, so the Atwater check uses it.')
    cb = Counter(f.get('carb_basis') for f in foods)
    w(f'\nResult: printed=total {cb.get("total", 0)}, printed=available {cb.get("avail", 0)}, '
      f'no carbs {cb.get(None, 0)}.\n')
    w('### Kind and synonyms\n')
    w('- kind: group "Alimentos preparados" -> `prepared`; else name contains cocido/hervido/frito/asado/'
      'horneado/sudado/guisado/al vapor/tostado/cocinado/sofrito/apanado/ahumado/escaldado (any gender/number) '
      '-> `cooked`; else crudo/fresco -> `raw`; else `generic`.')
    w('- synonyms: "Nombre regional o alternativo" from the identification table, lowercase, accent-free, '
      'stop-words removed; omitted when it adds nothing beyond the food name.\n')
    w('### Flags\n')
    fc = Counter(t.split('=')[0] for r in rows for t in (r[11] or '').split(';') if t)
    glossary = {
        'per_edible_portion': 'values per 100 g edible portion (all rows)',
        'edible_pct': 'edible fraction (%) from Anexo B (TCAC 2000 data)',
        'trace_as_zero': 'a "Tr"/"trazas" cell was stored as 0',
        'carbs_total_derived': 'printed carbs excluded fibre: carbs = printed + fibre, carbsAvail = printed',
        'carbs_avail_derived': 'printed carbs are total: carbsAvail = carbs - fibre',
        'carbs_basis_unverified': 'fibre known but closure test impossible (missing water/ash); printed taken as total',
        'fiber_from_annex': 'fibre taken from Anexo A C6 because the proximal table has none',
        'fatty_acids_inconsistent_dropped': 'sat/mono/poly look like % of total fatty acids or exceed total fat by >25 %: all four nulled',
        'fatty_acid_gt_fat_dropped': 'a single fatty-acid value exceeded total fat: that value nulled',
        'fatty_acid_sum_gt_fat': 'sat+mono+poly exceeds total fat by 5-25 % (kept, informational)',
        'sugars_gt_carbs_dropped': 'Anexo A sugars exceeded total carbs (probably dry basis): sugars nulled',
        'macro_sum_gt_105': 'protein+fat+carbs > 105 g as printed in the PDF (source inconsistency, kept)',
        'multi_entry_minerals': 'minerals table repeats this food; most complete entry used, gaps filled from the others',
        'multi_entry_vita': 'same, vitamin A table', 'multi_entry_hydrovit': 'same, water-soluble vitamins table',
        'multi_entry_fattyacids': 'same, fatty-acid table', 'multi_entry_sugars': 'same, Anexo A sugars',
        'multi_entry_fiber': 'same, Anexo A fibre',
        'dup_code_in_source': 'the proximal table prints this code twice with different values; second gets suffix -2',
        'no_proximal': 'emitted only with --include-no-proximal: no energy/macros in TCAC',
    }
    w('| flag | rows | meaning |')
    w('|---|---:|---|')
    for k, n in fc.most_common():
        w(f'| `{k}` | {n} | {glossary.get(k, "")} |')
    w('')
    w('## Counts per group\n')
    w('| Category | Foods | raw | cooked | prepared | generic |')
    w('|---|---:|---:|---:|---:|---:|')
    kinds = defaultdict(Counter)
    for r in rows:
        kinds[r[5]][r[6]] += 1
    for g, n in sorted(counts_group.items(), key=lambda x: str(x[0])):
        k = kinds[g]
        w(f'| {g} | {n} | {k["raw"]} | {k["cooked"]} | {k["prepared"]} | {k["generic"]} |')
    w(f'| **Total** | **{len(rows)}** | | | | |\n')
    w('## Null rate per nutrient\n')
    w('| Code | Non-null | Null % |')
    w('|---|---:|---:|')
    for c in NUTRIENT_ORDER:
        nn = sum(1 for r in rows if r[8][NIDX[c]] is not None)
        w(f'| {c} | {nn} | {100 * (1 - nn / len(rows)):.1f} |')
    w('\n## Plausibility\n')
    w(f'- Checks: protein+fat+carbs ≤ 105 g, water ≤ 100 g, kcal ≤ 900, kJ ≈ 4.184·kcal (±3 %), '
      f'no negatives. Flags: {len(plaus)}')
    for p in plaus:
        w(f'  - `{p[0]}` {p[1]}: {p[2]}')
    dropped = [(f['row'][0], f['row'][1], d) for f in foods for d in f.get('dropped', [])]
    w(f'- Component larger than its parent (impossible per 100 g) -> component set to null and flagged: '
      f'{len(dropped)}')
    for rid, nm, (comp, cv, parent, pv) in dropped:
        w(f'  - `{rid}` {nm}: {comp}={cv} > {parent}={pv}')
    at_pct = 100.0 * at_pass / at_n if at_n else 0
    w(f'- Atwater (kcal vs 4·protein + 4·carbs(printed) + 9·fat, tolerance 25 % or 5 kcal): '
      f'**{at_pass}/{at_n} = {at_pct:.1f} %** pass.\n')
    if outliers:
        w('### Atwater outliers\n')
        w('| id | name | kcal printed | kcal calc | dev % |')
        w('|---|---|---:|---:|---:|')
        for o in sorted(outliers, key=lambda x: -abs(x[4])):
            w(f'| `{o[0]}` | {o[1]} | {o[2]} | {o[3]} | {o[4]} |')
        w('')
    w('## Golden check\n')
    if gres is None:
        w(f'- {gfails[0]}\n')
    else:
        w(f'Values read manually from the rendered PDF pages, stored in `{args.golden.name}`, compared '
          'exactly to the parsed output.\n')
        w('| id | name | result | values checked | failures |')
        w('|---|---|---|---:|---:|')
        for g in gres:
            w(f'| `{g[0]}` | {g[1]} | {g[2]} | {g[3]} | {g[4]} |')
        for f in gfails:
            w(f'- FAIL {f}')
        w('')
    w('## Join diagnostics\n')
    w('Secondary-table rows are joined to proximal foods by code + normalised name. "unmatched" rows '
      'belong to foods that have no proximal row (see LIST:not_emitted), except where noted.\n')
    for k, v in sorted(stats.items()):
        w(f'- **{k}**: {len(v)}')
        for x in v:
            w(f'  - {x}')
    if unparsed:
        w('\n### Unparsed cells (stored as null)\n')
        for u in unparsed:
            w(f'- `{u[0]}` {u[1]} — {u[2]}: {u[3]!r}')
    w('\n## Random samples (parsed vs raw PDF row text)\n')
    w('```')
    w('\n\n'.join(sample_txt))
    w('```\n')
    w('## Known parsing limitations\n')
    w('- The "Código FAO" column is truncated in the PDF (often just a letter); ids use the numeric '
      '"Número de identificación"/"Código provisional", which is the TCAC consecutive code.')
    w('- Duplicate codes inside the proximal table get suffixes `-2`, `-3` in document order and the flag '
      '`dup_code_in_source`; secondary tables are joined by code + normalised name (then by occurrence).')
    n_ne = len(stats.get('LIST:not_emitted(no_proximal)', []))
    w(f'- {n_ne} foods of the master list (967 entries) have no row in the proximal table, so no energy or '
      'macros; they are not emitted by default (TCAC methodology keeps only foods whose energy can be '
      'computed). `--include-no-proximal` emits those that have any nutrient value, flagged `no_proximal`.')
    w('- Source inconsistencies are kept unless physically impossible (see Plausibility); impossible '
      'components are nulled, never "fixed".')
    w('- Column assignment relies on the vector table geometry; a cell whose text crosses a column line '
      'would be split by word centre (not observed in the golden checks).')
    w('- Vitamin D/E, added sugars and carbohydrates "disponibles" as a printed column do not exist in TCAC 2015.')
    w('- Parte comestible comes from TCAC 2000 (as stated in Anexo B).')
    w('- Categories are the TCAC group names without the letter prefix.')
    w('\n## Run log\n')
    w('```')
    w('\n'.join(log))
    w('```')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text('\n'.join(L) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
