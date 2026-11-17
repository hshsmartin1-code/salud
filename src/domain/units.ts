import type { FoodBasis, NutrientMap } from '../db/catalogTypes';
import { atwaterCheck, scaleNutrients } from './nutrients';

/**
 * Parse a user-typed number. ONE rule for every manual field of the app (Spanish, Colombia):
 *
 * - Comma is the decimal separator: "72,5" → 72.5, "0,75" → 0.75, "1,200" → 1.2.
 * - A single dot followed by exactly three digits, after an integer part of 1–3 digits that does not
 *   start with 0, is a thousands separator: "1.200" → 1200, "10.000" → 10000 ("0.500" → 0.5).
 * - Any other single dot is a decimal point: "72.5" → 72.5, "1.25" → 1.25, "1234.567" → 1234.567.
 * - Thousands groups require a 1–3 digit head and exactly three digits per group, all with the
 *   same separator; an optional decimal part uses the OTHER separator and at least one digit
 *   ("1.200,5" → 1200.5; "1,234.5" → 1234.5; "1.234.567" → 1234567).
 * - Only ASCII digits; outer whitespace and an optional + are accepted, - only with allowNegative.
 *   A leading decimal separator is accepted (".5", ",5"); a trailing one or internal whitespace is not.
 *   Everything outside this grammar returns null, including "1.2,3", "1,2.3" and "1.23.456".
 *
 * "1.200" therefore means 1200 everywhere (kcal, mg, ml, g of quantity), as the label OCR reads it
 * for mg/kcal/kJ. Fields where such a value is impossible (kg of body weight, cm of height) must
 * reject it with `rangeError` instead of storing it. Storage formats are unchanged.
 */
export function parseDecimal(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = (input ?? '').trim();
  if (s === '') return null;
  let sign = 1;
  if (s[0] === '-' || s[0] === '+') {
    if (s[0] === '-') {
      if (!opts.allowNegative) return null;
      sign = -1;
    }
    s = s.slice(1);
  }
  let normalized: string;
  if (/^\d+$/.test(s)) {
    normalized = s;
  } else if (/^\d*[.,]\d+$/.test(s)) {
    // Preserve the single-dot ambiguity rule; a single comma is always decimal.
    normalized = /^[1-9]\d{0,2}\.\d{3}$/.test(s) ? s.replace('.', '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    normalized = s.replace(/,/g, '');
  } else {
    return null;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

/**
 * Plausible-range check for a parsed manual value: null when `n` is inside [min, max], otherwise the
 * message to show. An out-of-range value is rejected, never stored or clamped silently.
 */
export function rangeError(n: number | null, min: number, max: number, unit = ''): string | null {
  if (n === null) return 'Número no válido';
  if (n < min || n > max) return `Escribe un valor entre ${formatNumber(min, 2)} y ${formatNumber(max, 2)}${unit ? ` ${unit}` : ''}.`;
  return null;
}

/** `rangeError` for an optional typed field: null when the text is empty, otherwise parse and check. */
export function textRangeError(text: string | undefined, min: number, max: number, unit = ''): string | null {
  if (!text || text.trim() === '') return null;
  return rangeError(parseDecimal(text), min, max, unit);
}

export function formatNumber(n: number, maxDecimals = 1): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
    useGrouping: 'always',
  }).format(n);
}

export type QtyUnit = 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l' | 'serving' | 'portion';

const OZ_G = 28.3495;
const LB_G = 453.592;
const MASS_G: Partial<Record<QtyUnit, number>> = { g: 1, kg: 1000, oz: OZ_G, lb: LB_G };
const VOL_ML: Partial<Record<QtyUnit, number>> = { ml: 1, l: 1000 };

const ERR_DENSITY = 'Sin densidad conocida: registra en la unidad de la etiqueta';

/** Multiplier to apply to the per-basis nutrient map. Never invents a density. */
export function quantityFactor(args: {
  qty: number;
  unit: QtyUnit;
  basis: FoodBasis;
  portionGrams?: number | null;
  servingGrams?: number | null;
}): { factor: number; grams: number | null; ml: number | null } | { error: string } {
  const { qty, unit, basis, portionGrams, servingGrams } = args;
  if (!Number.isFinite(qty) || qty <= 0) return { error: 'La cantidad debe ser un número mayor que 0' };
  const pos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

  if (basis === '100g') {
    const m = MASS_G[unit];
    if (m !== undefined) {
      const grams = qty * m;
      return { factor: grams / 100, grams, ml: null };
    }
    if (unit === 'portion') {
      if (!pos(portionGrams)) return { error: 'Falta el peso de la porción en gramos' };
      const grams = qty * portionGrams;
      return { factor: grams / 100, grams, ml: null };
    }
    if (unit === 'serving') {
      if (!pos(servingGrams)) return { error: 'Falta el peso de la porción de la etiqueta en gramos' };
      const grams = qty * servingGrams;
      return { factor: grams / 100, grams, ml: null };
    }
    return { error: ERR_DENSITY };
  }

  if (basis === '100ml') {
    const v = VOL_ML[unit];
    if (v !== undefined) {
      const ml = qty * v;
      return { factor: ml / 100, grams: null, ml };
    }
    if (unit === 'portion') {
      if (!pos(portionGrams)) return { error: 'Falta el volumen de la porción en ml' };
      const ml = qty * portionGrams;
      return { factor: ml / 100, grams: null, ml };
    }
    if (unit === 'serving') {
      if (!pos(servingGrams)) return { error: 'Falta el volumen de la porción de la etiqueta en ml' };
      const ml = qty * servingGrams;
      return { factor: ml / 100, grams: null, ml };
    }
    return { error: ERR_DENSITY };
  }

  // basis 'serving': only whole label servings, no conversion possible
  if (unit === 'serving') return { factor: qty, grams: null, ml: null };
  return { error: 'Este alimento se registra por porción de la etiqueta: usa la unidad "porción"' };
}

export interface LabelInput {
  basis: 'serving' | '100g' | '100ml';
  servingSize?: number | null;
  servingUnit?: 'g' | 'ml' | null;
  nutrients: NutrientMap;
}

export function labelToPer100(label: LabelInput): {
  basis: FoodBasis;
  nutrients: NutrientMap;
  portions: [string, number][];
} {
  if (label.basis === '100g' || label.basis === '100ml') {
    return { basis: label.basis, nutrients: { ...label.nutrients }, portions: [] };
  }
  const size = label.servingSize;
  if (
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size > 0 &&
    (label.servingUnit === 'g' || label.servingUnit === 'ml')
  ) {
    return {
      basis: label.servingUnit === 'g' ? '100g' : '100ml',
      nutrients: scaleNutrients(label.nutrients, 100 / size),
      portions: [['1 porción', size]],
    };
  }
  return { basis: 'serving', nutrients: { ...label.nutrients }, portions: [] };
}

export function validateLabel(label: LabelInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = label.nutrients;
  const has = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

  for (const [code, v] of Object.entries(n)) {
    if (typeof v === 'number' && v < 0) errors.push(`El valor de "${code}" no puede ser negativo`);
  }
  if (!has(n.kcal)) errors.push('Falta la energía (kcal)');

  const macros = (has(n.protein) ? n.protein : 0) + (has(n.carbs) ? n.carbs : 0) + (has(n.fat) ? n.fat : 0);
  const limit =
    label.basis === 'serving'
      ? typeof label.servingSize === 'number' && label.servingSize > 0
        ? label.servingSize
        : null
      : 100;
  if (limit !== null && macros > limit + 0.05) {
    warnings.push(
      `Proteína + carbohidratos + grasa (${formatNumber(macros)} g) supera el tamaño de la porción o la base (${formatNumber(limit)})`,
    );
  }
  const chk = atwaterCheck(n);
  if (!chk.ok) {
    warnings.push(
      `Las kcal declaradas no coinciden con los macronutrientes (esperadas ≈ ${formatNumber(chk.expected ?? 0, 0)} kcal, diferencia ${formatNumber(chk.diffPct ?? 0, 0)} %)`,
    );
  }
  if (has(n.sugars) && has(n.carbs) && n.sugars > n.carbs + 0.05)
    warnings.push('Los azúcares superan los carbohidratos totales');
  if (has(n.satFat) && has(n.fat) && n.satFat > n.fat + 0.05) warnings.push('La grasa saturada supera la grasa total');
  if (has(n.fiber) && has(n.carbs) && n.fiber > n.carbs + 0.05)
    warnings.push('La fibra supera los carbohidratos totales');
  return { errors, warnings };
}
