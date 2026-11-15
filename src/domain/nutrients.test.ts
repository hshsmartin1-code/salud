import { describe, expect, it } from 'vitest';
import {
  CORE_NUTRIENTS,
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
