"""Read public catalogs only; report existing household-portion coverage by source."""
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = (ROOT / 'public/data/foods-usda.json', ROOT / 'public/data/foods-off-co.json')


def main():
    stats = collections.defaultdict(lambda: collections.Counter())
    for path in FILES:
        data = json.loads(path.read_text(encoding='utf-8'))
        for row in data['foods']:
            source = row[0].split(':', 1)[0]
            portions = row[9] or []
            s = stats[source]
            s['foods'] += 1
            s['with_portions'] += bool(portions)
            s['portions'] += len(portions)
            s['with_package'] += any('envase' in label.lower() for label, _ in portions)
            if source == 'off' and 'portion_units_checked' not in str(row[11] or '').split(';'):
                expected = 'ml' if row[7] == '100ml' else 'g'
                usable = 0
                for label, amount in portions:
                    units = re.findall(r'\b\d+(?:[.,]\d+)?\s*(kg|mg|g|gr|ml|cl|dl|l|lt)\b', label, re.I)
                    if len(units) == 1 and ('g' if units[0].lower() in ('kg', 'mg', 'g', 'gr') else 'ml') == expected and amount > 0:
                        usable += 1
            else:
                usable = sum(isinstance(amount, (int, float)) and amount > 0 for _, amount in portions)
            s['usable_portions'] += usable
            s['with_usable'] += usable > 0
    print('source,foods,with_portions,coverage_pct,portions,with_package,with_usable,usable_portions')
    for source, s in sorted(stats.items()):
        print(f"{source},{s['foods']},{s['with_portions']},"
              f"{100 * s['with_portions'] / s['foods']:.1f},{s['portions']},{s['with_package']},"
              f"{s['with_usable']},{s['usable_portions']}")


if __name__ == '__main__':
    main()
