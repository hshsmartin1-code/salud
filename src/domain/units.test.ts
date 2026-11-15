import { describe, expect, it } from 'vitest';
import { formatNumber, labelToPer100, parseDecimal, quantityFactor, validateLabel } from './units';

describe('parseDecimal', () => {
  it.each([
    ['72,5', 72.5],
    ['72.5', 72.5],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['  80 ', 80],
    [',5', 0.5],
    ['1.234.567', 1234567],
    ['0', 0],
  ])('%s → %s', (s, n) => {
    expect(parseDecimal(s)).toBe(n);
  });
  it.each(['', '  ', 'abc', '1,2,3', '1..2', '12kg', '.', '-'])('rejects %j', (s) => {
    expect(parseDecimal(s)).toBeNull();
  });
  it('negatives only with allowNegative', () => {
    expect(parseDecimal('-5')).toBeNull();
    expect(parseDecimal('-5,5', { allowNegative: true })).toBe(-5.5);
    expect(parseDecimal('+5')).toBe(5);
  });
});

describe('formatNumber', () => {
  it('es-CO', () => {
    expect(formatNumber(1234.56)).toBe('1.234,6');
    expect(formatNumber(1234.56, 0)).toBe('1.235');
    expect(formatNumber(2)).toBe('2');
  });
});

describe('quantityFactor', () => {
  it('mass on 100g basis', () => {
    expect(quantityFactor({ qty: 150, unit: 'g', basis: '100g' })).toEqual({ factor: 1.5, grams: 150, ml: null });
    expect(quantityFactor({ qty: 1, unit: 'kg', basis: '100g' })).toEqual({ factor: 10, grams: 1000, ml: null });
    const oz = quantityFactor({ qty: 2, unit: 'oz', basis: '100g' });
    expect('error' in oz).toBe(false);
    if (!('error' in oz)) expect(oz.grams).toBeCloseTo(56.699);
    const lb = quantityFactor({ qty: 1, unit: 'lb', basis: '100g' });
    if (!('error' in lb)) expect(lb.factor).toBeCloseTo(4.53592);
  });
  it('portion and serving on 100g', () => {
    expect(quantityFactor({ qty: 2, unit: 'portion', basis: '100g', portionGrams: 60 })).toEqual({
      factor: 1.2,
      grams: 120,
      ml: null,
    });
    expect('error' in quantityFactor({ qty: 1, unit: 'portion', basis: '100g' })).toBe(true);
    expect(quantityFactor({ qty: 1, unit: 'serving', basis: '100g', servingGrams: 30 })).toEqual({
      factor: 0.3,
      grams: 30,
      ml: null,
    });
    expect('error' in quantityFactor({ qty: 1, unit: 'serving', basis: '100g' })).toBe(true);
  });
  it('volume on 100ml basis', () => {
    expect(quantityFactor({ qty: 250, unit: 'ml', basis: '100ml' })).toEqual({ factor: 2.5, grams: null, ml: 250 });
    expect(quantityFactor({ qty: 0.5, unit: 'l', basis: '100ml' })).toEqual({ factor: 5, grams: null, ml: 500 });
    expect(quantityFactor({ qty: 2, unit: 'portion', basis: '100ml', portionGrams: 120 })).toEqual({
      factor: 2.4,
      grams: null,
      ml: 240,
    });
  });
  it('never invents density', () => {
    const msg = 'Sin densidad conocida: registra en la unidad de la etiqueta';
    expect(quantityFactor({ qty: 100, unit: 'g', basis: '100ml' })).toEqual({ error: msg });
    expect(quantityFactor({ qty: 100, unit: 'ml', basis: '100g' })).toEqual({ error: msg });
    expect(quantityFactor({ qty: 1, unit: 'l', basis: '100g' })).toEqual({ error: msg });
  });
  it('serving basis', () => {
    expect(quantityFactor({ qty: 2, unit: 'serving', basis: 'serving' })).toEqual({ factor: 2, grams: null, ml: null });
    expect('error' in quantityFactor({ qty: 30, unit: 'g', basis: 'serving' })).toBe(true);
  });
  it('rejects invalid quantities', () => {
    for (const qty of [0, -1, NaN, Infinity]) {
      expect('error' in quantityFactor({ qty, unit: 'g', basis: '100g' })).toBe(true);
    }
  });
});

describe('labelToPer100', () => {
  it('per 100 unchanged', () => {
    const r = labelToPer100({ basis: '100g', nutrients: { kcal: 50 } });
    expect(r).toEqual({ basis: '100g', nutrients: { kcal: 50 }, portions: [] });
  });
  it('30 g serving with 120 kcal → 400 kcal/100 g', () => {
    const r = labelToPer100({ basis: 'serving', servingSize: 30, servingUnit: 'g', nutrients: { kcal: 120, protein: 3 } });
    expect(r.basis).toBe('100g');
    expect(r.nutrients.kcal).toBeCloseTo(400);
    expect(r.nutrients.protein).toBeCloseTo(10);
    expect(r.portions).toEqual([['1 porción', 30]]);
  });
  it('ml serving', () => {
    const r = labelToPer100({ basis: 'serving', servingSize: 200, servingUnit: 'ml', nutrients: { kcal: 90 } });
    expect(r.basis).toBe('100ml');
    expect(r.nutrients.kcal).toBeCloseTo(45);
  });
  it('serving without size stays per serving', () => {
    const r = labelToPer100({ basis: 'serving', nutrients: { kcal: 90 } });
    expect(r).toEqual({ basis: 'serving', nutrients: { kcal: 90 }, portions: [] });
  });
  it('does not turn unknown into zero', () => {
    const r = labelToPer100({ basis: 'serving', servingSize: 50, servingUnit: 'g', nutrients: { kcal: 100 } });
    expect('fiber' in r.nutrients).toBe(false);
  });
});

describe('validateLabel', () => {
  it('clean label', () => {
    const r = validateLabel({ basis: '100g', nutrients: { kcal: 165, protein: 10, carbs: 20, fat: 5 } });
    expect(r).toEqual({ errors: [], warnings: [] });
  });
  it('errors: negative and missing kcal', () => {
    const r = validateLabel({ basis: '100g', nutrients: { protein: -1 } });
    expect(r.errors).toHaveLength(2);
  });
  it('warnings', () => {
    const r = validateLabel({
      basis: 'serving',
      servingSize: 30,
      servingUnit: 'g',
      nutrients: { kcal: 10, protein: 10, carbs: 20, fat: 5, sugars: 25, satFat: 6, fiber: 21 },
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(5); // macros>serving, atwater, sugars, satFat, fiber
  });
  it('per-100 macros over 100', () => {
    const r = validateLabel({ basis: '100g', nutrients: { kcal: 600, protein: 50, carbs: 40, fat: 30 } });
    expect(r.warnings.some((w) => w.includes('supera'))).toBe(true);
  });
});
