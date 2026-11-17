import { describe, expect, it } from 'vitest'
import { rovingIndex, tabStopIndex } from './roving'
import { deltaState } from './deltaLogic'
import {
  atBound,
  clampValue,
  decimalsOf,
  formatStepperValue,
  normalizeValue,
  parseStepperText,
  stepperTextError,
  stepValue,
} from './stepperLogic'
import { DEFAULT_TOAST_MS, initialToastState, remainingMs, toastReducer } from './toastLogic'
import { CUSTOM_PERIOD, isCustomPeriod, makeCustomPeriod, parseCustomPeriod, validateCustomRange } from './period'
import { popoverPosition } from './menuLogic'
import { litSegments, meterFraction, meterOver } from './meterLogic'

describe('rovingIndex', () => {
  it('moves and wraps with arrows', () => {
    expect(rovingIndex({ key: 'ArrowRight', index: 0, count: 3 })).toBe(1)
    expect(rovingIndex({ key: 'ArrowRight', index: 2, count: 3 })).toBe(0)
    expect(rovingIndex({ key: 'ArrowLeft', index: 0, count: 3 })).toBe(2)
    expect(rovingIndex({ key: 'ArrowDown', index: 1, count: 3 })).toBe(2)
    expect(rovingIndex({ key: 'ArrowUp', index: 0, count: 3 })).toBe(2)
  })
  it('Home and End jump to the ends', () => {
    expect(rovingIndex({ key: 'Home', index: 2, count: 4 })).toBe(0)
    expect(rovingIndex({ key: 'End', index: 0, count: 4 })).toBe(3)
  })
  it('skips disabled entries', () => {
    expect(rovingIndex({ key: 'ArrowRight', index: 0, count: 3, disabled: [false, true, false] })).toBe(2)
    expect(rovingIndex({ key: 'Home', index: 2, count: 3, disabled: [true, false, false] })).toBe(1)
    expect(rovingIndex({ key: 'End', index: 0, count: 3, disabled: [false, false, true] })).toBe(1)
  })
  it('respects orientation and ignores other keys', () => {
    expect(rovingIndex({ key: 'ArrowDown', index: 0, count: 3, orientation: 'horizontal' })).toBeNull()
    expect(rovingIndex({ key: 'ArrowRight', index: 0, count: 3, orientation: 'vertical' })).toBeNull()
    expect(rovingIndex({ key: 'a', index: 0, count: 3 })).toBeNull()
    expect(rovingIndex({ key: 'ArrowRight', index: 0, count: 0 })).toBeNull()
  })
  it('returns null when every entry is disabled', () => {
    expect(rovingIndex({ key: 'ArrowRight', index: 0, count: 2, disabled: [true, true] })).toBeNull()
  })
  it('flips horizontal arrows in rtl', () => {
    expect(rovingIndex({ key: 'ArrowRight', index: 1, count: 3, rtl: true })).toBe(0)
  })
  it('tabStopIndex prefers the selected entry', () => {
    expect(tabStopIndex(1, 3)).toBe(1)
    expect(tabStopIndex(-1, 3)).toBe(0)
    expect(tabStopIndex(0, 3, [true, false, false])).toBe(1)
  })
})

describe('deltaState', () => {
  it('is neutral without goodWhen', () => {
    expect(deltaState(2)).toEqual({ dir: 'up', tone: 'neutral' })
    expect(deltaState(-2)).toEqual({ dir: 'down', tone: 'neutral' })
  })
  it('colours by goodWhen', () => {
    expect(deltaState(-0.6, 'down')).toEqual({ dir: 'down', tone: 'good' })
    expect(deltaState(0.6, 'down')).toEqual({ dir: 'up', tone: 'bad' })
    expect(deltaState(8, 'up')).toEqual({ dir: 'up', tone: 'good' })
  })
  it('zero and NaN are flat and neutral', () => {
    expect(deltaState(0, 'up')).toEqual({ dir: 'flat', tone: 'neutral' })
    expect(deltaState(Number.NaN, 'down')).toEqual({ dir: 'flat', tone: 'neutral' })
  })
})

describe('stepper logic', () => {
  it('derives decimals from the step', () => {
    expect(decimalsOf(1)).toBe(0)
    expect(decimalsOf(0.5)).toBe(1)
    expect(decimalsOf(0.25)).toBe(2)
    expect(decimalsOf(2.5)).toBe(1)
  })
  it('steps without floating drift', () => {
    expect(stepValue(0.1, 1, { step: 0.1 })).toBe(0.2)
    let v = 0
    for (let i = 0; i < 3; i++) v = stepValue(v, 1, { step: 0.1 })
    expect(v).toBe(0.3)
    expect(stepValue(72.4, -1, { step: 0.1 })).toBe(72.3)
  })
  it('clamps to min and max', () => {
    expect(stepValue(0, -1, { step: 1, min: 0 })).toBe(0)
    expect(stepValue(9, 1, { step: 5, max: 10 })).toBe(10)
    expect(clampValue(-3, { min: 0 })).toBe(0)
    expect(normalizeValue(123.456, { step: 0.5, max: 100 })).toBe(100)
  })
  it('parses decimal comma', () => {
    expect(parseStepperText('72,5', { step: 0.1 })).toBe(72.5)
    expect(parseStepperText('1,5', { step: 0.5 })).toBe(1.5)
    expect(parseStepperText('72,56', { step: 0.1 })).toBe(72.6)
    expect(parseStepperText('abc', { step: 1 })).toBeNull()
    expect(parseStepperText('', { step: 1 })).toBeNull()
    // Typed values outside the range are rejected, never clamped ("1.200" kg is not 400 kg).
    expect(parseStepperText('500', { step: 1, max: 200 })).toBeNull()
    expect(parseStepperText('1.200', { step: 0.1, min: 20, max: 400 })).toBeNull()
    expect(parseStepperText('0', { step: 0.1, min: 20, max: 400 })).toBeNull()
    expect(parseStepperText('1,200', { step: 0.1, min: 0, max: 400 })).toBe(1.2)
    expect(parseStepperText('200', { step: 1, max: 200 })).toBe(200)
  })
  it('explains unusable typed text', () => {
    expect(stepperTextError('1.200', { step: 0.1, min: 20, max: 400 }, 'kg')).toBe('Escribe un valor entre 20 y 400 kg.')
    expect(stepperTextError('abc', { step: 1 })).toBe('Número no válido')
    expect(stepperTextError('', { step: 1, max: 5 })).toBeNull()
    expect(stepperTextError('9', { step: 1, max: 5 }, 'L')).toBe('Escribe un valor de hasta 5 L.')
    expect(stepperTextError('72,5', { step: 0.1, min: 20, max: 400 })).toBeNull()
  })
  it('formats with decimal comma', () => {
    expect(formatStepperValue(72.5, 0.1)).toBe('72,5')
    expect(formatStepperValue(80, 0.5)).toBe('80')
    expect(formatStepperValue(2.25, 0.25)).toBe('2,25')
  })
  it('knows when a bound is reached', () => {
    expect(atBound(0, -1, { min: 0 })).toBe(true)
    expect(atBound(1, -1, { min: 0 })).toBe(false)
    expect(atBound(10, 1, { max: 10 })).toBe(true)
    expect(atBound(10, 1, {})).toBe(false)
  })
})

describe('toastReducer', () => {
  it('shows one toast with the default duration', () => {
    const s = toastReducer(initialToastState, { type: 'show', toast: { message: 'Peso guardado' } })
    expect(s.current).toMatchObject({ id: 1, message: 'Peso guardado', duration: DEFAULT_TOAST_MS })
  })
  it('a new toast replaces the old one', () => {
    let s = toastReducer(initialToastState, { type: 'show', toast: { message: 'A' } })
    s = toastReducer(s, { type: 'show', toast: { message: 'B', duration: 8000, actionLabel: 'Deshacer' } })
    expect(s.current).toMatchObject({ id: 2, message: 'B', duration: 8000, actionLabel: 'Deshacer' })
  })
  it('a stale dismiss does not hide a newer toast', () => {
    let s = toastReducer(initialToastState, { type: 'show', toast: { message: 'A' } })
    s = toastReducer(s, { type: 'show', toast: { message: 'B' } })
    expect(toastReducer(s, { type: 'dismiss', id: 1 }).current?.message).toBe('B')
    expect(toastReducer(s, { type: 'dismiss', id: 2 }).current).toBeNull()
    expect(toastReducer(s, { type: 'dismiss' }).current).toBeNull()
  })
  it('falls back to the default for non-positive durations', () => {
    const s = toastReducer(initialToastState, { type: 'show', toast: { message: 'A', duration: 0 } })
    expect(s.current?.duration).toBe(DEFAULT_TOAST_MS)
  })
  it('computes remaining time', () => {
    expect(remainingMs(5000, 1200)).toBe(3800)
    expect(remainingMs(5000, 9000)).toBe(0)
    expect(remainingMs(5000, -5)).toBe(5000)
  })
})

describe('period helpers', () => {
  it('round-trips a custom range', () => {
    const v = makeCustomPeriod('2026-11-01', '2026-11-14')
    expect(isCustomPeriod(v)).toBe(true)
    expect(isCustomPeriod(CUSTOM_PERIOD)).toBe(true)
    expect(isCustomPeriod('30d')).toBe(false)
    expect(parseCustomPeriod(v)).toEqual({ from: '2026-11-01', to: '2026-11-14' })
    expect(parseCustomPeriod('30d')).toBeNull()
  })
  it('validates ranges', () => {
    expect(validateCustomRange('2026-11-01', '2026-11-14')).toBeNull()
    expect(validateCustomRange('2026-11-01', '2026-11-01')).toBeNull()
    expect(validateCustomRange('2026-11-15', '2026-11-14')).toMatch(/anterior/)
    expect(validateCustomRange('', '2026-11-14')).toMatch(/fechas/)
  })
})

describe('meter logic', () => {
  it('computes fraction safely', () => {
    expect(meterFraction(50, 100)).toBe(0.5)
    expect(meterFraction(150, 100)).toBe(1)
    expect(meterFraction(-5, 100)).toBe(0)
    expect(meterFraction(undefined, 100)).toBe(0)
    expect(meterFraction(5, 0)).toBe(0)
    expect(meterFraction(Number.NaN, 10)).toBe(0)
  })
  it('flags more than 5 % over', () => {
    expect(meterOver(104, 100)).toBe(false)
    expect(meterOver(106, 100)).toBe(true)
    expect(meterOver(undefined, 100)).toBe(false)
  })
  it('lights segments within bounds', () => {
    expect(litSegments(3, 5)).toBe(3)
    expect(litSegments(9, 5)).toBe(5)
    expect(litSegments(-1, 5)).toBe(0)
    expect(litSegments(undefined, 5)).toBe(0)
  })
})

describe('popoverPosition', () => {
  const vp = { width: 360, height: 640 }
  const size = { width: 220, height: 200 }
  it('opens below and right-aligned when it fits', () => {
    const p = popoverPosition({ top: 100, bottom: 144, left: 280, right: 324 }, size, vp)
    expect(p).toEqual({ top: 148, left: 104 })
  })
  it('flips above when there is no room below', () => {
    const p = popoverPosition({ top: 560, bottom: 604, left: 280, right: 324 }, size, vp)
    expect(p.top).toBe(560 - 4 - 200)
  })
  it('keeps an 8 px margin from the edges', () => {
    const left = popoverPosition({ top: 10, bottom: 54, left: 0, right: 44 }, size, vp)
    expect(left.left).toBe(8)
    const right = popoverPosition({ top: 10, bottom: 54, left: 330, right: 380 }, size, vp)
    expect(right.left + size.width).toBeLessThanOrEqual(360 - 8)
  })
  it('never leaves the viewport vertically', () => {
    const p = popoverPosition({ top: 10, bottom: 30, left: 100, right: 140 }, { width: 200, height: 700 }, vp)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
})

describe('toast dismissed on profile change', () => {
  it('a dismiss without id clears the visible toast and never runs its action', () => {
    let ran = false
    const shown = toastReducer(initialToastState, { type: 'show', toast: { message: 'Agua registrada', actionLabel: 'Deshacer', onAction: () => void (ran = true) } })
    expect(shown.current).not.toBeNull()
    const cleared = toastReducer(shown, { type: 'dismiss' })
    expect(cleared.current).toBeNull()
    expect(ran).toBe(false)
  })
})
