import { describe, expect, it } from 'vitest'
import { buildInsights, MAX_INSIGHTS, type InsightInput } from './insights'

// 2026-11-18 is a Wednesday; its week starts Monday 2026-11-16.
const base: InsightInput = {
  today: '2026-11-18',
  hour: 10,
  kcal7: [null, null, null, null, null, null, null],
  protein7: [null, null, null, null, null, null, null],
  steps7: [null, null, null, null, null, null, null],
  sleep7: [null, null, null, null, null, null, null],
  kcalTarget: 2000,
  proteinTarget: 150,
  stepGoal: 8000,
  sessionDates: [],
  waterTodayMl: 0,
  waterGoalMl: 2500,
  weightDates: [],
}
const ids = (i: Partial<InsightInput>) => buildInsights({ ...base, ...i }).map((x) => x.id)

describe('insights', () => {
  it('says nothing when there is no data', () => {
    expect(buildInsights(base)).toEqual([])
  })

  it('protein: needs 4 logged days and an average under 85 % of target', () => {
    expect(ids({ protein7: [100, 110, 120, null, null, null, null] })).toEqual([])
    const r = buildInsights({ ...base, protein7: [100, 110, 120, 110, null, null, 120] })[0]!
    expect(r.id).toBe('protein-low')
    expect(r.text).toContain('112 g')
    expect(r.text).toContain('75 % del objetivo')
    expect(r.basis).toBe('Basado en 5 de 7 días con registro.')
    expect(r.tone).toBe('attention')
    expect(ids({ protein7: [140, 140, 140, 140, null, null, null] })).toEqual([])
    expect(ids({ protein7: [100, 100, 100, 100, 100, 100, 100], proteinTarget: null })).toEqual([])
  })

  it('energy: only with a target, either direction beyond 15 %', () => {
    expect(ids({ kcal7: [2500, 2500, 2500, 2500, null, null, null] })).toEqual(['energy-off'])
    const low = buildInsights({ ...base, kcal7: [1500, 1500, 1500, 1500, null, null, null] })[0]!
    expect(low.text).toContain('por debajo')
    expect(ids({ kcal7: [2200, 2200, 2200, 2200, null, null, null] })).toEqual([])
    expect(ids({ kcal7: [3000, 3000, 3000, 3000, 3000, 3000, 3000], kcalTarget: null })).toEqual([])
    expect(ids({ kcal7: [3000, 3000, 3000, null, null, null, null] })).toEqual([])
  })

  it('sleep: average under 7 h with at least 4 nights', () => {
    expect(ids({ sleep7: [6, 6, 6, null, null, null, null] })).toEqual([])
    const r = buildInsights({ ...base, sleep7: [6, 6.5, 6, 6.5, null, null, null] })[0]!
    expect(r.id).toBe('sleep-short')
    expect(r.basis).toBe('Basado en 4 de 7 noches con registro.')
    expect(ids({ sleep7: [7, 7.5, 8, 7, null, null, null] })).toEqual([])
  })

  it('steps: under 80 % of the goal with a goal set', () => {
    expect(ids({ steps7: [5000, 5000, 5000, 5000, null, null, null] })).toEqual(['steps-low'])
    expect(ids({ steps7: [7000, 7000, 7000, 7000, null, null, null] })).toEqual([])
    expect(ids({ steps7: [5000, 5000, 5000, 5000, null, null, null], stepGoal: null })).toEqual([])
  })

  it('training: fewer sessions than the same point last week, only if last week had 2+', () => {
    // Wednesday: last week Mon+Tue+Fri (3 total, 2 to date); this week 1 so far.
    const last = ['2026-11-09', '2026-11-10', '2026-11-13']
    expect(ids({ sessionDates: [...last, '2026-11-16'] })).toEqual(['training-behind'])
    expect(ids({ sessionDates: [...last, '2026-11-16', '2026-11-17'] })).toEqual([])
    // Last week had only one session: no comparison.
    expect(ids({ sessionDates: ['2026-11-10'] })).toEqual([])
  })

  it('hydration: below 60 % of goal after 16:00 only', () => {
    expect(ids({ hour: 15, waterTodayMl: 500 })).toEqual([])
    expect(ids({ hour: 16, waterTodayMl: 500 })).toEqual(['water-low'])
    expect(ids({ hour: 18, waterTodayMl: 1600 })).toEqual([])
    expect(ids({ hour: 18, waterTodayMl: 0, waterGoalMl: null })).toEqual([])
  })

  it('weight: a 7-day gap after at least 3 earlier weigh-ins', () => {
    const prior = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']
    const r = buildInsights({ ...base, weightDates: prior })[0]!
    expect(r.id).toBe('weight-gap')
    expect(r.text).toBe('Llevas 8 días sin registrar tu peso.')
    expect(ids({ weightDates: [...prior, '2026-11-16'] })).toEqual([])
    expect(ids({ weightDates: ['2026-11-03', '2026-11-10'] })).toEqual([])
    expect(ids({ weightDates: ['2026-11-13', '2026-11-14', '2026-11-15'] })).toEqual([])
  })

  it('shows at most 3, in fixed priority', () => {
    const all = buildInsights({
      ...base,
      hour: 18,
      protein7: [90, 90, 90, 90, 90, 90, 90],
      kcal7: [2800, 2800, 2800, 2800, 2800, 2800, 2800],
      sleep7: [5, 5, 5, 5, 5, 5, 5],
      steps7: [2000, 2000, 2000, 2000, 2000, 2000, 2000],
      waterTodayMl: 100,
    })
    expect(all.map((x) => x.id)).toEqual(['protein-low', 'energy-off', 'sleep-short'])
    expect(all.length).toBe(MAX_INSIGHTS)
  })

  it('every insight carries a basis and a link', () => {
    const all = buildInsights({ ...base, hour: 18, waterTodayMl: 0, steps7: [1, 1, 1, 1, 1, 1, 1] })
    for (const x of all) {
      expect(x.basis.length).toBeGreaterThan(5)
      expect(x.href.startsWith('/')).toBe(true)
    }
  })
})
