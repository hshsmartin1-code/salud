import { describe, expect, it } from 'vitest'
import { describeError, makeThrottle } from './globalErrors'

describe('global error reporting', () => {
  it('shows at most one toast every 10 s', () => {
    let t = 0
    const allow = makeThrottle(10_000, () => t)
    expect(allow()).toBe(true)
    t = 5_000
    expect(allow()).toBe(false)
    t = 9_999
    expect(allow()).toBe(false)
    t = 10_000
    expect(allow()).toBe(true)
  })
  it('describes only name and message, never data', () => {
    const e = Object.assign(new Error('Quota exceeded'), { row: { weightKg: 72.5, notes: 'privado' } })
    expect(describeError(e)).toBe('Error: Quota exceeded')
    expect(describeError({ name: 'AbortError', weightKg: 80 })).toBe('AbortError')
    expect(describeError({ weightKg: 80 })).toBe('valor no Error (object)')
    expect(describeError('72,5 kg')).toBe('valor no Error (string)')
    expect(describeError(null)).toBe('valor no Error (null)')
  })
})
