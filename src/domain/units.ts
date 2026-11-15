import type { FoodBasis, NutrientMap } from '../db/catalogTypes';
import { atwaterCheck, scaleNutrients } from './nutrients';

/**
 * Parse a user-typed decimal. Accepts "72,5", "72.5", "1.234,5", "1,234.5".
 * Two kinds of separators → the LAST one is the decimal. One kind appearing once = decimal;
 * one kind repeated (e.g. "1.234.567") = thousands groups, only if well-formed.
 */
export function parseDecimal(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = (input ?? '').trim().replace(/\s+/g, '');
  if (s === '') return null;
  let sign = 1;
  if (s[0] === '-' || s[0] === '+') {
    if (s[0] === '-') {
      if (!opts.allowNegative) return null;
      sign = -1;
    }
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const grpSep = decSep === '.' ? ',' : '.';
    const decIdx = s.lastIndexOf(decSep);
    const intPart = s.slice(0, decIdx);
    const frac = s.slice(decIdx + 1);
    if (intPart.includes(decSep) || frac.includes(grpSep)) return null;
    normalized = intPart.split(grpSep).join('') + '.' + frac;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    if (count === 1) {
      normalized = s.replace(sep, '.');
    } else if (new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) {
      normalized = s.split(sep).join('');
    } else {
      return null;
    }
  } else {
    normalized = s;
  }
  if (normalized.startsWith('.')) normalized = '0' + normalized;
  if (normalized.endsWith('.')) normalized += '0';
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return sign * n;
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
