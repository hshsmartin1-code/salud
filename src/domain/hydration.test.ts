import { describe, expect, it } from 'vitest'
import { dailyTotals, goalStreak, meanOverRecordedDays, seriesFor, validateGoalMl, validateMl } from './hydration'

const L = (date: string, ml: number) => ({ date, ml })

describe('hydration domain', () => {
  const totals = dailyTotals([L('2026-03-01', 250), L('2026-03-01', 500), L('2026-03-02', 2000), L('2026-03-04', 2100)])
  it('sums per day', () => {
    expect(totals).toEqual({ '2026-03-01': 750, '2026-03-02': 2000, '2026-03-04': 2100 })
    expect(dailyTotals([])).toEqual({})
  })
  it('series uses null for days without records', () => {
    expect(seriesFor(totals, ['2026-03-01', '2026-03-03', '2026-03-04'])).toEqual([750, null, 2100])
  })
  it('mean counts only days with records', () => {
    expect(meanOverRecordedDays(totals, ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'])).toBe((750 + 2000 + 2100) / 3)
    expect(meanOverRecordedDays(totals, ['2026-03-03'])).toBeNull()
  })
  it('streak: today met counts today; today pending does not break', () => {
    const t = { '2026-03-02': 2000, '2026-03-03': 2200, '2026-03-04': 2100 }
    expect(goalStreak(t, 2000, '2026-03-04')).toBe(3)
    expect(goalStreak({ ...t, '2026-03-04': 300 }, 2000, '2026-03-04')).toBe(2)
    expect(goalStreak({ ...t, '2026-03-03': 1000 }, 2000, '2026-03-04')).toBe(1)
    expect(goalStreak(t, null, '2026-03-04')).toBe(0)
    expect(goalStreak({}, 2000, '2026-03-04')).toBe(0)
  })
  it('validation', () => {
    expect(validateMl(250)).toBeNull()
    expect(validateMl(5)).not.toBeNull()
    expect(validateMl(null)).not.toBeNull()
    expect(validateGoalMl(2000)).toBeNull()
    expect(validateGoalMl(100)).not.toBeNull()
  })
})
