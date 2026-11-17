import { describe as suite, expect, it } from 'vitest'
import type { ActivityLog, BodyMeasurement, Habit, HabitLog, HealthRecord, HydrationLog, RecoveryLog, SleepLog, VitalSign } from '../../db/types'
import { dateRange } from '../../domain/dates'
import { compare, seriesFor, sleepByDay, stepsByDay, trendWeight, weightByDay } from '../dashboard/controlCenter'
import { goalFor, METRICS, metricDef } from './metrics'
import {
  bucket,
  buildSeries,
  circularSdMinutes,
  describe,
  emptyHealthInput,
  measuredSeries,
  periodRange,
  previousRange,
  previousSeries,
  sleepConsistency,
  splitByContext,
  splitByMethod,
  summarize,
  trendSeries,
  type HealthInput,
  type HealthPoint,
} from './series'

// Synthetic data only.
const base = { profileId: 'p', createdAt: '2026-01-01T00:00:00Z', updatedAt: '' }
let seq = 0
const id = () => `r${seq++}`
const input = (p: Partial<HealthInput> = {}): HealthInput => ({ ...emptyHealthInput(), ...p })

const body = (date: string, weightKg: number | null, extra: Partial<BodyMeasurement> = {}): BodyMeasurement => ({
  ...base,
  id: id(),
  date,
  weightKg,
  circumferences: {},
  skinfolds: {},
  protocol: null,
  derived: null,
  ...extra,
})
const derived = (protocol: 'jp3_male' | 'dw4', bodyFatPct: number, extra: Partial<NonNullable<BodyMeasurement['derived']>> = {}): NonNullable<BodyMeasurement['derived']> => ({
  estimated: true,
  protocol,
  equation: protocol === 'dw4' ? 'Durnin & Womersley 1974' : 'Jackson & Pollock 1978/1980 (3 pliegues)',
  method: 'texto largo con cifras',
  sum: 50,
  bodyFatPct,
  fatMassKg: 15,
  leanMassKg: 60,
  inputs: { sex: 'male', ageYears: 30, weightKg: 75, heightCm: 175 },
  computedAt: '',
  ...extra,
})
const hc = (date: string, metric: HealthRecord['metric'], value: number | null, extra: Partial<HealthRecord> = {}): HealthRecord => ({
  ...base,
  id: id(),
  provider: 'health-connect',
  kind: 'daily',
  metric,
  date,
  start: null,
  end: null,
  value,
  unit: '',
  sources: [],
  externalId: null,
  lastModified: null,
  importedAt: '',
  ...extra,
})
const act = (date: string, extra: Partial<ActivityLog> = {}): ActivityLog => ({ ...base, id: id(), date, type: 'caminata', steps: null, activeKcal: null, minutes: null, distanceKm: null, ...extra })
const sleepLog = (date: string, hours: number | null, bedtime: string | null = null, waketime: string | null = null, extra: Partial<SleepLog> = {}): SleepLog => ({
  ...base,
  id: id(),
  date,
  hours,
  bedtime,
  waketime,
  quality: null,
  ...extra,
})
const vital = (date: string, kind: VitalSign['kind'], extra: Partial<VitalSign> = {}): VitalSign => ({ ...base, id: id(), date, time: null, kind, value: null, unit: '', ...extra })
const water = (date: string, ml: number): HydrationLog => ({ ...base, id: id(), date, time: null, ml })
const recovery = (date: string, extra: Partial<RecoveryLog> = {}): RecoveryLog => ({ ...base, id: id(), date, energy: null, soreness: null, stress: null, mood: null, restingHr: null, ...extra })
const habit = (name: string, target = 1, extra: Partial<Habit> = {}): Habit => ({ ...base, id: `h-${name}`, name, kind: 'habit', dose: null, target, unit: null, active: true, order: 0, ...extra })
const hlog = (habitId: string, date: string, value = 1): HabitLog => ({ ...base, id: id(), habitId, date, value })

const D1 = '2026-05-01'
const D2 = '2026-05-02'
const D3 = '2026-05-03'
const vals = (ps: HealthPoint[]) => ps.map((p) => p.value)

suite('period helpers', () => {
  it('periodRange ends today and previousRange is the same length right before', () => {
    const r = periodRange('2026-03-02', 30)
    expect(r).toEqual({ from: '2026-02-01', to: '2026-03-02' })
    const p = previousRange(r)
    expect(p).toEqual({ from: '2026-01-02', to: '2026-01-31' })
    expect(previousRange({ from: '2026-05-10', to: '2026-05-10' })).toEqual({ from: '2026-05-09', to: '2026-05-09' })
  })
})

suite('registry', () => {
  it('has unique ids, existing routes and the goals of the profile settings', () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length)
    const routes = new Set(['/cuerpo', '/actividad', '/sueno', '/agua', '/signos', '/habitos'])
    for (const m of METRICS) expect(routes.has(m.route), m.id).toBe(true)
    expect(metricDef('bloodPressure').kind).toBe('range')
    const settings = { addActivityKcal: false, stepGoal: 8000, waterGoalMl: 2500 }
    expect(goalFor('steps', settings)).toBe(8000)
    expect(goalFor('water', settings)).toBe(2500)
    expect(goalFor('weight', settings)).toBeNull()
    expect(goalFor('steps', { stepGoal: null })).toBeNull()
  })
})

suite('buildSeries: one entry per calendar day, null for no data', () => {
  it('returns every day of the range with null where there is nothing', () => {
    const s = buildSeries('steps', input({ activity: [act(D1, { steps: 4000 }), act(D3, { steps: 0 })] }), D1, D3)
    expect(s.map((p) => p.date)).toEqual([D1, D2, D3])
    expect(vals(s)).toEqual([4000, null, 0]) // a real 0 stays 0, a missing day is null
    expect(s[1]).toEqual({ date: D2, value: null, source: null })
  })
  it('spans month and year boundaries', () => {
    expect(buildSeries('water', input(), '2026-12-30', '2027-01-02').map((p) => p.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
  it('ignores rows outside the range', () => {
    expect(vals(buildSeries('water', input({ hydration: [water('2026-04-30', 500), water(D1, 300)] }), D1, D2))).toEqual([300, null])
  })
})

suite('source precedence, no double counting', () => {
  it('weight: hand-entered wins over Health Connect on the same day; HC fills other days', () => {
    const i = input({ body: [body(D1, 80)], health: [hc(D1, 'weight', 99, { kind: 'record' }), hc(D2, 'weight', 79.5, { kind: 'record' })] })
    const s = buildSeries('weight', i, D1, D3)
    expect(s.map((p) => [p.value, p.source])).toEqual([[80, 'manual'], [79.5, 'health-connect'], [null, null]])
  })
  it('steps: Health Connect daily aggregate wins (as the dashboard does) and is never added to manual logs', () => {
    const i = input({ activity: [act(D1, { steps: 3000 }), act(D1, { steps: 2000 }), act(D2, { steps: 4000 })], health: [hc(D2, 'steps', 9000)] })
    const s = buildSeries('steps', i, D1, D2)
    expect(s.map((p) => [p.value, p.source])).toEqual([[5000, 'manual'], [9000, 'health-connect']])
  })
  it('excluded and approximate rows are left out', () => {
    const i = input({
      body: [body(D1, 80, { approx: true }), body(D2, 81, { excludeFromStats: true })],
      activity: [act(D1, { steps: 3000, excludeFromStats: true, minutes: 30 })],
      health: [hc(D1, 'steps', 9000, { excluded: true }), hc(D1, 'weight', 70, { kind: 'record', excluded: true })],
      vitals: [vital(D1, 'spo2', { value: 97, approx: true })],
    })
    for (const m of ['weight', 'steps', 'activeMinutes', 'spo2'] as const) expect(vals(buildSeries(m, i, D1, D2)), m).toEqual([null, null])
  })
  it('active kcal never uses total energy', () => {
    const i = input({ health: [hc(D1, 'totalKcal', 2400), hc(D2, 'activeKcal', 350)], activity: [act(D3, { activeKcal: 200 })] })
    expect(buildSeries('activeKcal', i, D1, D3).map((p) => [p.value, p.source])).toEqual([[null, null], [350, 'health-connect'], [200, 'manual']])
  })
  it('active minutes: hand-entered total wins over Health Connect sessions, which are summed otherwise', () => {
    const i = input({
      activity: [act(D1, { minutes: 20 }), act(D1, { minutes: 15 })],
      health: [hc(D1, 'exercise', 60, { kind: 'record' }), hc(D2, 'exercise', 30, { kind: 'record' }), hc(D2, 'exercise', 20, { kind: 'record' })],
    })
    expect(buildSeries('activeMinutes', i, D1, D2).map((p) => [p.value, p.source])).toEqual([[35, 'manual'], [50, 'health-connect']])
  })
  it('sleep: a hand-entered log wins over Health Connect; Health Connect minutes become hours', () => {
    const i = input({ sleep: [sleepLog(D1, 7)], health: [hc(D1, 'sleep', 300, { kind: 'record' }), hc(D2, 'sleep', 420, { kind: 'record' })] })
    expect(buildSeries('sleep', i, D1, D2).map((p) => [p.value, p.source])).toEqual([[7, 'manual'], [7, 'health-connect']])
  })
  it('resting heart rate: vitals, then the recovery log, then Health Connect', () => {
    const i = input({
      vitals: [vital(D1, 'restingHr', { value: 60 })],
      recovery: [recovery(D1, { restingHr: 70 }), recovery(D2, { restingHr: 64 })],
      health: [hc(D1, 'restingHr', 80), hc(D2, 'restingHr', 81), hc(D3, 'restingHr', 55)],
    })
    expect(buildSeries('restingHr', i, D1, D3).map((p) => [p.value, p.source])).toEqual([[60, 'manual'], [64, 'manual'], [55, 'health-connect']])
  })
  it('phase 0 rows are labelled phase0', () => {
    expect(buildSeries('weight', input({ body: [body(D1, 80, { origin: 'phase0' })] }), D1, D1)[0]!.source).toBe('phase0')
  })
})

suite('several readings in a day', () => {
  it('weight is the latest of the day', () => {
    const i = input({ body: [body(D1, 80, { time: '07:00' }), body(D1, 79.4, { time: '21:00' }), body(D1, 81, { time: '12:00' })] })
    expect(buildSeries('weight', i, D1, D1)[0]!.value).toBe(79.4)
  })
  it('vitals are the mean of the day with the reading count', () => {
    const i = input({ vitals: [vital(D1, 'restingHr', { value: 60 }), vital(D1, 'restingHr', { value: 64 }), vital(D1, 'restingHr', { value: 59 })] })
    const p = buildSeries('restingHr', i, D1, D1)[0]!
    expect(p.value).toBeCloseTo(61, 10)
    expect(p.n).toBe(3)
  })
  it('water, steps and minutes are summed', () => {
    const i = input({ hydration: [water(D1, 250), water(D1, 500)], activity: [act(D1, { steps: 1000, minutes: 10 }), act(D1, { steps: 2500, minutes: 20 })] })
    expect(buildSeries('water', i, D1, D1)[0]!.value).toBe(750)
    expect(buildSeries('steps', i, D1, D1)[0]!.value).toBe(3500)
    expect(buildSeries('activeMinutes', i, D1, D1)[0]!.value).toBe(30)
  })
  it('recovery scales average the day', () => {
    const i = input({ recovery: [recovery(D1, { energy: 2, mood: 5 }), recovery(D1, { energy: 4 })] })
    const p = buildSeries('energyScale', i, D1, D1)[0]!
    expect([p.value, p.n]).toEqual([3, 2])
    expect(buildSeries('moodScale', i, D1, D1)[0]!.value).toBe(5)
  })
  it('waist is the latest of the day', () => {
    const i = input({ body: [body(D1, null, { circumferences: { waist: 90 }, time: '08:00' }), body(D1, null, { circumferences: { waist: 89 }, time: '20:00' })] })
    expect(buildSeries('waist', i, D1, D1)[0]!.value).toBe(89)
  })
})

suite('blood pressure as a range', () => {
  it('low = diastolic, high = systolic, mean of the day', () => {
    const i = input({
      vitals: [
        vital(D1, 'bloodPressure', { systolic: 120, diastolic: 80 }),
        vital(D1, 'bloodPressure', { systolic: 130, diastolic: 70 }),
        vital(D1, 'bloodPressure', { systolic: null, diastolic: 90 }), // incomplete pair: left out
      ],
    })
    const [a, b] = buildSeries('bloodPressure', i, D1, D2)
    expect(a).toMatchObject({ date: D1, value: 125, high: 125, low: 75, n: 2, source: 'manual' })
    expect(b).toEqual({ date: D2, value: null, source: null })
    expect(metricDef('bloodPressure').kind).toBe('range')
  })
})

suite('body composition estimates keep methods apart', () => {
  const i = input({
    profile: { heightCm: 175, settings: { addActivityKcal: false } },
    body: [
      body(D1, 75, { protocol: 'jp3_male', derived: derived('jp3_male', 18) }),
      body(D2, 75, { protocol: 'dw4', derived: derived('dw4', 22) }),
    ],
    health: [hc(D1, 'bodyFat', 25, { kind: 'record' }), hc(D1, 'leanMassKg', 58, { kind: 'record' })],
  })
  it('every point carries its method and is flagged as an estimate', () => {
    const jp = splitByMethod('bodyFat', i, D1, D2).find((s) => s.method.includes('Jackson'))!
    expect(jp.points[0]).toMatchObject({ value: 18, estimated: true, method: jp.method, source: 'manual' })
    expect(jp.points[1]!.value).toBeNull()
  })
  it('splitByMethod returns one series per method, never mixed', () => {
    const split = splitByMethod('bodyFat', i, D1, D2)
    expect(split.map((s) => s.method).sort()).toEqual(['Health Connect', 'Durnin & Womersley 4 pliegues', 'Jackson & Pollock 3 pliegues (hombres)'].sort())
    for (const s of split) expect(new Set(s.points.filter((p) => p.value !== null).map((p) => p.method)).size).toBe(1)
    const hcs = split.find((s) => s.method === 'Health Connect')!
    expect(hcs.points[0]).toMatchObject({ value: 25, source: 'health-connect', estimated: true })
  })
  it('buildSeries picks ONE method (the most recent reading) unless told otherwise', () => {
    const s = buildSeries('bodyFat', i, D1, D2)
    expect(vals(s)).toEqual([null, 22]) // dw4 is the latest reading; the D1 values of other methods are not mixed in
    expect(buildSeries('bodyFat', i, D1, D2, { method: 'Health Connect' })[0]!.value).toBe(25)
  })
  it('fat mass and lean mass come from the same derived record; Health Connect lean mass is its own method', () => {
    expect(buildSeries('fatMass', i, D1, D2)[1]).toMatchObject({ value: 15, estimated: true })
    const lean = splitByMethod('leanMass', i, D1, D2)
    expect(lean.find((s) => s.method === 'Health Connect')!.points[0]!.value).toBe(58)
  })
  it('FFMI needs a height and a lean mass', () => {
    const f = buildSeries('ffmi', i, D1, D2, { method: 'Health Connect' })[0]!
    expect(f.value).toBeCloseTo(58 / 1.75 ** 2, 10)
    expect(f.estimated).toBe(true)
    expect(vals(buildSeries('ffmi', { ...i, profile: { heightCm: null, settings: { addActivityKcal: false } } }, D1, D2))).toEqual([null, null])
    expect(vals(buildSeries('ffmi', { ...i, profile: null }, D1, D2))).toEqual([null, null])
    expect(vals(buildSeries('ffmi', input({ profile: i.profile, body: [body(D1, 75)] }), D1, D2))).toEqual([null, null])
  })
  it('without any estimate the series is all null', () => {
    expect(vals(buildSeries('bodyFat', input(), D1, D3))).toEqual([null, null, null])
  })
})

suite('glucose keeps its context', () => {
  const i = input({
    vitals: [
      vital(D1, 'glucose', { value: 90, context: 'ayunas' }),
      vital(D2, 'glucose', { value: 120, context: 'posprandial' }),
      vital(D3, 'glucose', { value: 90, context: 'ayunas' }),
      vital(D3, 'glucose', { value: 130, context: 'posprandial' }),
    ],
  })
  it('points carry the context; a mixed day is labelled mixto', () => {
    const s = buildSeries('glucose', i, D1, D3)
    expect(s.map((p) => p.context)).toEqual(['ayunas', 'posprandial', 'mixto'])
    expect(s[2]!.value).toBe(110)
  })
  it('can be filtered or split by context', () => {
    expect(vals(buildSeries('glucose', i, D1, D3, { context: 'ayunas' }))).toEqual([90, null, 90])
    const split = splitByContext(i, D1, D3)
    expect(split.map((s) => s.context)).toEqual(['ayunas', 'posprandial'])
    expect(vals(split[1]!.points)).toEqual([null, 120, 130])
  })
})

suite('habit completion', () => {
  const hs = [habit('a'), habit('b'), habit('c', 8), habit('old', 1, { active: false })]
  it('completed ÷ active habits per day; a day with no log at all is a gap', () => {
    const i = input({ habits: hs, habitLogs: [hlog('h-a', D1), hlog('h-b', D1), hlog('h-c', D1, 8), hlog('h-a', D2), hlog('h-c', D2, 3), hlog('h-old', D2)] })
    const s = buildSeries('habits', i, D1, D3)
    expect(s[0]!.value).toBeCloseTo(100, 10)
    expect(s[1]!.value).toBeCloseTo(100 / 3, 10) // only 'a' reached its target; the archived habit does not count
    expect(s[1]!.n).toBe(3)
    expect(s[2]!.value).toBeNull()
  })
  it('a habit created later does not lower earlier days', () => {
    const late = habit('late', 1, { createdAt: '2026-05-03T00:00:00Z' })
    const i = input({ habits: [habit('a'), late], habitLogs: [hlog('h-a', D1), hlog('h-a', D3)] })
    const s = buildSeries('habits', i, D1, D3)
    expect([s[0]!.value, s[0]!.n]).toEqual([100, 1])
    expect([s[2]!.value, s[2]!.n]).toEqual([50, 2])
  })
  it('a habit created in the local evening counts from that local day (not the UTC one)', () => {
    // 2026-05-02T01:30Z is 1 May, 20:30 in Bogotá.
    const evening = habit('evening', 1, { createdAt: '2026-05-02T01:30:00Z' })
    const i = input({ habits: [habit('a'), evening], habitLogs: [hlog('h-a', D1)] })
    const s = buildSeries('habits', i, D1, D1)
    expect([s[0]!.value, s[0]!.n]).toEqual([50, 2])
  })
})

suite('summarize', () => {
  const pts = (xs: (number | null)[], from = D1): HealthPoint[] => xs.map((v, k) => ({ date: dateRange(from, '2026-12-31')[k]!, value: v, source: v === null ? null : 'manual' }))
  it('coverage, mean, min, max, total, latest', () => {
    const s = summarize(pts([10, null, 20, 30, null]), null)
    expect(s).toMatchObject({ mean: 20, min: 10, max: 30, total: 60, coverage: { days: 3, total: 5 }, latest: { date: '2026-05-04', value: 30 }, delta: null })
    expect(summarize([], null)).toMatchObject({ latest: null, mean: null, total: 0, coverage: { days: 0, total: 0 } })
  })
  it('delta equals compare() and is withheld with fewer than minDays days with data in either period', () => {
    const cur = pts([10, 12, 14, null])
    const prev = pts([8, 8, 8, 8])
    expect(summarize(cur, prev).delta).toBe(compare(cur.map((p) => p.value), prev.map((p) => p.value)).delta)
    expect(summarize(cur, prev).delta).toBeCloseTo(4, 10)
    expect(summarize(cur, pts([8, 8, null, null])).delta).toBeNull()
    expect(summarize(pts([10, 12, null, null]), prev).delta).toBeNull()
    expect(summarize(pts([10, 12, null, null]), prev, { minDays: 2 }).delta).toBeCloseTo(3, 10)
  })
  it('trend per week needs 4 points', () => {
    expect(summarize(pts([1, 2, 3]), null).trendPerWeek).toBeNull()
    expect(summarize(pts([1, null, 3, null, 5, 6]), null).trendPerWeek).toBeGreaterThan(0)
    const flat = summarize(pts([5, 5, 5, 5]), null).trendPerWeek
    expect(flat).toBeCloseTo(0, 10)
    const lin = summarize(pts([0, 1, 2, 3, 4, 5, 6, 7]), null).trendPerWeek
    expect(lin).toBeCloseTo(7, 8)
  })
  it('weight also gets the smoothed trend, flagged as calculated, equal to trendWeight', () => {
    const w = buildSeries('weight', input({ body: [body(D1, 80), body(D2, 79), body(D3, 81)] }), D1, D3)
    const s = summarize(w, null, { metricId: 'weight' })
    expect(s.trend?.calculated).toBe(true)
    expect(s.trend!.points.map((p) => p.value)).toEqual(trendWeight(weightByDay([body(D1, 80), body(D2, 79), body(D3, 81)], [])).map((d) => d.value))
    expect(summarize(w, null).trend).toBeUndefined()
  })
  it('range metrics carry the mean of the low side', () => {
    const i = input({ vitals: [vital(D1, 'bloodPressure', { systolic: 120, diastolic: 80 }), vital(D2, 'bloodPressure', { systolic: 130, diastolic: 70 })] })
    expect(summarize(buildSeries('bloodPressure', i, D1, D2), null)).toMatchObject({ mean: 125, meanLow: 75 })
  })
})

suite('bucket', () => {
  const daily = (from: string, to: string, f: (k: number) => number | null): HealthPoint[] => dateRange(from, to).map((date, k) => ({ date, value: f(k), source: 'manual' as const }))
  it('groups ISO Monday weeks across a year boundary', () => {
    // 2026-12-28 is a Monday.
    const bins = bucket(daily('2026-12-28', '2027-01-05', (k) => k + 1), 'week', 'sum')
    expect(bins.map((b) => [b.start, b.end, b.value, b.days, b.span])).toEqual([
      ['2026-12-28', '2027-01-03', 28, 7, 7],
      ['2027-01-04', '2027-01-10', 8 + 9, 2, 2],
    ])
  })
  it('groups calendar months and counts days with data per bin', () => {
    const bins = bucket(daily('2026-01-30', '2026-03-02', (k) => (k % 2 === 0 ? 10 : null)), 'month', 'mean')
    expect(bins.map((b) => [b.start, b.end, b.days, b.span])).toEqual([
      ['2026-01-01', '2026-01-31', 1, 2],
      ['2026-02-01', '2026-02-28', 14, 28],
      ['2026-03-01', '2026-03-31', 1, 2],
    ])
    expect(bins.every((b) => b.value === 10)).toBe(true)
  })
  it('leap-year February ends on the 29th', () => {
    expect(bucket(daily('2028-02-10', '2028-02-11', () => 1), 'month')[0]!.end).toBe('2028-02-29')
  })
  it('day buckets are the points; "last" takes the latest day with data; empty bins are null', () => {
    expect(bucket(daily(D1, D2, (k) => k), 'day').map((b) => b.value)).toEqual([0, 1])
    const bins = bucket(daily(D1, '2026-05-05', (k) => (k >= 3 ? null : k + 1)), 'week', 'last')
    expect(bins.map((b) => [b.start, b.value, b.days])).toEqual([
      ['2026-04-27', 3, 3],
      ['2026-05-04', null, 0],
    ])
  })
  it('range metrics keep low and high', () => {
    const pts: HealthPoint[] = [
      { date: D1, value: 120, high: 120, low: 80, source: 'manual' },
      { date: D2, value: 130, high: 130, low: 70, source: 'manual' },
    ]
    expect(bucket(pts, 'week')[0]).toMatchObject({ value: 125, high: 125, low: 75 })
  })
})

suite('sleep consistency', () => {
  const bed = (times: string[]) => input({ sleep: times.map((t, k) => sleepLog(dateRange('2026-05-01', '2026-05-30')[k]!, 7, t, '06:30')) })
  it('deviation of bedtimes around midnight is small, not ~12 hours', () => {
    const sd = circularSdMinutes([23 * 60 + 50, 10, 23 * 60 + 55, 5, 0])
    expect(sd).not.toBeNull()
    expect(sd!).toBeLessThan(15)
    expect(sd!).toBeGreaterThan(5)
    const c = sleepConsistency(bed(['23:50', '00:10', '23:55', '00:05', '00:00']), '2026-05-01', '2026-05-10')!
    expect(c.bedtimeSdMin).toBeCloseTo(sd!, 8)
    expect(c.wakeSdMin).toBeCloseTo(0, 8)
    expect(c.bedtimeNights).toBe(5)
  })
  it('matches the ordinary sample deviation away from midnight', () => {
    // 22:00, 22:30, 23:00, 23:30, 00:00 -> deviations from the mean -60..+60 min step 30 -> sd = sqrt(2250/ (4/ ... ))
    const m = [22 * 60, 22 * 60 + 30, 23 * 60, 23 * 60 + 30, 24 * 60]
    const mu = m.reduce((a, b) => a + b, 0) / 5
    const sd = Math.sqrt(m.reduce((a, x) => a + (x - mu) ** 2, 0) / 4)
    expect(circularSdMinutes(m.map((x) => x % 1440))).toBeCloseTo(sd, 6)
  })
  it('is null with fewer than 5 nights', () => {
    expect(sleepConsistency(bed(['23:00', '23:10', '23:20', '23:30']), '2026-05-01', '2026-05-10')).toBeNull()
    expect(circularSdMinutes([100])).toBeNull()
    expect(sleepConsistency(input(), '2026-05-01', '2026-05-10')).toBeNull()
  })
  it('bedtime series continues past midnight; Health Connect sleep has no clock times', () => {
    const s = buildSeries('bedtime', bed(['23:30', '00:30']), '2026-05-01', '2026-05-02')
    expect(vals(s)).toEqual([23 * 60 + 30, 24 * 60 + 30])
    expect(vals(buildSeries('bedtime', input({ health: [hc(D1, 'sleep', 400, { kind: 'record', start: '2026-04-30T23:00:00Z' })] }), D1, D1))).toEqual([null])
    expect(vals(buildSeries('wakeTime', bed(['23:30']), D1, D1))).toEqual([6 * 60 + 30])
  })
})

suite('describe', () => {
  const range = { from: '2026-05-01', to: '2026-05-30' }
  const mk = (id: Parameters<typeof buildSeries>[0], cur: (number | null)[], prev: (number | null)[] | null, extra: Partial<HealthPoint> = {}) => {
    const dates = dateRange(range.from, range.to)
    const c: HealthPoint[] = dates.map((date, k) => ({ date, value: cur[k] ?? null, source: 'manual', ...extra }))
    const p: HealthPoint[] | null = prev ? dates.map((date, k) => ({ date, value: prev[k] ?? null, source: 'manual', ...extra })) : null
    return describe(id, summarize(c, p, { metricId: id }), range)
  }
  const rep = (n: number, v: number) => Array.from({ length: n }, () => v)

  it('percent comparison, as in the design example', () => {
    // 26 of 30 days with a mean of 7.412 steps; previous mean 7412 / 1.08 -> +8 %
    const out = mk('steps', rep(26, 7412), rep(30, 7412 / 1.08))
    expect(out).toBe('Media de 7.412 pasos al día, 8 % más que en los 30 días anteriores; 26 de 30 días con dato.')
  })
  it('less, and equal', () => {
    expect(mk('water', rep(30, 1500), rep(30, 2000))).toBe('Media de 1,5 L de agua al día, 25 % menos que en los 30 días anteriores; 30 de 30 días con dato.')
    expect(mk('steps', rep(30, 5000), rep(30, 5000))).toBe('Media de 5.000 pasos al día, igual que en los 30 días anteriores; 30 de 30 días con dato.')
  })
  it('absolute comparison with unit', () => {
    expect(mk('weight', rep(10, 72.4), rep(10, 73))).toBe('Peso medio de 72,4 kg, 0,6 kg menos que en los 30 días anteriores, tendencia de 0 kg por semana; 10 de 30 días con dato.')
  })
  it('weight adds the trend per week when there are at least 4 points', () => {
    const cur = Array.from({ length: 14 }, (_, k) => 80 - k * 0.1)
    const out = mk('weight', cur, null)
    expect(out).toMatch(/^Peso medio de 79,4 kg, tendencia de −0,7 kg por semana; 14 de 30 días con dato\.$/)
  })
  it('sleep and clock times', () => {
    expect(mk('sleep', rep(20, 6.5), rep(20, 7))).toBe('Media de 6 h 30 min de sueño por noche, 30 min menos que en los 30 días anteriores; 20 de 30 días con dato.')
    expect(mk('bedtime', rep(10, 23 * 60 + 12), rep(10, 23 * 60))).toBe('Hora media de acostarse: 23:12, 12 min más tarde que en los 30 días anteriores; 10 de 30 días con dato.')
    expect(mk('bedtime', rep(10, 24 * 60 + 30), null)).toBe('Hora media de acostarse: 00:30; 10 de 30 días con dato.')
  })
  it('blood pressure shows both sides', () => {
    const out = mk('bloodPressure', rep(8, 120), null, { low: 78, high: 120 })
    expect(out).toBe('Presión media de 120/78 mmHg; 8 de 30 días con dato.')
  })
  it('estimates name their method; glucose names its context', () => {
    expect(mk('bodyFat', rep(5, 18.2), null, { method: 'Jackson & Pollock 3 pliegues (hombre)', estimated: true })).toBe('Grasa corporal estimada media de 18,2 %, método Jackson & Pollock 3 pliegues (hombre); 5 de 30 días con dato.')
    expect(mk('glucose', rep(6, 90), null, { context: 'ayunas' })).toBe('Glucosa media de 90 mg/dL, ayunas; 6 de 30 días con dato.')
  })
  it('scales and habits', () => {
    expect(mk('energyScale', rep(10, 3.4), null)).toBe('Media de 3,4 de 5 en energía; 10 de 30 días con dato.')
    expect(mk('habits', rep(10, 62.5), null)).toBe('Media de 63 % de hábitos completados al día; 10 de 30 días con dato.')
  })
  it('withholds the comparison when the previous period has too few days', () => {
    expect(mk('steps', rep(10, 5000), rep(2, 4000))).toBe('Media de 5.000 pasos al día, sin comparación con los 30 días anteriores por pocos días con dato; 10 de 30 días con dato.')
  })
  it('low coverage and no data', () => {
    expect(mk('steps', rep(2, 5000), null)).toBe('Solo 2 días con dato en este periodo.')
    expect(mk('steps', rep(1, 5000), null)).toBe('Solo 1 día con dato en este periodo.')
    expect(mk('steps', [], null)).toBe('Sin registros en este periodo.')
    expect(describe('steps', summarize([], null), range)).toBe('Sin registros en este periodo.')
  })
  it('is deterministic and uses singular for one-day ranges', () => {
    const one = { from: D1, to: D1 }
    const s = summarize([{ date: D1, value: 3000, source: 'manual' }], [{ date: '2026-04-30', value: 2000, source: 'manual' }], { minDays: 1 })
    expect(describe('steps', s, one, { minDays: 1 })).toBe(describe('steps', s, one, { minDays: 1 }))
    expect(describe('steps', s, one, { minDays: 1 })).toBe('Media de 3.000 pasos al día, 50 % más que en el día anterior; 1 de 1 día con dato.')
  })
})

suite('chart adapters', () => {
  it('measured series follow the contract and drop empty optional fields', () => {
    const i = input({ vitals: [vital(D1, 'bloodPressure', { systolic: 120, diastolic: 80 })] })
    const s = measuredSeries('bloodPressure', buildSeries('bloodPressure', i, D1, D2))
    expect(s).toMatchObject({ id: 'bloodPressure', label: 'Presión arterial', unit: 'mmHg', colorVar: 'heart', kind: 'range', role: 'measured' })
    expect(s.points).toEqual([{ date: D1, value: 120, source: 'manual', low: 80, high: 120 }, { date: D2, value: null }])
  })
  it('estimates are flagged', () => {
    const i = input({ body: [body(D1, 75, { derived: derived('jp3_male', 18) })] })
    expect(measuredSeries('bodyFat', buildSeries('bodyFat', i, D1, D1)).points[0]).toMatchObject({ estimated: true })
  })
  it('trend series has role trend; previous period is shifted onto the current axis', () => {
    const cur = { from: '2026-05-08', to: '2026-05-14' }
    const prev = previousRange(cur)
    expect(prev).toEqual({ from: '2026-05-01', to: '2026-05-07' })
    const i = input({ body: [body('2026-05-01', 80), body('2026-05-07', 79)] })
    const pts = buildSeries('weight', i, prev.from, prev.to)
    const p = previousSeries('weight', pts, prev, cur)
    expect(p.role).toBe('previous')
    expect(p.points.map((x) => x.date)).toEqual(dateRange(cur.from, cur.to))
    expect(p.points[0]).toMatchObject({ date: '2026-05-08', value: 80 })
    expect(p.points[6]).toMatchObject({ date: '2026-05-14', value: 79 })
    const t = trendSeries('weight', summarize(pts, null, { metricId: 'weight' }).trend!.points)
    expect(t).toMatchObject({ role: 'trend', kind: 'line' })
    expect(t.points).toHaveLength(2)
  })
})

suite('guard: same numbers as the dashboard helpers', () => {
  const dates = dateRange('2026-05-01', '2026-05-10')
  const i = input({
    body: [body('2026-05-01', 80, { time: '07:00' }), body('2026-05-01', 79.5, { time: '20:00' }), body('2026-05-04', 79, { approx: true }), body('2026-05-06', 78.8)],
    activity: [act('2026-05-02', { steps: 3000 }), act('2026-05-02', { steps: 1200 }), act('2026-05-05', { steps: 4000, excludeFromStats: true }), act('2026-05-07', { steps: 8000 })],
    sleep: [sleepLog('2026-05-02', 7.2), sleepLog('2026-05-03', 6, null, null, { excludeFromStats: true }), sleepLog('2026-05-08', 5, null, null, { origin: 'phase0' })],
    health: [
      hc('2026-05-04', 'weight', 79.2, { kind: 'record' }),
      hc('2026-05-07', 'steps', 9500),
      hc('2026-05-09', 'steps', 6000),
      hc('2026-05-02', 'sleep', 480, { kind: 'record' }),
      hc('2026-05-03', 'sleep', 400, { kind: 'record' }),
    ],
  })
  it('weight, steps and sleep are exactly what weightByDay / stepsByDay / sleepByDay return', () => {
    const w = seriesFor(dates, weightByDay(i.body, i.health))
    expect(vals(buildSeries('weight', i, '2026-05-01', '2026-05-10'))).toEqual(w)
    expect(vals(buildSeries('steps', i, '2026-05-01', '2026-05-10'))).toEqual(seriesFor(dates, stepsByDay(i.activity, i.health, dates)))
    expect(vals(buildSeries('sleep', i, '2026-05-01', '2026-05-10'))).toEqual(seriesFor(dates, sleepByDay(i.sleep, i.health, dates)))
    expect(buildSeries('steps', i, '2026-05-01', '2026-05-10').map((p) => p.source)).toEqual(stepsByDay(i.activity, i.health, dates).map((d) => d.source))
  })
  it('summary delta equals compare() over the same arrays', () => {
    const cur = buildSeries('steps', i, '2026-05-06', '2026-05-10')
    const prev = buildSeries('steps', i, '2026-05-01', '2026-05-05')
    expect(summarize(cur, prev).delta).toEqual(compare(cur.map((p) => p.value), prev.map((p) => p.value)).delta)
  })
})

suite('today is left out of sum-type metrics', () => {
  const range = { from: '2026-05-01', to: '2026-05-10' }
  const prevR = previousRange(range)
  const mkDay = (date: string, value: number | null): HealthPoint => ({ date, value, source: value === null ? null : 'manual' })
  const days = (r: { from: string; to: string }, f: (d: string) => number | null) => dateRange(r.from, r.to).map((d) => mkDay(d, f(d)))
  const cur = (todayValue: number | null) => days(range, (d) => (d === '2026-05-10' ? todayValue : 5000))
  const prev = days(prevR, () => 4000)

  it('a half-finished today does not change mean, total, coverage or delta; latest still reports it', () => {
    const a = summarize(cur(300), prev, { metricId: 'steps', today: '2026-05-10' })
    const b = summarize(cur(9000), prev, { metricId: 'steps', today: '2026-05-10' })
    for (const k of ['mean', 'total', 'coverage', 'delta', 'previousMean', 'previousCoverage'] as const) expect(a[k], k).toEqual(b[k])
    expect(a.mean).toBe(5000)
    expect(a.coverage).toEqual({ days: 9, total: 9 })
    expect(a.previousCoverage).toEqual({ days: 9, total: 9 }) // same length as the counted days
    expect(a.delta).toBe(1000)
    expect(a.excludedToday).toBe(true)
    expect(a.latest).toEqual({ date: '2026-05-10', value: 300 })
  })
  it('applies to water, minutes, kcal and habits; not to weight, sleep or vitals', () => {
    for (const m of ['water', 'activeMinutes', 'activeKcal', 'habits'] as const) expect(summarize(cur(1), prev, { metricId: m, today: '2026-05-10' }).excludedToday, m).toBe(true)
    const w = summarize(cur(100), prev, { metricId: 'weight', today: '2026-05-10' })
    expect(w.excludedToday).toBe(false)
    expect(w.coverage).toEqual({ days: 10, total: 10 })
    expect(w.mean).toBeCloseTo((9 * 5000 + 100) / 10, 8)
    expect(summarize(cur(100), prev, { metricId: 'sleep', today: '2026-05-10' }).coverage.days).toBe(10)
  })
  it('without a today in the period, or without the option, nothing changes', () => {
    expect(summarize(cur(300), prev, { metricId: 'steps' }).coverage.days).toBe(10)
    expect(summarize(cur(300), prev, { metricId: 'steps', today: '2026-06-01' }).coverage.days).toBe(10)
  })
  it('describe states the days really counted', () => {
    const s = summarize(cur(300), prev, { metricId: 'steps', today: '2026-05-10' })
    expect(describe('steps', s, range)).toBe('Media de 5.000 pasos al día, 25 % más que en los 9 días anteriores; 9 de 9 días con dato (sin contar hoy).')
  })
})
