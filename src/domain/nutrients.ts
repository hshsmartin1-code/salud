import { NUTRIENTS, NUTRIENT_CODES } from '../db/catalogTypes';
import type { NutrientCode, NutrientMap } from '../db/catalogTypes';

export const CORE_NUTRIENTS: readonly NutrientCode[] = [
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugars',
  'satFat',
  'sodium',
];

function known(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Positional array (null = unknown) → sparse map. */
export function rowToNutrientMap(values: (number | null)[], order: readonly NutrientCode[]): NutrientMap {
  const out: NutrientMap = {};
  for (let i = 0; i < order.length; i++) {
    const v = values[i];
    if (known(v)) out[order[i]!] = v;
  }
  return out;
}

/** Multiply known values only; unknown stays unknown. */
export function scaleNutrients(per: NutrientMap, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const code of NUTRIENT_CODES) {
    const v = per[code];
    if (known(v)) out[code] = v * factor;
  }
  return out;
}

export function sumNutrients(
  items: { nutrients: NutrientMap }[],
  codes: readonly NutrientCode[] = NUTRIENT_CODES,
): { totals: NutrientMap; partial: NutrientCode[]; missingCount: Partial<Record<NutrientCode, number>> } {
  const totals: NutrientMap = {};
  const partial: NutrientCode[] = [];
  const missingCount: Partial<Record<NutrientCode, number>> = {};
  if (items.length === 0) return { totals, partial, missingCount };
  for (const code of codes) {
    let sum = 0;
    let have = 0;
    for (const it of items) {
      const v = it.nutrients[code];
      if (known(v)) {
        sum += v;
        have++;
      }
    }
    if (have === 0) continue; // unknown for every item → unknown total
    totals[code] = sum;
    if (have < items.length) {
      partial.push(code);
      missingCount[code] = items.length - have;
    }
  }
  return { totals, partial, missingCount };
}

/** Fraction (0..1) of `codes` that are known. */
export function completeness(map: NutrientMap, codes: readonly NutrientCode[] = CORE_NUTRIENTS): number {
  if (codes.length === 0) return 1;
  let n = 0;
  for (const c of codes) if (known(map[c])) n++;
  return n / codes.length;
}

/** Atwater general factors: 4·P + 4·C + 9·F. Needs all three. */
export function atwaterKcal(map: NutrientMap): number | undefined {
  const { protein, carbs, fat } = map;
  if (!known(protein) || !known(carbs) || !known(fat)) return undefined;
  return 4 * protein + 4 * carbs + 9 * fat;
}

/** Compare declared kcal with the Atwater estimate. ok = true when not computable. diffPct is signed (declared vs expected). */
export function atwaterCheck(
  map: NutrientMap,
  tolerance = 0.25,
): { ok: boolean; expected?: number; diffPct?: number } {
  const expected = atwaterKcal(map);
  const kcal = map.kcal;
  if (expected === undefined || !known(kcal)) return { ok: true };
  if (expected === 0) return { ok: kcal <= 5, expected };
  const diff = (kcal - expected) / expected;
  return { ok: Math.abs(diff) <= tolerance, expected, diffPct: diff * 100 };
}

const UNIT_BY_CODE = new Map<NutrientCode, string>(NUTRIENTS.map((n) => [n.code, n.unit]));

export function roundNutrient(code: NutrientCode, v: number): number {
  const unit = UNIT_BY_CODE.get(code);
  const r1 = Math.round(v * 10) / 10;
  switch (unit) {
    case 'kcal':
    case 'kJ':
      return Math.round(v);
    case 'mg':
      return Math.abs(v) >= 10 ? Math.round(v) : r1;
    default:
      return r1; // g, µg
  }
}

export function formatNutrient(code: NutrientCode, v: number | undefined, withUnit = true): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const r = roundNutrient(code, v);
  const s = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, useGrouping: 'always' }).format(r);
  return withUnit ? `${s} ${UNIT_BY_CODE.get(code) ?? ''}`.trim() : s;
}
