"""Scan public/data/*.json (except the manifest) -> public/data/catalog-manifest.json

Works for food catalogs (format pho-catalog-foods, count = len(foods)) and exercise catalogs
(format pho-catalog-exercises, count = len(exercises)).

Usage: python -I -X utf8 build_manifest.py
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pho_common import OUT_DIR, now_iso  # noqa: E402

MANIFEST = 'catalog-manifest.json'


def build_manifest(out_dir: str = OUT_DIR) -> dict:
    files = []
    for path in sorted(glob.glob(os.path.join(out_dir, '*.json'))):
        name = os.path.basename(path)
        if name == MANIFEST:
            continue
        with open(path, 'rb') as f:
            raw = f.read()
        try:
            doc = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            print(f'  skip {name}: not valid JSON ({e})')
            continue
        if not isinstance(doc, dict) or not str(doc.get('format', '')).startswith('pho-catalog-'):
            print(f'  skip {name}: not a pho catalog file')
            continue
        fmt = doc['format']
        if fmt == 'pho-catalog-foods':
            count = len(doc.get('foods') or [])
        elif fmt == 'pho-catalog-exercises':
            count = len(doc.get('exercises') or [])
        else:
            count = None
        files.append({
            'path': f'data/{name}',
            'format': fmt,
            'source': doc.get('source'),
            'datasetVersion': doc.get('datasetVersion'),
            'license': doc.get('license'),
            'attribution': doc.get('attribution'),
            'count': count,
            'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest(),
        })
    manifest = {'format': 'pho-catalog-manifest', 'version': 1, 'generatedAt': now_iso(), 'files': files}
    out = os.path.join(out_dir, MANIFEST)
    with open(out + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(out + '.tmp', out)
    for e in files:
        print(f"  {e['path']}: {e['format']} count={e['count']} {e['bytes']} B sha256={e['sha256'][:12]}…")
    return manifest


if __name__ == '__main__':
    build_manifest()
