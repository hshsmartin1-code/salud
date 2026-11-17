import { rangeError } from '../../domain/units'

/**
 * Plausible maximum of one logged amount per unit: 5 kg / 5 L of a food, 50 portions. "1.200" is 1200
 * (see parseDecimal), so a typed amount outside this range is rejected with a message, never stored.
 */
const MAX_BY_UNIT: Record<string, number> = { g: 5000, ml: 5000, kg: 5, l: 5, oz: 5000 / 28.3495, lb: 5000 / 453.592, serving: 50, portion: 50 }
const LABEL: Record<string, string> = { g: 'g', ml: 'ml', kg: 'kg', l: 'L', oz: 'oz', lb: 'lb', serving: 'porciones', portion: 'porciones' }

export function maxAmount(unit: string | undefined, mode: 'log' | 'pick' = 'log'): number {
  const max = MAX_BY_UNIT[unit ?? ''] ?? 50
  // A recipe batch can weigh 50 kg; choosing an ingredient is not a single meal.
  if (mode !== 'pick') return max
  return ['g', 'ml', 'kg', 'l', 'oz', 'lb'].includes(unit ?? '') ? max * 10 : 1000
}

/** Null when the amount is usable; otherwise the message. `null` amount = empty or not a number. */
export function amountError(q: number | null, unit: string | undefined, mode: 'log' | 'pick' = 'log'): string | null {
  if (q === null) return null
  if (q <= 0) return 'La cantidad debe ser mayor que 0.'
  return rangeError(q, 0, maxAmount(unit, mode), LABEL[unit ?? ''] ?? '')
}
