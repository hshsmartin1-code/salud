import { describe, expect, it } from 'vitest'
import { todayLocal } from '../domain/dates'
import { msUntilNextMidnight } from './useToday'

// Bogota is UTC-5 all year (no DST): local midnight = 05:00 UTC.
const at = (iso: string) => new Date(iso)

describe('msUntilNextMidnight (APP_TZ, no DST)', () => {
  it.each([
    ['2026-11-15T04:59:59.000Z', 1_000], // 23:59:59 local
    ['2026-11-15T04:59:59.900Z', 100], // 23:59:59.900 local
    ['2026-11-15T05:00:00.000Z', 86_400_000], // exactly midnight → the next one
    ['2026-11-15T05:00:00.001Z', 86_399_999],
    ['2026-11-15T17:00:00.000Z', 12 * 3_600_000], // noon local
    ['2026-11-16T04:00:00.000Z', 3_600_000], // 23:00 local
  ])('%s → %d ms (+ margin)', (iso, ms) => {
    expect(msUntilNextMidnight(at(iso), 'America/Bogota', 0)).toBe(ms)
  })

  it('the margin lands the timer on the new local day', () => {
    const now = at('2026-11-15T04:59:58.000Z')
    const fire = new Date(now.getTime() + msUntilNextMidnight(now))
    expect(todayLocal(now)).toBe('2026-11-14')
    expect(todayLocal(fire)).toBe('2026-11-15')
  })

  it('is never negative and never more than a day plus margin', () => {
    for (let h = 0; h < 48; h++) {
      const ms = msUntilNextMidnight(new Date(Date.UTC(2026, 0, 1, h, 17, 3, 250)), 'America/Bogota', 0)
      expect(ms).toBeGreaterThan(0)
      expect(ms).toBeLessThanOrEqual(86_400_000)
    }
  })

  it('works across month and year boundaries', () => {
    const now = at('2027-01-01T04:30:00.000Z') // 31 dic 23:30 local
    expect(msUntilNextMidnight(now, 'America/Bogota', 0)).toBe(30 * 60_000)
    expect(todayLocal(new Date(now.getTime() + msUntilNextMidnight(now)))).toBe('2027-01-01')
  })
})
