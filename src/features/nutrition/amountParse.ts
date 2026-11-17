import { parseDecimal } from '../../domain/units'

const VULGAR: Record<string, number> = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 }

/**
 * The amount a person types in the food detail: the app's number rule (`parseDecimal`: comma = decimal,
 * "1.200" = 1200) plus simple fractions: "1/2", "1 1/2", "½", "1½". Null when it is not a number; range checks
 * (`amountError`) stay with the caller. A zero denominator or a fraction of zero is not an amount.
 */
export function parseAmount(input: string): number | null {
  const s = (input ?? '').trim()
  if (s === '') return null
  const plain = parseDecimal(s)
  if (plain !== null) return plain
  const frac = (n: string, d: string): number | null => {
    const den = Number(d)
    return den > 0 ? Number(n) / den : null
  }
  let m = /^(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (m) return frac(m[1]!, m[2]!)
  m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (m) {
    const f = frac(m[2]!, m[3]!)
    return f === null ? null : Number(m[1]) + f
  }
  m = /^(\d*)\s*([½⅓⅔¼¾⅛])$/.exec(s)
  if (m) return Number(m[1] || 0) + VULGAR[m[2]!]!
  return null
}
