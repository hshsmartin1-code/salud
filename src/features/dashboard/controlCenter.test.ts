import { describe, expect, it } from 'vitest'
import type { ActivityLog, BodyMeasurement, DayMark, FoodLog, HealthRecord, ImportedDaily, SleepLog } from '../../db/types'
import { activeKcalByDay, buildAlerts, compare, intakeForStats, seriesFor, sleepByDay, sourcesLabel, stepsByDay, trendWeight, weekWindows, weightByDay } from './controlCenter'

// Synthetic data only.
const base = { profileId: 'p', createdAt: '', updatedAt: '' }
const act = (date: string, steps: number | null, activeKcal: number | null = null, extra: Partial<ActivityLog> = {}): ActivityLog => ({
  ...base,
  id: `a-${date}-${steps}-${activeKcal}`,
  date,
  type: 'caminata',
  steps,
  activeKcal,
  minutes: null,
  distanceKm: null,
  ...extra,
})
const hc = (date: string, metric: HealthRecord['metric'], value: number, extra: Partial<HealthRecord> = {}): HealthRecord => ({
  ...base,
  id: `p|hc:daily:${metric}:${date}`,
  provider: 'health-connect',
  kind: 'daily',
  metric,
  date,
  start: null,
  end: null,
  value,
  unit: '',
  sources: ['com.example.band'],
  externalId: null,
  lastModified: null,
  importedAt: '',
  ...extra,
})

describe('source rules', () => {
  const dates = ['2026-05-01', '2026-05-02', '2026-05-03']
  it('steps: Health Connect aggregate wins over manual logs, never summed', () => {
    const r = stepsByDay([act('2026-05-01', 3000), act('2026-05-01', 2000), act('2026-05-02', 4000)], [hc('2026-05-02', 'steps', 9000)], dates)
    expect(r).toEqual([
      { date: '2026-05-01', value: 5000, source: 'manual' },
      { date: '2026-05-02', value: 9000, source: 'health-connect' },
      { date: '2026-05-03', value: null, source: null },
    ])
  })
  it('excluded imported rows and excluded manual rows are ignored', () => {
    const r = stepsByDay([act('2026-05-01', 3000, null, { excludeFromStats: true })], [hc('2026-05-01', 'steps', 9000, { excluded: true })], dates)
    expect(r[0]!.value).toBeNull()
  })
  it('active kcal follows the same rule and is reported per day', () => {
    const r = activeKcalByDay([act('2026-05-01', null, 250)], [hc('2026-05-01', 'activeKcal', 410)], dates)
    expect(r[0]).toEqual({ date: '2026-05-01', value: 410, source: 'health-connect' })
  })
  it('sleep: a hand-entered night wins over the imported one', () => {
    const s: SleepLog = { ...base, id: 's1', date: '2026-05-02', hours: 7, bedtime: null, waketime: null, quality: null }
    const r = sleepByDay([s], [hc('2026-05-02', 'sleep', 420 + 60), hc('2026-05-03', 'sleep', 390)], dates)
    expect(r.map((x) => x.value)).toEqual([null, 7, 6.5])
    expect(r[2]!.source).toBe('health-connect')
    expect(sourcesLabel(r)).toBe('Registro propio + Health Connect')
  })
  it('sleep: Health Connect sessions (by wake-up date) add up, naps included', () => {
    const night = hc('2026-05-03', 'sleep', 400, { id: 'p|hc:s1', kind: 'record', externalId: 's1', start: '2026-05-02T23:00:00Z' })
    const nap = hc('2026-05-03', 'sleep', 20, { id: 'p|hc:s2', kind: 'record', externalId: 's2', start: '2026-05-03T15:00:00Z' })
    const off = hc('2026-05-01', 'sleep', 300, { id: 'p|hc:s3', kind: 'record', externalId: 's3', excluded: true })
    const r = sleepByDay([], [night, nap, off], dates)
    expect(r.map((x) => x.value)).toEqual([null, null, 7])
  })
  it('weight: manual first, Health Connect weigh-ins fill other days', () => {
    const m: BodyMeasurement = { ...base, id: 'm1', date: '2026-05-01', weightKg: 70.4, circumferences: {}, skinfolds: {}, protocol: null, derived: null }
    const w = (date: string, v: number) => hc(date, 'weight', v, { kind: 'record', id: `p|hc:${date}`, start: `${date}T07:00:00Z` })
    const r = weightByDay([m], [w('2026-05-01', 71), w('2026-05-03', 70.1)])
    expect(r).toEqual([
      { date: '2026-05-01', value: 70.4, source: 'manual' },
      { date: '2026-05-03', value: 70.1, source: 'health-connect' },
    ])
    expect(seriesFor(dates, r)).toEqual([70.4, null, 70.1])
  })
})

describe('trend and comparisons', () => {
  it('trend weight smooths noise and decays across gaps', () => {
    const pts = [
      { date: '2026-05-01', value: 80, source: 'manual' as const },
      { date: '2026-05-02', value: 81, source: 'manual' as const },
      { date: '2026-05-12', value: 78, source: 'manual' as const },
    ]
    const t = trendWeight(pts).map((p) => p.value as number)
    expect(t[0]).toBe(80)
    expect(t[1]).toBeCloseTo(80.1, 5)
    // 10-day gap: weight moves ~65 % of the way toward the new reading.
    expect(t[2]).toBeCloseTo(80.1 + (1 - 0.9 ** 10) * (78 - 80.1), 5)
  })
  it('compare withholds the delta when coverage is low', () => {
    expect(compare([1, 2, 3, null], [1, 1, 1]).delta).toBeCloseTo(1)
    expect(compare([5, null, null], [1, 1, 1]).delta).toBeNull()
    expect(compare([5, null, null], [1, 1, 1]).current).toEqual({ mean: 5, days: 1, total: 3 })
  })
  it('week windows are the 7 complete days before today and the 7 before those', () => {
    const w = weekWindows('2026-05-15')
    expect(w.current[0]).toBe('2026-05-08')
    expect(w.current[6]).toBe('2026-05-14')
    expect(w.previous[0]).toBe('2026-05-01')
    expect(w.previous[6]).toBe('2026-05-07')
  })
})

describe('alerts', () => {
  const now = new Date('2026-05-15T12:00:00Z')
  const baseIn = { today: '2026-05-15', lastExport: null, personalRows: 0, hc: null, adaptiveOn: false, lastWeightDate: null, autoAdjustment: null, now }
  it('no data, no alerts', () => {
    expect(buildAlerts(baseIn)).toEqual([])
  })
  it('backup reminder once there is data worth protecting', () => {
    expect(buildAlerts({ ...baseIn, personalRows: 50 }).map((a) => a.key)).toEqual(['backup'])
    expect(buildAlerts({ ...baseIn, personalRows: 50, lastExport: '2026-05-10T00:00:00Z' })).toEqual([])
    expect(buildAlerts({ ...baseIn, personalRows: 50, lastExport: '2026-04-01T00:00:00Z' })[0]!.text).toContain('44 días')
  })
  it('Health Connect errors outrank staleness; adaptive needs recent weights', () => {
    const a = buildAlerts({ ...baseIn, hc: { status: 'connected', lastSyncAt: null, lastError: 'Permiso revocado' }, adaptiveOn: true, lastWeightDate: '2026-05-01' })
    expect(a.map((x) => x.key)).toEqual(['hc-error', 'weigh'])
    expect(buildAlerts({ ...baseIn, hc: { status: 'connected', lastSyncAt: '2026-05-10T00:00:00Z', lastError: null } })[0]!.key).toBe('hc-stale')
    expect(buildAlerts({ ...baseIn, hc: { status: 'disconnected', lastSyncAt: null, lastError: 'x' } })).toEqual([])
  })
})

describe('the latest weight of a day (Salud, Hoy and the "+" sheet all read weightByDay)', () => {
  const m = (id: string, time: string | null, kg: number, createdAt: string, date = '2026-11-16'): BodyMeasurement => ({
    ...base, id, date, time, createdAt, weightKg: kg, circumferences: {}, skinfolds: {}, protocol: null, derived: null,
  })
  const latest = (rows: BodyMeasurement[]) => weightByDay(rows, []).at(-1)!.value
  it('the later time of day wins whatever the storage order', () => {
    expect(latest([m('b', '07:10', 81.2, '2026-11-16T12:10:00Z'), m('a', '00:12', 79.3, '2026-11-16T05:12:00Z')])).toBe(81.2)
    expect(latest([m('a', '00:12', 79.3, '2026-11-16T05:12:00Z'), m('b', '07:10', 81.2, '2026-11-16T12:10:00Z')])).toBe(81.2)
  })
  it('the same minute is decided by creation instant, then id, never by storage order', () => {
    const first = m('z', '08:00', 80, '2026-11-16T13:00:01Z')
    const second = m('a', '08:00', 79, '2026-11-16T13:00:40Z')
    expect(latest([first, second])).toBe(79)
    expect(latest([second, first])).toBe(79)
  })
  it('a row without time of day is the earliest of its day', () => {
    expect(latest([m('a', null, 70, '2026-11-16T20:00:00Z'), m('b', '06:00', 71, '2026-11-16T11:00:00Z')])).toBe(71)
  })
})

describe('intakeForStats: weekly means count complete days only', () => {
  // null = the food has no value for that nutrient (unknown, never 0).
  const food = (date: string, kcal: number | null, protein: number | null = 20): FoodLog =>
    ({ ...base, id: `f-${date}-${kcal}-${Math.random()}`, date, meal: 'almuerzo', foodRef: 'user:x', name: 'Comida', source: 'user', qty: 1, unit: 'portion', grams: null, ml: null, nutrients: { ...(kcal === null ? {} : { kcal }), ...(protein === null ? {} : { protein }) }, missing: [] }) as FoodLog
  const mark = (date: string, complete: boolean): DayMark => ({ ...base, id: `m-${date}`, date, complete })
  const imp = (date: string, value: number): ImportedDaily => ({ ...base, id: `i-${date}`, date, metric: 'kcal_intake', value, unit: 'kcal' }) as ImportedDaily
  const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
  it('leaves out days marked incomplete, partial days not confirmed, and days without logs', () => {
    const logs = [
      food('2026-11-09', 2000),
      food('2026-11-10', 800), // marked incomplete below
      food('2026-11-11', 1500),
      food('2026-11-11', null), // a food without kcal: partial
      food('2026-11-12', 1700),
      food('2026-11-12', null), // partial but confirmed complete
      food('2026-11-14', 2200),
    ]
    const marks = [mark('2026-11-10', false), mark('2026-11-12', true)]
    const r = intakeForStats(dates, logs, [imp('2026-11-13', 2100), imp('2026-11-15', 1000)], [...marks, mark('2026-11-15', false)])
    expect(r.values).toEqual([2000, null, null, 1700, 2100, 2200, null])
    expect(r.excluded).toBe(3) // 10 (incomplete), 11 (partial), 15 (Phase 0 total of an incomplete day)
    // The weekly mean is no longer pulled down by the incomplete 800-kcal day.
    expect(compare(r.values, r.values).current.mean).toBe((2000 + 1700 + 2100 + 2200) / 4)
  })
  it('protein uses the same rule and never Phase 0 kcal totals', () => {
    const logs = [food('2026-11-09', 2000, 100), food('2026-11-10', 2000, null), food('2026-11-10', 300, 30), food('2026-11-11', 1800, 90)]
    const r = intakeForStats(dates, logs, [imp('2026-11-13', 2100)], [mark('2026-11-11', false)], 'protein')
    expect(r.values).toEqual([100, null, null, null, null, null, null])
    expect(r.excluded).toBe(2)
  })
})
