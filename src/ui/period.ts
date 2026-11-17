/** Custom ranges travel as a single string value: "custom:2026-11-01..2026-11-14". */
const CUSTOM_RE = /^custom:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/

/** Value of the "custom range" option before a range has been chosen. */
export const CUSTOM_PERIOD = 'custom'

export function makeCustomPeriod(from: string, to: string): string {
  return `custom:${from}..${to}`
}

export function parseCustomPeriod(value: string): { from: string; to: string } | null {
  const m = CUSTOM_RE.exec(value)
  return m ? { from: m[1]!, to: m[2]! } : null
}

export function isCustomPeriod(value: string): boolean {
  return value === CUSTOM_PERIOD || value.startsWith('custom:')
}

/** Error message in Spanish, or null when the range is usable. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Indica las dos fechas'
  if (from > to) return 'La fecha inicial debe ser anterior a la final'
  return null
}
