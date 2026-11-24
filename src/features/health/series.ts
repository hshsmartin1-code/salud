/**
 * Pure data layer of the Salud dashboard: per-day series for every metric, period helpers, summaries,
 * buckets, sleep consistency, one-sentence descriptions and adapters to the chart contract
 * (the project notes §4). No UI and no database access (see loadHealth.ts for the queries).
 *
 * Source rules are the dashboard's (controlCenter.ts, reused, not re-implemented): hand-entered data and
 * Health Connect are never added together; excluded or approximate rows are left out; a day without data
 * is `null`, never 0.
 */
import type { ActivityLog, BodyMeasurement, Habit, HabitLog, HealthRecord, HydrationLog, ProfileSettings, RecoveryLog, SleepLog, VitalSign } from '../../db/types'
import { ffmi as ffmiOf, PROTOCOLS } from '../../domain/bodycomp'
import { addDays, dateRange, daysBetween, isoWeekStart, todayLocal } from '../../domain/dates'
import { linearTrendPerWeek } from '../../domain/stats'
import { formatNumber } from '../../domain/units'
import { formatMinutes } from '../../integrations/health-connect/format'
import { activeKcalByDay, compare, sleepByDay, stepsByDay, trendWeight, weightByDay, type DayValue, type Source } from '../dashboard/controlCenter'
import { metricDef, type Aggregation, type ChartKind, type MetricId } from './metrics'
import { dedupeHabitLogs } from '../../domain/dayRecords'

// ───────────── Types ─────────────
export interface DateRange {
  from: string
  to: string
}

export interface HealthPoint {
  date: string
  /** null = no data that day (never 0 unless a real record says 0). */
  value: number | null
  /** Range metrics (blood pressure): low = diastolic, high = systolic. */
  low?: number
  high?: number
  source: Source | null
  /** Calculated estimate (body composition). */
  estimated?: boolean
  /** Estimates: skinfold protocol/equation, or "Health Connect". Series with different methods are never mixed. */
  method?: string
  /** Glucose context (ayunas, posprandial, …); 'mixto' when a day has readings of several contexts. */
  context?: string
  /** Number of readings (vitals) or habits (habit completion) behind the value. */
  n?: number
}

/** Everything the series need, for a date window. Built by loadHealthInput or by tests. */
export interface HealthInput {
  profile: { heightCm: number | null; settings: ProfileSettings } | null
  body: BodyMeasurement[]
  activity: ActivityLog[]
  sleep: SleepLog[]
  recovery: RecoveryLog[]
  vitals: VitalSign[]
  hydration: HydrationLog[]
  health: HealthRecord[]
  habits: Habit[]
  habitLogs: HabitLog[]
}

export const emptyHealthInput = (): HealthInput => ({
  profile: null,
  body: [],
  activity: [],
  sleep: [],
  recovery: [],
  vitals: [],
  hydration: [],
  health: [],
  habits: [],
  habitLogs: [],
})

export interface SeriesOptions {
  /** Body-composition metrics: only this method. Default: the method of the most recent reading. */
  method?: string
  /** Glucose: only this context. Default: all readings, a mixed day is labelled 'mixto'. */
  context?: string
}

// ───────────── Period helpers ─────────────
/** The last `days` days ending today (inclusive). */
export function periodRange(today: string, days: number): DateRange {
  const n = Math.max(1, Math.floor(days))
  return { from: addDays(today, -(n - 1)), to: today }
}

export function rangeLength(range: DateRange): number {
  return Math.max(0, daysBetween(range.from, range.to) + 1)
}

/** Same length, immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const n = rangeLength(range)
  return { from: addDays(range.from, -n), to: addDays(range.from, -1) }
}

// ───────────── Row filters and small helpers ─────────────
const keep = (p: { excludeFromStats?: boolean; approx?: boolean }) => !p.excludeFromStats && !p.approx
const hcUsable = (h: HealthRecord) => h.provider === 'health-connect' && !h.excluded && h.value !== null
const srcOf = (origin: 'app' | 'phase0' | undefined): Source => (origin === 'phase0' ? 'phase0' : 'manual')
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
/** Several readings: 'phase0' only when all are; otherwise hand-entered. */
const mergeSources = (s: Source[]): Source => (s.every((x) => x === 'phase0') ? 'phase0' : s.includes('manual') ? 'manual' : s[0]!)
const empty = (date: string): HealthPoint => ({ date, value: null, source: null })
const fromDayValues = (dates: string[], dv: DayValue[]): HealthPoint[] => {
  const m = new Map(dv.map((d) => [d.date, d]))
  return dates.map((date) => {
    const d = m.get(date)
    return d && d.value !== null ? { date, value: d.value, source: d.source } : empty(date)
  })
}
const fromMap = (dates: string[], m: Map<string, HealthPoint>): HealthPoint[] => dates.map((d) => m.get(d) ?? empty(d))

interface Reading {
  date: string
  stamp: string
  value: number
  source: Source
  context?: string | null
}

/** One point per day with the mean of that day's readings and the reading count. */
function meanPerDay(dates: string[], readings: Reading[], withContext = false): HealthPoint[] {
  const by = new Map<string, Reading[]>()
  for (const r of readings) by.set(r.date, [...(by.get(r.date) ?? []), r])
  const m = new Map<string, HealthPoint>()
  for (const [date, rs] of by) {
    const p: HealthPoint = { date, value: mean(rs.map((r) => r.value)), source: mergeSources(rs.map((r) => r.source)), n: rs.length }
    if (withContext) {
      const ctx = [...new Set(rs.map((r) => r.context).filter((c): c is string => !!c))]
      if (ctx.length === 1 && rs.every((r) => !!r.context)) p.context = ctx[0]!
      else if (ctx.length > 0) p.context = 'mixto'
    }
    m.set(date, p)
  }
  return fromMap(dates, m)
}

/** One reading per day: the latest by timestamp. */
function latestPerDay(dates: string[], readings: Reading[]): HealthPoint[] {
  const m = new Map<string, Reading>()
  for (const r of [...readings].sort((a, b) => a.stamp.localeCompare(b.stamp))) m.set(r.date, r)
  const out = new Map<string, HealthPoint>()
  for (const [date, r] of m) out.set(date, { date, value: r.value, source: r.source })
  return fromMap(dates, out)
}

const clockMinutes = (hhmm: string | null | undefined): number | null => {
  const m = hhmm ? /^(\d{1,2}):(\d{2})/.exec(hhmm) : null
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

// ───────────── Body composition (estimates, one method per series) ─────────────
const HC_METHOD = 'Health Connect'
type CompId = 'bodyFat' | 'fatMass' | 'leanMass' | 'ffmi'
interface CompReading extends Reading {
  method: string
}

function protocolLabel(protocol: string | null | undefined, equation: string | null | undefined): string {
  return PROTOCOLS.find((p) => p.id === protocol)?.es ?? equation ?? protocol ?? 'Método sin nombre'
}

function compReadings(id: CompId, input: HealthInput, dateSet: Set<string>): CompReading[] {
  const out: CompReading[] = []
  const h = input.profile?.heightCm ?? null
  for (const m of input.body) {
    if (!dateSet.has(m.date) || !keep(m) || !m.derived) continue
    const d = m.derived
    const lean = d.leanMassKg
    const v = id === 'bodyFat' ? d.bodyFatPct : id === 'fatMass' ? d.fatMassKg : id === 'leanMass' ? lean : lean !== undefined && h ? ffmiOf(lean, 0, h).ffmi : undefined
    if (v === undefined || !Number.isFinite(v)) continue
    out.push({ date: m.date, stamp: `${m.date} ${m.time ?? '00:00'}`, value: v, source: srcOf(m.origin), method: protocolLabel(d.protocol ?? m.protocol, d.equation) })
  }
  const hcMetric = id === 'bodyFat' ? 'bodyFat' : id === 'fatMass' ? null : 'leanMassKg'
  if (hcMetric) {
    for (const r of input.health) {
      if (!dateSet.has(r.date) || !hcUsable(r) || r.metric !== hcMetric) continue
      const v = r.value as number
      const val = id === 'ffmi' ? (h ? ffmiOf(v, 0, h).ffmi : undefined) : v
      if (val === undefined) continue
      out.push({ date: r.date, stamp: `${r.date} ${r.start ?? ''}`, value: val, source: 'health-connect', method: HC_METHOD })
    }
  }
  return out
}

/** Methods present, most recent reading first. */
function methodsByRecency(rs: CompReading[]): string[] {
  const last = new Map<string, string>()
  for (const r of rs) if ((last.get(r.method) ?? '') < r.stamp) last.set(r.method, r.stamp)
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0])).map(([m]) => m)
}

function compSeries(rs: CompReading[], dates: string[], method: string): HealthPoint[] {
  return latestPerDay(dates, rs.filter((r) => r.method === method)).map((p) => (p.value === null ? p : { ...p, estimated: true, method }))
}

// ───────────── Per-metric builders ─────────────
function vitalReadings(input: HealthInput, dateSet: Set<string>, kind: VitalSign['kind']): Reading[] {
  const out: Reading[] = []
  for (const v of input.vitals) {
    if (v.kind !== kind || !dateSet.has(v.date) || !keep(v) || v.value == null) continue
    out.push({ date: v.date, stamp: `${v.date} ${v.time ?? '00:00'}`, value: v.value, source: srcOf(v.origin), context: v.context })
  }
  return out
}

function bloodPressure(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const by = new Map<string, VitalSign[]>()
  for (const v of input.vitals) {
    if (v.kind !== 'bloodPressure' || !dateSet.has(v.date) || !keep(v) || v.systolic == null || v.diastolic == null) continue
    by.set(v.date, [...(by.get(v.date) ?? []), v])
  }
  const m = new Map<string, HealthPoint>()
  for (const [date, vs] of by) {
    const high = mean(vs.map((v) => v.systolic as number))
    m.set(date, { date, value: high, high, low: mean(vs.map((v) => v.diastolic as number)), source: mergeSources(vs.map((v) => srcOf(v.origin))), n: vs.length })
  }
  return fromMap(dates, m)
}

function restingHr(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const own = new Map(meanPerDay(dates, vitalReadings(input, dateSet, 'restingHr')).map((p) => [p.date, p]))
  const rec: Reading[] = input.recovery
    .filter((r) => dateSet.has(r.date) && keep(r) && r.restingHr != null)
    .map((r) => ({ date: r.date, stamp: r.date, value: r.restingHr as number, source: srcOf(r.origin) }))
  const recBy = new Map(meanPerDay(dates, rec).map((p) => [p.date, p]))
  const hc = new Map<string, number>()
  for (const h of input.health) if (hcUsable(h) && h.kind === 'daily' && h.metric === 'restingHr' && dateSet.has(h.date)) hc.set(h.date, h.value as number)
  // Hand-entered pulse (vitals) first, then the pulse noted in the recovery log, then Health Connect.
  return dates.map((date) => {
    const a = own.get(date)
    if (a && a.value !== null) return a
    const b = recBy.get(date)
    if (b && b.value !== null) return b
    return hc.has(date) ? { date, value: hc.get(date)!, source: 'health-connect' as const } : empty(date)
  })
}

function activeMinutes(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const manual = new Map<string, { v: number; phase0: boolean }>()
  for (const a of input.activity) {
    if (!dateSet.has(a.date) || !keep(a) || a.minutes == null) continue
    const cur = manual.get(a.date)
    manual.set(a.date, { v: (cur?.v ?? 0) + a.minutes, phase0: (cur?.phase0 ?? true) && a.origin === 'phase0' })
  }
  const hc = new Map<string, number>()
  for (const h of input.health) if (hcUsable(h) && h.metric === 'exercise' && dateSet.has(h.date)) hc.set(h.date, (hc.get(h.date) ?? 0) + (h.value as number))
  // Exercise sessions are records (not a de-duplicated daily aggregate): the hand-entered total wins.
  return dates.map((date) => {
    const m = manual.get(date)
    if (m) return { date, value: m.v, source: m.phase0 ? ('phase0' as const) : ('manual' as const) }
    return hc.has(date) ? { date, value: hc.get(date)!, source: 'health-connect' as const } : empty(date)
  })
}

function waist(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const rs: Reading[] = []
  for (const m of input.body) {
    const w = m.circumferences?.waist
    if (!dateSet.has(m.date) || !keep(m) || w == null) continue
    rs.push({ date: m.date, stamp: `${m.date} ${m.time ?? '00:00'}`, value: w, source: srcOf(m.origin) })
  }
  return latestPerDay(dates, rs)
}

function sleepClock(input: HealthInput, dates: string[], dateSet: Set<string>, field: 'bedtime' | 'waketime'): HealthPoint[] {
  const m = new Map<string, HealthPoint>()
  // Only hand-entered logs carry clock times; the main sleep (most hours) of the wake-up date is used.
  const logs = input.sleep.filter((s) => dateSet.has(s.date) && keep(s) && clockMinutes(s[field]) !== null).sort((a, b) => (a.hours ?? 0) - (b.hours ?? 0))
  for (const s of logs) {
    let v = clockMinutes(s[field]) as number
    // Bedtimes after midnight continue the previous evening (00:30 -> 24:30) so the series is continuous.
    if (field === 'bedtime' && v < 12 * 60) v += 24 * 60
    m.set(s.date, { date: s.date, value: v, source: srcOf(s.origin) })
  }
  return fromMap(dates, m)
}

function water(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const m = new Map<string, number>()
  for (const l of input.hydration) if (dateSet.has(l.date)) m.set(l.date, (m.get(l.date) ?? 0) + l.ml)
  return dates.map((date) => (m.has(date) ? { date, value: m.get(date)!, source: 'manual' as const } : empty(date)))
}

function habitCompletion(input: HealthInput, dates: string[], dateSet: Set<string>): HealthPoint[] {
  const active = input.habits.filter((h) => h.active)
  // The local (APP_TZ) day the habit was created: a habit created at 20:00 counts from that day, not
  // from the next one (createdAt is a UTC instant).
  const createdDay = new Map(active.map((h) => [h.id, todayLocal(new Date(h.createdAt))]))
  const sums = new Map<string, number>() // `${habitId}|${date}` -> value
  const withLogs = new Set<string>()
  for (const l of dedupeHabitLogs(input.habitLogs)) {
    if (!dateSet.has(l.date)) continue
    withLogs.add(l.date)
    const k = `${l.habitId}|${l.date}`
    sums.set(k, (sums.get(k) ?? 0) + l.value)
  }
  return dates.map((date) => {
    // No habit logged at all that day = no data (the day was not tracked), not 0 %.
    if (!withLogs.has(date)) return empty(date)
    // A habit counts from the day it was created (or earlier, if it has a log that day).
    const eligible = active.filter((h) => (createdDay.get(h.id) ?? '') <= date || sums.has(`${h.id}|${date}`))
    if (eligible.length === 0) return empty(date)
    const done = eligible.filter((h) => (sums.get(`${h.id}|${date}`) ?? 0) >= h.target).length
    return { date, value: (done / eligible.length) * 100, source: 'manual' as const, n: eligible.length }
  })
}

function recoveryScale(input: HealthInput, dates: string[], dateSet: Set<string>, key: 'energy' | 'soreness' | 'stress' | 'mood'): HealthPoint[] {
  const rs: Reading[] = input.recovery
    .filter((r) => dateSet.has(r.date) && keep(r) && r[key] != null)
    .map((r) => ({ date: r.date, stamp: r.date, value: r[key] as number, source: srcOf(r.origin) }))
  return meanPerDay(dates, rs)
}

/**
 * One entry per CALENDAR day in [from, to]. Body-composition estimates use one method only
 * (`opts.method`, default the most recent one); see splitByMethod to get every method.
 */
export function buildSeries(metricId: MetricId, input: HealthInput, from: string, to: string, opts: SeriesOptions = {}): HealthPoint[] {
  const dates = dateRange(from, to)
  const dateSet = new Set(dates)
  switch (metricId) {
    case 'weight':
      return fromDayValues(dates, weightByDay(input.body, input.health))
    case 'waist':
      return waist(input, dates, dateSet)
    case 'bodyFat':
    case 'fatMass':
    case 'leanMass':
    case 'ffmi': {
      const rs = compReadings(metricId, input, dateSet)
      const method = opts.method ?? methodsByRecency(rs)[0]
      return method === undefined ? dates.map(empty) : compSeries(rs, dates, method)
    }
    case 'steps':
      return fromDayValues(dates, stepsByDay(input.activity, input.health, dates))
    case 'activeKcal':
      return fromDayValues(dates, activeKcalByDay(input.activity, input.health, dates))
    case 'activeMinutes':
      return activeMinutes(input, dates, dateSet)
    case 'sleep':
      return fromDayValues(dates, sleepByDay(input.sleep, input.health, dates))
    case 'bedtime':
      return sleepClock(input, dates, dateSet, 'bedtime')
    case 'wakeTime':
      return sleepClock(input, dates, dateSet, 'waketime')
    case 'water':
      return water(input, dates, dateSet)
    case 'restingHr':
      return restingHr(input, dates, dateSet)
    case 'bloodPressure':
      return bloodPressure(input, dates, dateSet)
    case 'glucose': {
      const rs = vitalReadings(input, dateSet, 'glucose').filter((r) => opts.context === undefined || r.context === opts.context)
      return meanPerDay(dates, rs, true)
    }
    case 'spo2':
      return meanPerDay(dates, vitalReadings(input, dateSet, 'spo2'))
    case 'temperature':
      return meanPerDay(dates, vitalReadings(input, dateSet, 'temperature'))
    case 'habits':
      return habitCompletion(input, dates, dateSet)
    case 'energyScale':
      return recoveryScale(input, dates, dateSet, 'energy')
    case 'sorenessScale':
      return recoveryScale(input, dates, dateSet, 'soreness')
    case 'stressScale':
      return recoveryScale(input, dates, dateSet, 'stress')
    case 'moodScale':
      return recoveryScale(input, dates, dateSet, 'mood')
  }
}

/** Body-composition metrics: one series per method (never mixed), most recent method first. */
export function splitByMethod(metricId: 'bodyFat' | 'fatMass' | 'leanMass' | 'ffmi', input: HealthInput, from: string, to: string): { method: string; points: HealthPoint[] }[] {
  const dates = dateRange(from, to)
  const rs = compReadings(metricId, input, new Set(dates))
  return methodsByRecency(rs).map((method) => ({ method, points: compSeries(rs, dates, method) }))
}

/** Glucose: one series per context (ayunas, posprandial, …). */
export function splitByContext(input: HealthInput, from: string, to: string): { context: string; points: HealthPoint[] }[] {
  const dates = dateRange(from, to)
  const dateSet = new Set(dates)
  const all = vitalReadings(input, dateSet, 'glucose')
  const contexts = [...new Set(all.map((r) => r.context || 'sin contexto'))].sort()
  return contexts.map((context) => ({ context, points: meanPerDay(dates, all.filter((r) => (r.context || 'sin contexto') === context), true) }))
}

// ───────────── Summary ─────────────
export interface Summary {
  latest: { date: string; value: number } | null
  mean: number | null
  /** Range metrics: mean of `low` (diastolic). */
  meanLow: number | null
  min: number | null
  max: number | null
  total: number
  coverage: { days: number; total: number }
  /** current mean − previous mean; withheld unless both periods have at least `minDays` days with data. */
  delta: number | null
  previousMean: number | null
  previousCoverage: { days: number; total: number } | null
  /** Least-squares slope per week; null with fewer than 4 points. */
  trendPerWeek: number | null
  /** Estimation methods / glucose contexts present in the points. */
  methods: string[]
  contexts: string[]
  /** True when today was left out of mean/total/coverage/delta (sum-type metrics and habits). */
  excludedToday: boolean
  /** Weight only: exponentially smoothed trend (calculated, not measured). */
  trend?: { calculated: true; points: HealthPoint[] }
}

export interface SummarizeOptions {
  minDays?: number
  /** Pass 'weight' to also get the smoothed trend. */
  metricId?: MetricId
  /** Today: for sum-type metrics and habit completion it is left out of mean, total, coverage and delta (an unfinished day). `latest` still reports it. */
  today?: string
  /** Weight: every weight point available (warm-up included); the trend is computed over it and sliced to the points' dates. */
  history?: HealthPoint[]
}

const has = (p: HealthPoint): p is HealthPoint & { value: number } => p.value !== null && Number.isFinite(p.value)

/** Exponentially smoothed trend weight (reuses trendWeight): one point per day with data. */
export function weightTrendPoints(points: HealthPoint[], range?: DateRange): HealthPoint[] {
  return trendWeight(points.filter(has).map((p) => ({ date: p.date, value: p.value, source: p.source })))
    .filter((d) => d.value !== null)
    .filter((d) => !range || (d.date >= range.from && d.date <= range.to))
    .map((d) => ({ date: d.date, value: d.value, source: d.source }))
}

/** Every weight point in the loaded input (warm-up included), for the trend: pass as `summarize` opts.history. */
export function weightHistory(input: HealthInput): HealthPoint[] {
  return weightByDay(input.body, input.health)
    .filter((d) => d.value !== null)
    .map((d) => ({ date: d.date, value: d.value, source: d.source }))
}

export function summarize(points: HealthPoint[], previousPoints: HealthPoint[] | null = null, opts: SummarizeOptions = {}): Summary {
  const minDays = opts.minDays ?? 3
  const def = opts.metricId ? metricDef(opts.metricId) : null
  const skipToday = opts.today !== undefined && def !== null && (def.aggregation === 'sum' || def.id === 'habits') && points.some((p) => p.date === opts.today)
  const counted = skipToday ? points.filter((p) => p.date !== opts.today) : points
  // The previous period keeps the length of the days actually counted.
  const prevCounted = previousPoints && skipToday ? [...previousPoints].sort((a, b) => a.date.localeCompare(b.date)).slice(0, counted.length) : previousPoints
  const allWithData = points.filter(has)
  const withData = counted.filter(has)
  const vals = withData.map((p) => p.value)
  const cmp = compare(counted.map((p) => p.value), (prevCounted ?? []).map((p) => p.value), minDays)
  const lows = withData.map((p) => p.low).filter((x): x is number => x !== undefined)
  const latest = allWithData.length ? allWithData.reduce((a, b) => (b.date >= a.date ? b : a)) : null
  const out: Summary = {
    latest: latest ? { date: latest.date, value: latest.value } : null,
    mean: vals.length ? mean(vals) : null,
    meanLow: lows.length ? mean(lows) : null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    total: vals.reduce((a, b) => a + b, 0),
    coverage: { days: withData.length, total: counted.length },
    delta: prevCounted ? cmp.delta : null,
    previousMean: prevCounted ? cmp.previous.mean : null,
    previousCoverage: prevCounted ? { days: cmp.previous.days, total: cmp.previous.total } : null,
    trendPerWeek: withData.length >= 4 ? linearTrendPerWeek(withData.map((p) => ({ date: p.date, value: p.value }))) : null,
    methods: [...new Set(withData.map((p) => p.method).filter((m): m is string => !!m))],
    contexts: [...new Set(withData.map((p) => p.context).filter((c): c is string => !!c))],
    excludedToday: skipToday,
  }
  if (opts.metricId === 'weight' && points.length) {
    const dates = points.map((p) => p.date).sort()
    out.trend = { calculated: true, points: weightTrendPoints(opts.history ?? points, { from: dates[0]!, to: dates[dates.length - 1]! }) }
  }
  return out
}

// ───────────── Buckets ─────────────
export type BucketUnit = 'day' | 'week' | 'month'

export interface Bin {
  /** First day of the bin (the day, the ISO Monday, or the 1st of the month). */
  start: string
  /** Last day of the bin (calendar), regardless of how much of it the input covers. */
  end: string
  value: number | null
  low?: number | null
  high?: number | null
  /** Days with data in the bin. */
  days: number
  /** Days of the bin present in the input (how many the bin could have had). */
  span: number
}

function lastDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10)
}

function binOf(date: string, unit: BucketUnit): { start: string; end: string } {
  if (unit === 'day') return { start: date, end: date }
  if (unit === 'week') {
    const start = isoWeekStart(date)
    return { start, end: addDays(start, 6) }
  }
  return { start: `${date.slice(0, 7)}-01`, end: lastDayOfMonth(date) }
}

function aggregate(vals: number[], agg: Aggregation): number | null {
  if (!vals.length) return null
  return agg === 'sum' ? vals.reduce((a, b) => a + b, 0) : agg === 'last' ? vals[vals.length - 1]! : mean(vals)
}

/** Groups daily points into days, ISO weeks (Monday) or calendar months. `vals` are taken in date order. */
export function bucket(points: HealthPoint[], unit: BucketUnit, agg: Aggregation = 'mean'): Bin[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const bins = new Map<string, { end: string; pts: HealthPoint[] }>()
  for (const p of sorted) {
    const b = binOf(p.date, unit)
    const cur = bins.get(b.start) ?? { end: b.end, pts: [] }
    cur.pts.push(p)
    bins.set(b.start, cur)
  }
  return [...bins.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, { end, pts }]) => {
      const withData = pts.filter(has)
      const bin: Bin = { start, end, value: aggregate(withData.map((p) => p.value), agg), days: withData.length, span: pts.length }
      const lows = withData.map((p) => p.low).filter((x): x is number => x !== undefined)
      const highs = withData.map((p) => p.high).filter((x): x is number => x !== undefined)
      if (lows.length) bin.low = aggregate(lows, agg)
      if (highs.length) bin.high = aggregate(highs, agg)
      return bin
    })
}

// ───────────── Sleep consistency ─────────────
/**
 * Sample standard deviation (minutes) of clock times, measured on the 24 h circle so 23:50 and 00:10
 * are 20 minutes apart. null with fewer than 2 values.
 */
export function circularSdMinutes(minutesOfDay: number[]): number | null {
  if (minutesOfDay.length < 2) return null
  const k = (2 * Math.PI) / 1440
  const s = minutesOfDay.reduce((a, m) => a + Math.sin(m * k), 0)
  const c = minutesOfDay.reduce((a, m) => a + Math.cos(m * k), 0)
  const center = Math.atan2(s, c) / k
  const dev = minutesOfDay.map((m) => {
    let d = (((m - center) % 1440) + 1440) % 1440
    if (d > 720) d -= 1440
    return d
  })
  const mu = mean(dev)
  return Math.sqrt(dev.reduce((a, d) => a + (d - mu) ** 2, 0) / (dev.length - 1))
}

export interface SleepConsistency {
  /** Nights with a bedtime / with a wake time. */
  bedtimeNights: number
  wakeNights: number
  bedtimeSdMin: number | null
  wakeSdMin: number | null
}

/** Null when neither clock time has at least `minNights` (default 5) nights in the period. */
export function sleepConsistency(input: HealthInput, from: string, to: string, minNights = 5): SleepConsistency | null {
  const clock = (id: 'bedtime' | 'wakeTime') =>
    buildSeries(id, input, from, to)
      .filter(has)
      .map((p) => p.value % 1440)
  const bed = clock('bedtime')
  const wake = clock('wakeTime')
  const bedSd = bed.length >= minNights ? circularSdMinutes(bed) : null
  const wakeSd = wake.length >= minNights ? circularSdMinutes(wake) : null
  if (bedSd === null && wakeSd === null) return null
  return { bedtimeNights: bed.length, wakeNights: wake.length, bedtimeSdMin: bedSd, wakeSdMin: wakeSd }
}

// ───────────── Description ─────────────
const clock = (v: number) => {
  const m = ((Math.round(v) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** A value of the metric as a person reads it (unit included). */
export function formatMetricValue(id: MetricId, v: number): string {
  const d = metricDef(id)
  switch (id) {
    case 'sleep':
      return formatMinutes(Math.round(v * 60))
    case 'bedtime':
    case 'wakeTime':
      return clock(v)
    case 'water':
      return v >= 1000 ? `${formatNumber(v / 1000, 2)} L` : `${formatNumber(v, 0)} ml`
    case 'energyScale':
    case 'sorenessScale':
    case 'stressScale':
    case 'moodScale':
      return `${formatNumber(v, d.decimals)} de 5`
    case 'steps':
      return `${formatNumber(v, 0)} pasos`
    default:
      return `${formatNumber(v, d.decimals)} ${d.unit}`
  }
}

/** A difference between two values of the metric (absolute, no sign). */
function formatAmount(id: MetricId, abs: number): string {
  switch (id) {
    case 'sleep':
      return formatMinutes(Math.round(abs * 60))
    case 'bedtime':
    case 'wakeTime':
      return `${formatNumber(abs, 0)} min`
    case 'habits':
      return `${formatNumber(abs, 0)} puntos porcentuales`
    case 'energyScale':
    case 'sorenessScale':
    case 'stressScale':
    case 'moodScale':
      return `${formatNumber(abs, 1)} puntos`
    default:
      return formatMetricValue(id, abs)
  }
}

const SCALE_NAME: Partial<Record<MetricId, string>> = { energyScale: 'energía', sorenessScale: 'dolor muscular', stressScale: 'estrés', moodScale: 'ánimo' }

function head(id: MetricId, s: Summary, mean_: number): string {
  const v = formatMetricValue(id, mean_)
  let t: string
  switch (id) {
    case 'weight':
      t = `Peso medio de ${v}`
      break
    case 'waist':
      t = `Cintura media de ${v}`
      break
    case 'bodyFat':
      t = `Grasa corporal estimada media de ${v}`
      break
    case 'fatMass':
      t = `Masa grasa estimada media de ${v}`
      break
    case 'leanMass':
      t = `Masa magra estimada media de ${v}`
      break
    case 'ffmi':
      t = `FFMI estimado medio de ${v}`
      break
    case 'steps':
      t = `Media de ${v} al día`
      break
    case 'activeMinutes':
      t = `Media de ${v} de actividad al día`
      break
    case 'activeKcal':
      t = `Media de ${v} activas al día`
      break
    case 'sleep':
      t = `Media de ${v} de sueño por noche`
      break
    case 'bedtime':
      t = `Hora media de acostarse: ${v}`
      break
    case 'wakeTime':
      t = `Hora media de despertar: ${v}`
      break
    case 'water':
      t = `Media de ${v} de agua al día`
      break
    case 'restingHr':
      t = `FC en reposo media de ${v}`
      break
    case 'bloodPressure':
      t = `Presión media de ${formatNumber(mean_, 0)}/${s.meanLow !== null ? formatNumber(s.meanLow, 0) : '—'} mmHg`
      break
    case 'glucose':
      t = `Glucosa media de ${v}`
      break
    case 'spo2':
      t = `SpO2 media de ${v}`
      break
    case 'temperature':
      t = `Temperatura media de ${v}`
      break
    case 'habits':
      t = `Media de ${v} de hábitos completados al día`
      break
    default:
      t = `Media de ${v} en ${SCALE_NAME[id] ?? metricDef(id).label.toLowerCase()}`
  }
  if (s.methods.length) t += `, método ${s.methods.join(' y ')}`
  if (id === 'glucose' && s.contexts.length) t += `, ${s.contexts.map((c) => (c === 'mixto' ? 'contextos mezclados' : c)).join(' y ')}`
  return t
}

/**
 * ONE deterministic Spanish sentence stating the basis (mean over the days with data, comparison with
 * the previous period of the same length, coverage). No advice, no interpretation.
 */
export function describe(metricId: MetricId, summary: Summary, range: DateRange, opts: { minDays?: number } = {}): string {
  const minDays = opts.minDays ?? 3
  const { days, total } = summary.coverage
  const periodTotal = total || rangeLength(range)
  if (days === 0 || summary.mean === null) return 'Sin registros en este periodo.'
  if (days < minDays) return `Solo ${days} ${days === 1 ? 'día' : 'días'} con dato en este periodo.`
  const d = metricDef(metricId)
  let t = head(metricId, summary, summary.mean)

  const n = (summary.excludedToday ? periodTotal : rangeLength(range)) || periodTotal
  const prev = n === 1 ? 'el día anterior' : `los ${n} días anteriores`
  if (summary.previousCoverage) {
    if (summary.delta === null) {
      t += `, sin comparación con ${prev} por pocos días con dato`
    } else {
      const later = metricId === 'bedtime' || metricId === 'wakeTime'
      const more = later ? 'más tarde' : 'más'
      const less = later ? 'más temprano' : 'menos'
      const pm = summary.previousMean
      const pct = d.compare === 'percent' && pm !== null && pm !== 0 ? Math.round(Math.abs(summary.delta / pm) * 100) : null
      const abs = Math.abs(summary.delta)
      const note = metricId === 'bloodPressure' ? ' en la sistólica' : ''
      if (pct !== null) t += pct === 0 ? `, igual que en ${prev}` : `, ${formatNumber(pct, 0)} % ${summary.delta > 0 ? more : less} que en ${prev}`
      else if (Number(abs.toFixed(d.decimals + 1)) === 0) t += `, igual que en ${prev}${note}`
      else t += `, ${formatAmount(metricId, abs)} ${summary.delta > 0 ? more : less}${note} que en ${prev}`
    }
  }
  if (metricId === 'weight' && summary.trendPerWeek !== null) {
    const x = Math.abs(summary.trendPerWeek) < 0.05 ? 0 : summary.trendPerWeek
    t += `, tendencia de ${x > 0 ? '+' : ''}${formatNumber(x, 1).replace('-', '−')} kg por semana`
  }
  return `${t}; ${days} de ${periodTotal} ${periodTotal === 1 ? 'día' : 'días'} con dato${summary.excludedToday ? ' (sin contar hoy)' : ''}.`
}

// ───────────── Chart contract adapters (the project notes §4) ─────────────
export interface ChartPoint {
  date: string
  value: number | null
  estimated?: boolean
  source?: string
  low?: number
  high?: number
  /** Days a bar covers (weekly/monthly bins). */
  span?: number
}
export interface ChartSeries {
  id: string
  label: string
  unit: string
  colorVar: string
  kind: ChartKind
  role?: 'measured' | 'trend' | 'previous'
  points: ChartPoint[]
}

export function toChartPoints(points: HealthPoint[]): ChartPoint[] {
  return points.map((p) => {
    const c: ChartPoint = { date: p.date, value: p.value }
    if (p.estimated) c.estimated = true
    if (p.source) c.source = p.source
    if (p.low !== undefined) c.low = p.low
    if (p.high !== undefined) c.high = p.high
    return c
  })
}

/** The measured series; `label` can carry the method of an estimate. */
export function measuredSeries(metricId: MetricId, points: HealthPoint[], opts: { id?: string; label?: string } = {}): ChartSeries {
  const d = metricDef(metricId)
  return { id: opts.id ?? metricId, label: opts.label ?? d.label, unit: d.unit, colorVar: d.color, kind: d.kind, role: 'measured', points: toChartPoints(points) }
}

/** The calculated trend (weight), same ink, no dots; labelled as calculated. */
export function trendSeries(metricId: MetricId, trendPoints: HealthPoint[]): ChartSeries {
  const d = metricDef(metricId)
  return { id: `${metricId}:trend`, label: `${d.label} · tendencia calculada`, unit: d.unit, colorVar: d.color, kind: 'line', role: 'trend', points: toChartPoints(trendPoints) }
}

/** The previous period shifted onto the current period's axis (day i of the previous = day i of the current). */
export function previousSeries(metricId: MetricId, previousPoints: HealthPoint[], previous: DateRange, current: DateRange): ChartSeries {
  const d = metricDef(metricId)
  const shifted = previousPoints
    .map((p) => ({ ...p, date: addDays(current.from, daysBetween(previous.from, p.date)) }))
    .filter((p) => p.date >= current.from && p.date <= current.to)
  return { id: `${metricId}:previous`, label: `${d.label} · periodo anterior`, unit: d.unit, colorVar: d.color, kind: 'line', role: 'previous', points: toChartPoints(shifted) }
}
