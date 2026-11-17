import { formatNumber, rangeError } from '../domain/units'
import { numStr, toNum } from './fields'

/** Decimal places implied by a step (0,25 gives 2; 5 gives 0). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  let d = 0
  let s = step
  while (d < 6 && Math.abs(s - Math.round(s)) > 1e-9) {
    s *= 10
    d++
  }
  return d
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f + Math.sign(v) * 1e-9) / f
}

export interface StepperBounds {
  step: number
  min?: number
  max?: number
}

export function clampValue(v: number, { min, max }: Pick<StepperBounds, 'min' | 'max'>): number {
  let r = v
  if (min !== undefined && r < min) r = min
  if (max !== undefined && r > max) r = max
  return r
}

/** Clamp, then round to the step's precision (no floating drift such as 0.1 + 0.2). */
export function normalizeValue(v: number, b: StepperBounds): number {
  return clampValue(roundTo(clampValue(v, b), decimalsOf(b.step)), b)
}

/** One press of minus (dir -1) or plus (dir 1). */
export function stepValue(value: number, dir: 1 | -1, b: StepperBounds): number {
  return normalizeValue(value + dir * b.step, b)
}

/**
 * Parses what the person typed (accepts "72,5"; "1.200" is 1200, see parseDecimal). Null when it is
 * not a number or falls outside min/max: a typed value is never clamped silently.
 */
export function parseStepperText(text: string, b: StepperBounds): number | null {
  const n = toNum(text)
  if (n === null) return null
  const r = roundTo(n, decimalsOf(b.step))
  if ((b.min !== undefined && r < b.min) || (b.max !== undefined && r > b.max)) return null
  return r
}

/** Message for typed text that cannot be used (null when it is fine or empty). */
export function stepperTextError(text: string, b: StepperBounds, unit = ''): string | null {
  if (text.trim() === '') return null
  const n = toNum(text)
  if (n === null) return 'Número no válido'
  if (parseStepperText(text, b) !== null) return null
  const u = unit ? ` ${unit}` : ''
  if (b.min !== undefined && b.max !== undefined) return rangeError(n, b.min, b.max, unit) ?? 'Número no válido'
  if (b.max !== undefined) return `Escribe un valor de hasta ${formatNumber(b.max, 2)}${u}.`
  return `Escribe un valor de al menos ${formatNumber(b.min ?? 0, 2)}${u}.`
}

export function formatStepperValue(v: number, step: number): string {
  return numStr(v, decimalsOf(step))
}

export function atBound(value: number, dir: 1 | -1, { min, max }: Pick<StepperBounds, 'min' | 'max'>): boolean {
  return dir === -1 ? min !== undefined && value <= min : max !== undefined && value >= max
}
