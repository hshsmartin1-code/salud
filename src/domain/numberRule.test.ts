import { describe, expect, it } from 'vitest';
import { parseLabelText } from './labelText';
import { parseDecimal, rangeError } from './units';

/**
 * The single rule for manual numbers (see parseDecimal): comma = decimal; a single dot + exactly
 * three digits after a 1–3 digit integer part (no leading 0) = thousands; other dots = decimal.
 */
describe('Spanish number rule (manual fields)', () => {
  it.each<[string, number | null]>([
    // Decimal comma.
    ['72,5', 72.5],
    ['0,75', 0.75],
    [',5', 0.5],
    ['1,25', 1.25],
    ['1,200', 1.2],
    ['1200,5', 1200.5],
    // Dot + three digits = thousands.
    ['1.200', 1200],
    ['1.000', 1000],
    ['1.500', 1500],
    ['10.000', 10000],
    ['999.999', 999999],
    ['2.000', 2000],
    // Other dots = decimal.
    ['72.5', 72.5],
    ['1.25', 1.25],
    ['0.5', 0.5],
    ['0.500', 0.5],
    ['1234.567', 1234.567],
    ['1.2345', 1.2345],
    ['.5', 0.5],
    ['5.', null],
    // Both separators: the last one is the decimal.
    ['1.200,5', 1200.5],
    ['1.234.567,89', 1234567.89],
    ['1,234.5', 1234.5],
    // Repeated separator = thousands groups.
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    // Plain integers and spaces.
    ['80', 80],
    ['  80 ', 80],
    ['0', 0],
    ['1 200', null],
    // Invalid.
    ['', null],
    ['abc', null],
    ['1,2,3', null],
    ['1..2', null],
    ['12kg', null],
    ['1.200.5', null],
    ['-5', null],
    // Strict grammar: malformed grouping, empty parts, whitespace and non-ASCII input.
    ['1.2,3', null],
    ['1,2.3', null],
    ['1,,2', null],
    ['1.23.456', null],
    ['.', null],
    [',', null],
    ['1.', null],
    ['1,', null],
    ['..5', null],
    [',,5', null],
    ['.,5', null],
    [',.5', null],
    ['.1,2', null],
    [',1.2', null],
    ['1.200,', null],
    ['1,200.', null],
    ['1.200,5,6', null],
    ['1,200.5.6', null],
    ['1.234,567.89', null],
    ['1,234.567,89', null],
    ['1234.567,89', null],
    ['1234,567.89', null],
    ['12.34,56', null],
    ['12,34.56', null],
    ['1.234.56', null],
    ['1,234,56', null],
    ['1.2345.678', null],
    ['1,2345,678', null],
    ['1.234.567.', null],
    ['1,234,567,', null],
    ['1 2', null],
    ['1\t200', null],
    ['1\n200', null],
    ['1\u00a0200', null],
    ['1\u202f200', null],
    ['+ 5', null],
    ['++5', null],
    ['+-5', null],
    ['--5', null],
    ['5e2', null],
    ['0x10', null],
    ['NaN', null],
    ['Infinity', null],
    ['１２', null],
    ['١٢', null],
    ['1\u200b2', null],
    ['1'.repeat(310), null],
    // Boundaries that remain accepted.
    ['+5', 5],
    ['+.5', 0.5],
    [' 1.200,50 ', 1200.5],
    ['1,200.5', 1200.5],
    ['12,345,678.90', 12345678.9],
    ['001.234.567', 1234567],
    ['00.500', 0.5],
    ['0001.200', 1.2],
    ['0,000', 0],
  ])('%j → %s', (s, n) => {
    expect(parseDecimal(s)).toBe(n);
  });

  it('negatives only when allowed', () => {
    expect(parseDecimal('-1.200', { allowNegative: true })).toBe(-1200);
    expect(parseDecimal('-0,5', { allowNegative: true })).toBe(-0.5);
  });
});

describe('the rule checked against each field type', () => {
  // Ranges used by the manual fields (body weight, height, kcal, water, glucose, pressure).
  const fields = {
    'peso (kg)': [20, 400, 'kg'],
    'estatura (cm)': [100, 250, 'cm'],
    'kcal': [0, 10000, 'kcal'],
    'agua (ml)': [10, 3000, 'ml'],
    'glucosa (mg/dL)': [20, 600, 'mg/dL'],
  } as const;
  it.each<[keyof typeof fields, string, number | 'rechazado']>([
    ['peso (kg)', '72,5', 72.5],
    ['peso (kg)', '72.5', 72.5],
    ['peso (kg)', '1.200', 'rechazado'],
    ['estatura (cm)', '1.75', 'rechazado'],
    ['estatura (cm)', '175', 175],
    ['kcal', '1.200', 1200],
    ['kcal', '2.150', 2150],
    ['agua (ml)', '1.500', 1500],
    ['agua (ml)', '1,5', 'rechazado'],
    ['glucosa (mg/dL)', '95', 95],
    ['glucosa (mg/dL)', '1.200', 'rechazado'],
  ])('%s: %j → %s', (field, raw, expected) => {
    const [min, max, unit] = fields[field];
    const n = parseDecimal(raw);
    const err = rangeError(n, min, max, unit);
    if (expected === 'rechazado') expect(err).toMatch(/^Escribe un valor entre/);
    else {
      expect(err).toBeNull();
      expect(n).toBe(expected);
    }
  });
  it('rangeError explains the range in Spanish', () => {
    expect(rangeError(1200, 20, 400, 'kg')).toBe('Escribe un valor entre 20 y 400 kg.');
    expect(rangeError(null, 0, 1)).toBe('Número no válido');
  });
});

describe('manual path and label OCR agree', () => {
  it.each(['1.200', '1.250', '2.000', '350', '1.046'])('sodium %s mg reads the same', (raw) => {
    const ocr = parseLabelText(`Por 100 g\nSodio ${raw} mg`).byBasis['100g']?.sodium;
    expect(ocr).toBe(parseDecimal(raw));
  });
  it.each(['1.200', '2.150', '850'])('energy %s kcal reads the same', (raw) => {
    const ocr = parseLabelText(`Por 100 g\nEnergía ${raw} kcal`).byBasis['100g']?.kcal;
    expect(ocr).toBe(parseDecimal(raw));
  });
  it('"1,200 mg": OCR reads 1200 but flags it for confirmation, because the manual rule reads 1,2', () => {
    const n = parseLabelText('Por 100 g\nSodio 1,200 mg').nutrients.find((x) => x.code === 'sodium');
    expect(n).toMatchObject({ value: 1200, uncertain: true });
    expect(parseDecimal('1,200')).toBe(1.2);
  });
  it('grams: OCR flags "1.200 g" as ambiguous; the manual path reads 1200 and the label validation rejects it', () => {
    const p = parseLabelText('Por 100 g\nCarbohidratos 1.200 g');
    expect(p.nutrients.find((n) => n.code === 'carbs')?.uncertain).toBe(true);
    expect(parseDecimal('1.200')).toBe(1200);
    expect(rangeError(parseDecimal('1.200'), 0, 100, 'g')).not.toBeNull();
  });
});
