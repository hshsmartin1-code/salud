"""Main entry: public food catalogs for the Salud PWA.

  python -I -X utf8 data-pipeline/build_foods.py                # download (cached) + build all + manifest + validate
  python -I -X utf8 data-pipeline/build_foods.py --skip-off     # don't touch OFF (keeps existing foods-off-co.json)
  python -I -X utf8 data-pipeline/build_foods.py --offline      # never hit the network; build from raw/ caches only
  python -I -X utf8 data-pipeline/build_foods.py --skip-usda

Writes public/data/foods-usda.json, public/data/foods-off-co.json, public/data/catalog-manifest.json and
data-pipeline/raw/last_build.json (stats used for REPORT.md).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_manifest  # noqa: E402
import off_foods  # noqa: E402
import usda_foods  # noqa: E402
import validate_foods  # noqa: E402
from pho_common import RAW_DIR, now_iso  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--skip-usda', action='store_true')
    ap.add_argument('--skip-off', action='store_true')
    ap.add_argument('--offline', action='store_true', help='use cached raw downloads only')
    ap.add_argument('--off-refetch', action='store_true', help='retry OFF pages even past a recorded 401 limit')
    args = ap.parse_args(argv)
    stats = {'startedAt': now_iso()}

    if not args.skip_usda:
        print('== USDA FoodData Central')
        if not args.offline:
            usda_foods.download()
        st = usda_foods.build()
        if st['bytes'] > 9_000_000:
            print('  > 9 MB: rebuilding with max 3 portions for FNDDS')
            st = usda_foods.build(fndds_max_portions=3)
            st['reduced'] = 'fndds_max_portions=3'
        stats['usda'] = st

    if not args.skip_off:
        print('== Open Food Facts (Colombia)')
        if not args.offline:
            stats['off_fetch'] = off_foods.fetch(force=args.off_refetch)
        stats['off'] = off_foods.build()

    print('== Manifest')
    stats['manifest'] = build_manifest.build_manifest()
    print('== Validation')
    stats['validation'] = validate_foods.validate()
    stats['finishedAt'] = now_iso()
    with open(os.path.join(RAW_DIR, 'last_build.json'), 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    return 1 if stats['validation']['failures'] else 0


if __name__ == '__main__':
    sys.exit(main())
