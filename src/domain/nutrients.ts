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

/**
 * Energy conversion factors (kcal/g). Colombia, Res. 810/2021 Art. 11.1, Tabla 4: available carbohydrate 4,
 * protein 4, fat 9, alcohol (ethanol) 7. Fibre: 2 kcal/g (Codex CXG 2-1985; Reg. (UE) 1169/2011 Anexo XIV),
 * since Res. 810 refers fibre and polyols to scientific references. Polyols (2,4 kcal/g) are not stored
 * by the app, so they are not part of the check.
 */
export const ENERGY_FACTORS = Object.freeze({ protein: 4, carbsAvail: 4, fat: 9, fiber: 2, alcohol: 7 });
/** Density of ethanol at 20 °C (g/ml), to turn % vol into grams. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

/** Grams of ethanol in 100 ml from an alcohol content in % vol (ml per 100 ml); undefined if not plausible. */
export function alcoholGramsPer100ml(pctVol: number | null | undefined): number | undefined {
  if (!known(pctVol) || pctVol < 0 || pctVol > 100) return undefined;
  return pctVol * ETHANOL_DENSITY_G_PER_ML;
}

export interface AtwaterOptions {
  /**
   * Ethanol in grams for the same basis, when the caller knows it. The food catalogue has no alcohol field
   * (NUTRIENTS), so stored foods are checked without it and alcoholic drinks can look inconsistent.
   */
  alcoholG?: number | null;
  /** Unknown protein / fat / carbohydrate count as 0 (label drafts), as long as one of them is known. */
  missingAsZero?: boolean;
}

/**
 * Energy expected from the macronutrients, the ONE formula shared by every consistency check (catalogue,
 * label drafts, Open Food Facts):
 *   4·P + 9·G + 4·CHOdisp + 2·fibra (+ 7·alcohol when known)
 * CHOdisp = stated available carbohydrate, else max(0, total carbohydrate − fibre): total carbohydrate
 * includes fibre and polyols (Res. 810/2021 Art. 3.8; USDA "by difference"; TCAC). With unknown fibre the
 * total is counted as available (4 kcal/g), the conservative fallback. Needs protein, fat and some
 * carbohydrate figure (unless `missingAsZero`).
 */
export function atwaterKcal(map: NutrientMap, opts: AtwaterOptions = {}): number | undefined {
  const { protein, carbs, carbsAvail, fat, fiber } = map;
  const zero = opts.missingAsZero === true;
  if (zero && !known(protein) && !known(carbs) && !known(carbsAvail) && !known(fat)) return undefined;
  const P = known(protein) ? protein : zero ? 0 : undefined;
  const G = known(fat) ? fat : zero ? 0 : undefined;
  const fib = known(fiber) && fiber > 0 ? fiber : 0;
  const avail = known(carbsAvail) ? carbsAvail : known(carbs) ? Math.max(0, carbs - fib) : zero ? 0 : undefined;
  if (P === undefined || G === undefined || avail === undefined) return undefined;
  const alcohol = known(opts.alcoholG) && opts.alcoholG > 0 ? opts.alcoholG : 0;
  const F = ENERGY_FACTORS;
  return F.protein * P + F.fat * G + F.carbsAvail * avail + F.fiber * fib + F.alcohol * alcohol;
}

/** Compare declared kcal with the Atwater estimate. ok = true when not computable. diffPct is signed (declared vs expected). */
export function atwaterCheck(
  map: NutrientMap,
  tolerance = 0.25,
  opts: AtwaterOptions = {},
): { ok: boolean; expected?: number; diffPct?: number } {
  const expected = atwaterKcal(map, opts);
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
