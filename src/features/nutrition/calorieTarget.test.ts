import { describe, expect, it } from 'vitest'
import type { ActivityLog, HealthRecord } from '../../db/types'
import { calorieTarget, dayActivityKcal } from './calorieTarget'

describe('calorieTarget', () => {
  it('is the goal when activity is not added', () => {
    expect(calorieTarget(2000, false, 400)).toEqual({ target: 2000, added: 0 })
  })
  it('adds the day activity when enabled', () => {
    expect(calorieTarget(2000, true, 400)).toEqual({ target: 2400, added: 400 })
  })
  it('missing, zero or negative activity adds nothing even when enabled', () => {
    for (const a of [null, undefined, 0, -50]) expect(calorieTarget(2000, true, a)).toEqual({ target: 2000, added: 0 })
  })
  it('no goal means no target, whatever the setting', () => {
    expect(calorieTarget(null, true, 400)).toEqual({ target: null, added: 0 })
    expect(calorieTarget(undefined, false, null)).toEqual({ target: null, added: 0 })
  })
})

describe('dayActivityKcal', () => {
  const act = (date: string, activeKcal: number | null, extra: Partial<ActivityLog> = {}) =>
    ({ id: `a${date}${activeKcal}`, profileId: 'p', date, activeKcal, ...extra }) as unknown as ActivityLog
  it('sums manual logs of the date and is null without data', () => {
    expect(dayActivityKcal([act('2026-11-18', 200), act('2026-11-18', 100)], [], '2026-11-18')).toBe(300)
    expect(dayActivityKcal([act('2026-11-17', 200)], [], '2026-11-18')).toBeNull()
    expect(dayActivityKcal([], [] as HealthRecord[], '2026-11-18')).toBeNull()
  })
  it('ignores excluded rows', () => {
    expect(dayActivityKcal([act('2026-11-18', 500, { excludeFromStats: true })], [], '2026-11-18')).toBeNull()
  })
})
