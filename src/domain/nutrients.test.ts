import { describe, expect, it } from 'vitest';
import {
  CORE_NUTRIENTS,
  alcoholGramsPer100ml,
  atwaterCheck,
  atwaterKcal,
  completeness,
  formatNutrient,
  roundNutrient,
  rowToNutrientMap,
  scaleNutrients,
  sumNutrients,
} from './nutrients';
import { quantityFactor } from './units';

describe('rowToNutrientMap', () => {
  it('omits null/NaN/undefined and keeps zeros', () => {
    const m = rowToNutrientMap([100, null, 0, NaN], ['kcal', 'kj', 'protein', 'carbs']);
    expect(m).toEqual({ kcal: 100, protein: 0 });
    expect('kj' in m).toBe(false);
    expect(rowToNutrientMap([1], ['kcal', 'fat'])).toEqual({ kcal: 1 });
  });
});

describe('scaleNutrients', () => {
  it('scales known values only', () => {
    const f = quantityFactor({ qty: 150, unit: 'g', basis: '100g' });
    if ('error' in f) throw new Error(f.error);
    expect(f.factor).toBe(1.5);
    const s = scaleNutrients({ kcal: 165, protein: 31 }, f.factor);
    expect(s.kcal).toBeCloseTo(247.5);
    expect(s.protein).toBeCloseTo(46.5);
    expect('fat' in s).toBe(false);
  });
});

describe('sumNutrients', () => {
  it('empty list', () => {
    expect(sumNutrients([])).toEqual({ totals: {}, partial: [], missingCount: {} });
  });
  it('marks partial totals and keeps all-unknown omitted', () => {
    const r = sumNutrients([
      { nutrients: { kcal: 100, fiber: 2 } },
      { nutrients: { kcal: 50 } },
      { nutrients: { kcal: 25, fiber: 1 } },
    ]);
    expect(r.totals.kcal).toBe(175);
    expect(r.totals.fiber).toBe(3);
    expect(r.partial).toEqual(['fiber']);
    expect(r.missingCount).toEqual({ fiber: 1 });
    expect('protein' in r.totals).toBe(false);
  });
  it('respects codes argument', () => {
    const r = sumNutrients([{ nutrients: { kcal: 1, fat: 2 } }], ['fat']);
    expect(r.totals).toEqual({ fat: 2 });
  });
});

describe('completeness and Atwater', () => {
  it('completeness', () => {
    expect(completeness({})).toBe(0);
    expect(completeness({ kcal: 1, protein: 1, carbs: 1, fat: 1 })).toBe(0.5);
    const all = Object.fromEntries(CORE_NUTRIENTS.map((c) => [c, 1]));
    expect(completeness(all)).toBe(1);
  });
  it('atwaterKcal', () => {
    expect(atwaterKcal({ protein: 10, carbs: 20, fat: 5 })).toBe(165);
    expect(atwaterKcal({ protein: 10, carbs: 20 })).toBeUndefined();
  });
  it('atwaterKcal: available carbohydrate at 4 kcal/g and fibre at 2 kcal/g (Res. 810/2021 Tabla 4; Codex/UE)', () => {
    // Total carbohydrate includes fibre (Res. 810 Art. 3.8): available = total − fibre.
    expect(atwaterKcal({ protein: 10, carbs: 20, fat: 5, fiber: 6 })).toBe(4 * 10 + 9 * 5 + 4 * 14 + 2 * 6);
    // A stated available carbohydrate wins over total − fibre.
    expect(atwaterKcal({ protein: 10, carbs: 20, carbsAvail: 12, fat: 5, fiber: 6 })).toBe(40 + 45 + 48 + 12);
    expect(atwaterKcal({ protein: 10, carbsAvail: 12, fat: 5 })).toBe(40 + 45 + 48);
    // Fibre larger than the carbohydrate figure (European "available" basis): never negative.
    expect(atwaterKcal({ protein: 2, carbs: 3, fat: 0.6, fiber: 80 })).toBeCloseTo(8 + 5.4 + 0 + 160, 6);
    // Unknown fibre: total carbohydrate counted as available (the previous behaviour).
    expect(atwaterKcal({ protein: 10, carbs: 20, fat: 5 })).toBe(165);
    // Alcohol at 7 kcal/g only when the caller knows it (the catalogue has no alcohol field).
    expect(atwaterKcal({ protein: 0.46, carbs: 3.55, fat: 0 }, { alcoholG: 3.9 })).toBeCloseTo(16.04 + 27.3, 6);
    expect(atwaterKcal({ protein: 10, fat: 5, fiber: 3 })).toBeUndefined();
    // Labels: unknown macros as 0 when at least one is known.
    expect(atwaterKcal({ protein: 10 }, { missingAsZero: true })).toBe(40);
    expect(atwaterKcal({ kcal: 50 }, { missingAsZero: true })).toBeUndefined();
  });
  it('atwaterCheck: a high-fibre food is no longer a false mismatch', () => {
    // Wheat bran, crude (USDA SR 20077, per 100 g): 216 kcal; P 15.55, fat 4.25, CHO 64.51, fibre 42.8.
    const bran = { kcal: 216, protein: 15.55, fat: 4.25, carbs: 64.51, fiber: 42.8 };
    // Old 4·P + 4·C(total) + 9·F = 358 kcal → −40 %: flagged although the declared value is right.
    expect(4 * bran.protein + 4 * bran.carbs + 9 * bran.fat).toBeCloseTo(358.5, 0);
    const chk = atwaterCheck(bran);
    expect(chk.expected).toBeCloseTo(272.9, 0);
    expect(chk.ok).toBe(true);
  });
  it('atwaterCheck: beer only matches when its alcohol is known', () => {
    // Beer, regular (USDA SR 14003, per 100 g): 43 kcal; P 0.46, CHO 3.55, fat 0, alcohol 3.9 g.
    const beer = { kcal: 43, protein: 0.46, carbs: 3.55, fat: 0 };
    expect(atwaterCheck(beer).ok).toBe(false); // without alcohol: 16 kcal expected (known limitation)
    const withAlcohol = atwaterCheck(beer, 0.25, { alcoholG: 3.9 });
    expect(withAlcohol.ok).toBe(true);
    expect(withAlcohol.expected).toBeCloseTo(43.3, 1);
  });
  it('ethanol grams from % vol (density 0,789 g/ml)', () => {
    expect(alcoholGramsPer100ml(4.5)).toBeCloseTo(3.55, 2);
    expect(alcoholGramsPer100ml(0)).toBe(0);
    expect(alcoholGramsPer100ml(-1)).toBeUndefined();
    expect(alcoholGramsPer100ml(101)).toBeUndefined();
    expect(alcoholGramsPer100ml(null)).toBeUndefined();
  });
  it('atwaterCheck', () => {
    expect(atwaterCheck({ kcal: 170, protein: 10, carbs: 20, fat: 5 }).ok).toBe(true);
    const bad = atwaterCheck({ kcal: 300, protein: 10, carbs: 20, fat: 5 });
    expect(bad.ok).toBe(false);
    expect(bad.expected).toBe(165);
    expect(bad.diffPct).toBeCloseTo(81.8, 1);
    expect(atwaterCheck({ kcal: 300 })).toEqual({ ok: true });
    expect(atwaterCheck({ kcal: 300, protein: 10, carbs: 20, fat: 5 }, 1).ok).toBe(true);
  });
});

describe('rounding and formatting', () => {
  it('roundNutrient by unit', () => {
    expect(roundNutrient('kcal', 247.5)).toBe(248);
    expect(roundNutrient('protein', 46.55)).toBe(46.6);
    expect(roundNutrient('sodium', 345.6)).toBe(346);
    expect(roundNutrient('iron', 2.345)).toBe(2.3);
    expect(roundNutrient('vitA', 12.34)).toBe(12.3);
  });
  it('formatNutrient uses Colombian format', () => {
    expect(formatNutrient('kcal', 1234.4)).toBe('1.234 kcal');
    expect(formatNutrient('protein', 12.34)).toBe('12,3 g');
    expect(formatNutrient('protein', 12.34, false)).toBe('12,3');
    expect(formatNutrient('kcal', undefined)).toBe('—');
    expect(formatNutrient('sodium', 1500)).toBe('1.500 mg');
  });
});
