import { parseDecimal, textRangeError } from '../../domain/units'
import type { LabelBasis } from '../../domain/labelConvert'

/**
 * Hard ceiling for one typed label value: a nutrient cannot weigh more than the amount it describes
 * (100 g/ml, the serving or the package), and energy cannot exceed 9 kcal (≈ 38 kJ) per gram. "1.200"
 * is 1200 (see parseDecimal), so "Proteína 1.200 g" per 100 g is rejected instead of saved with a
 * warning. Softer consistency checks stay as warnings in checkLabelDraft.
 */
export function labelBaseAmount(basis: LabelBasis, servingSize: number | null, packageSize: number | null): number {
  if (basis === '100g' || basis === '100ml') return 100
  if (basis === 'serving') return servingSize && servingSize > 0 ? servingSize : 1000
  return packageSize && packageSize > 0 ? packageSize : 5000
}

const PER_GRAM: Record<string, number> = { g: 1, mg: 1000, 'µg': 1_000_000, kcal: 9, kJ: 38 }

export function labelValueError(text: string | undefined, unit: string, base: number, baseUnit: 'g' | 'ml' | null = 'g'): string | null {
  // Without a measured density, ml cannot impose a mass or energy ceiling. Dense syrups can
  // legitimately exceed 100 g of carbohydrate per 100 ml. Keep syntax and sign validation.
  if (baseUnit !== 'g') {
    if (!text?.trim()) return null
    const n = parseDecimal(text)
    return n === null ? 'Número no válido' : n < 0 ? 'El valor no puede ser negativo.' : null
  }
  const factor = PER_GRAM[unit] ?? 1000
  return textRangeError(text, 0, Math.ceil(base * factor * 1.02), unit)
}
