/**
 * Pure progress maths for one exercise (no React, no I/O): per-session series, weekly frequency, dated
 * records and the rep-record table. Everything is computed from the exercise's done sets (alias-resolved
 * by `loadExerciseSets`); warm-ups and rows flagged `excludeFromStats` never count.
 *
 * Output adapts to the chart contract (`Series[]`, src/ui/charts/types.ts). Sessions are points on a real
 * time axis; the chart cuts the line between sessions further apart than MAX_GAP_DAYS.
 */
import type { TrackingType } from '../../db/catalogTypes'
import type { ExerciseSet } from '../../db/types'
import { addDays, daysBetween, isoWeekStart } from '../../domain/dates'
import { E1RM_MAX_REPS, e1rm, e1rmApplies } from '../../domain/training'
import type { Point, Series } from '../../ui/charts/types'

export type ProgressSet = Pick<
  ExerciseSet,
  'id' | 'sessionId' | 'date' | 'setIndex' | 'weight' | 'reps' | 'durationSec' | 'distanceM' | 'isWarmup' | 'done'
> & { excludeFromStats?: boolean }

/**
 * Chosen gap: 21 days. Training is irregular (travel, illness, a deload), so a line may bridge two or
 * three weeks without lying; beyond that the lifter was effectively away and the line is cut, so a
 * long pause is not drawn as a smooth trend.
 */
export const MAX_GAP_DAYS = 21

// ───────────── the one place that decides what a set is ─────────────
/** Set kind. A real `kind` field is coming; until then only `isWarmup` distinguishes warm-ups. */
export type SetKind = 'warmup' | 'work'
export function setKindOf(s: Pick<ProgressSet, 'isWarmup'>): SetKind {
  return s.isWarmup === true ? 'warmup' : 'work'
}
/** Done, counted in stats, and not a warm-up. */
export function isWorkSet(s: ProgressSet): boolean {
  return s.done && !s.excludeFromStats && setKindOf(s) === 'work'
}
/** Sets that may appear in the history (warm-ups included, flagged rows left out). */
export function isHistorySet(s: ProgressSet): boolean {
  return s.done && !s.excludeFromStats
}

// ───────────── metrics ─────────────
export type MetricId = 'maxWeight' | 'e1rm' | 'volume' | 'maxReps' | 'totalReps' | 'maxDuration' | 'totalDuration' | 'maxDistance' | 'totalDistance'

export interface MetricMeta {
  /** Short label for the selector. */
  short: string
  /** Panel title. */
  title: string
  unit: string
  kind: 'line' | 'bar'
  estimated?: boolean
  zeroBaseline?: boolean
}

export const METRIC_META: Record<MetricId, MetricMeta> = {
  maxWeight: { short: 'Peso', title: 'Peso máximo', unit: 'kg', kind: 'line' },
  e1rm: { short: '1RM est.', title: '1RM estimado', unit: 'kg', kind: 'line', estimated: true },
  volume: { short: 'Volumen', title: 'Volumen por sesión', unit: 'kg', kind: 'bar', zeroBaseline: true },
  maxReps: { short: 'Reps', title: 'Repeticiones máximas', unit: 'reps', kind: 'line' },
  totalReps: { short: 'Reps totales', title: 'Repeticiones por sesión', unit: 'reps', kind: 'bar', zeroBaseline: true },
  maxDuration: { short: 'Tiempo', title: 'Mejor tiempo', unit: 's', kind: 'line' },
  totalDuration: { short: 'Total', title: 'Tiempo por sesión', unit: 's', kind: 'bar', zeroBaseline: true },
  maxDistance: { short: 'Distancia', title: 'Mayor distancia', unit: 'm', kind: 'line' },
  totalDistance: { short: 'Total', title: 'Distancia por sesión', unit: 'm', kind: 'bar', zeroBaseline: true },
}

/** Which metrics make sense for a tracking type (and, for bodyweight, whether extra load was used). */
export function metricsFor(t: TrackingType, sets: readonly ProgressSet[] = []): MetricId[] {
  switch (t) {
    case 'weight_reps':
      return ['maxWeight', 'e1rm', 'volume', 'maxReps']
    case 'bodyweight_reps': {
      const loaded = sets.some((s) => isWorkSet(s) && (s.weight ?? 0) > 0)
      return loaded ? ['maxReps', 'totalReps', 'maxWeight'] : ['maxReps', 'totalReps']
    }
    case 'time':
      return ['maxDuration', 'totalDuration']
    case 'distance':
      return ['maxDistance', 'totalDistance', 'maxDuration']
  }
}

/** One training session of this exercise (work sets only). */
export interface SessionPoint {
  sessionId: string
  date: string
  workSets: number
  maxWeight: number | null
  e1rm: number | null
  volume: number
  maxReps: number | null
  totalReps: number
  maxDuration: number | null
  totalDuration: number
  maxDistance: number | null
  totalDistance: number
}

const maxOf = (xs: (number | null | undefined)[]): number | null => {
  let m: number | null = null
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x) && (m === null || x > m)) m = x
  return m
}
const sumOf = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (typeof x === 'number' && Number.isFinite(x) ? x : 0), 0)

/** Per-session aggregates, oldest first. Sessions with no work set are left out. */
export function sessionPoints(sets: readonly ProgressSet[]): SessionPoint[] {
  const by = new Map<string, ProgressSet[]>()
  for (const s of sets) if (isWorkSet(s)) by.set(s.sessionId, [...(by.get(s.sessionId) ?? []), s])
  const out: SessionPoint[] = []
  for (const [sessionId, rows] of by) {
    out.push({
      sessionId,
      date: rows.map((r) => r.date).sort()[0]!,
      workSets: rows.length,
      maxWeight: maxOf(rows.map((r) => (r.weight !== null && r.weight > 0 ? r.weight : null))),
      e1rm: maxOf(rows.map((r) => (r.weight !== null && r.reps !== null ? e1rm(r.weight, r.reps) : null))),
      volume: sumOf(rows.map((r) => (r.weight !== null && r.reps !== null ? r.weight * r.reps : 0))),
      maxReps: maxOf(rows.map((r) => (r.reps !== null && r.reps > 0 ? r.reps : null))),
      totalReps: sumOf(rows.map((r) => r.reps)),
      maxDuration: maxOf(rows.map((r) => (r.durationSec ? r.durationSec : null))),
      totalDuration: sumOf(rows.map((r) => r.durationSec)),
      maxDistance: maxOf(rows.map((r) => (r.distanceM ? r.distanceM : null))),
      totalDistance: sumOf(rows.map((r) => r.distanceM)),
    })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sessionId < b.sessionId ? -1 : 1))
}

const isTotal = (m: MetricId) => m === 'volume' || m === 'totalReps' || m === 'totalDuration' || m === 'totalDistance'

/**
 * One chart series for a metric. Two sessions on the same date become one point (max, or sum for the
 * per-session totals). Unit is scaled for readability: seconds → minutes from 10 min, metres → km from 1 km.
 */
export function metricSeries(points: readonly SessionPoint[], metric: MetricId): Series {
  const meta = METRIC_META[metric]
  const byDate = new Map<string, number>()
  for (const p of points) {
    const v = p[metric]
    if (v === null || v === undefined || (isTotal(metric) && v <= 0)) continue
    const cur = byDate.get(p.date)
    byDate.set(p.date, cur === undefined ? v : isTotal(metric) ? cur + v : Math.max(cur, v))
  }
  const entries = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const top = entries.reduce((m, [, v]) => Math.max(m, v), 0)
  let scale = 1
  let unit = meta.unit
  if (meta.unit === 's' && top >= 600) {
    scale = 60
    unit = 'min'
  } else if (meta.unit === 'm' && top >= 1000) {
    scale = 1000
    unit = 'km'
  }
  const pts: Point[] = entries.map(([date, v]) => ({ date, value: Math.round((v / scale) * 100) / 100, ...(meta.estimated ? { estimated: true } : {}) }))
  return { id: metric, label: meta.title, unit, colorVar: 'train', kind: meta.kind, role: 'measured', points: pts }
}

// ───────────── periods ─────────────
export type ProgressPeriod = '90d' | '6m' | '1y' | 'all'
export const PERIOD_OPTIONS: { value: ProgressPeriod; label: string; long: string }[] = [
  { value: '90d', label: '90 d', long: 'Últimos 90 días' },
  { value: '6m', label: '6 m', long: 'Últimos 6 meses' },
  { value: '1y', label: '1 año', long: 'Último año' },
  { value: 'all', label: 'Todo', long: 'Todo el historial' },
]

/** Inclusive range ending today. "Todo" starts at the first session (or today when there is none). */
export function periodRange(period: ProgressPeriod, today: string, firstDate: string | null): { from: string; to: string } {
  switch (period) {
    case '90d':
      return { from: addDays(today, -89), to: today }
    case '6m':
      return { from: addDays(today, -182), to: today }
    case '1y':
      return { from: addDays(today, -364), to: today }
    case 'all':
      return { from: firstDate && firstDate < today ? firstDate : addDays(today, -29), to: today }
  }
}

export const countInRange = (s: Series, from: string, to: string) => s.points.filter((p) => p.value !== null && p.date >= from && p.date <= to).length

/** The shortest period that holds at least two points of the series (so the first view is never empty). */
export function defaultPeriod(s: Series, today: string, firstDate: string | null): ProgressPeriod {
  for (const p of ['90d', '6m', '1y'] as const) {
    const r = periodRange(p, today, firstDate)
    if (countInRange(s, r.from, r.to) >= 2) return p
  }
  return 'all'
}

// ───────────── weekly frequency ─────────────
export interface Frequency {
  series: Series
  sessions: number
  weeks: number
  perWeek: number
}

/** Sessions per ISO week (Monday start) between `from` and `to`, zero weeks included. */
export function weeklyFrequency(points: readonly SessionPoint[], from: string, to: string): Frequency {
  const dates = [...new Set(points.map((p) => p.date))].filter((d) => d >= from && d <= to)
  const counts = new Map<string, number>()
  for (const d of dates) counts.set(isoWeekStart(d), (counts.get(isoWeekStart(d)) ?? 0) + 1)
  const pts: Point[] = []
  for (let w = isoWeekStart(from); w <= to; w = addDays(w, 7)) {
    // The first and last weeks may be partial: clamp them to the requested range so bars never leave the axis.
    const start = w < from ? from : w
    const end = addDays(w, 6) > to ? to : addDays(w, 6)
    pts.push({ date: start, value: counts.get(w) ?? 0, span: daysBetween(start, end) + 1 })
  }
  const series: Series = { id: 'frequency', label: 'Sesiones por semana', unit: 'sesiones', colorVar: 'train', kind: 'bar', role: 'measured', points: pts }
  const first = points.length ? points[0]!.date : from
  const start = first > from ? first : from
  const weeks = Math.max(1, Math.ceil((daysBetween(start, to) + 1) / 7))
  return { series, sessions: dates.length, weeks, perWeek: dates.length / weeks }
}

// ───────────── records ─────────────
export type RecordId = 'maxWeight' | 'e1rm' | 'volumeSet' | 'maxReps' | 'maxDuration' | 'maxDistance'

export interface RecordEntry {
  id: RecordId
  label: string
  value: number
  /** Unit of `value` ("kg", "reps", "s", "m"). */
  unit: string
  date: string
  sessionId: string
  /** The set that produced it. */
  set: { weight: number | null; reps: number | null; durationSec: number | null; distanceM: number | null }
}

/** Ties keep the earliest date (the first time it was reached). */
function pickBest(sets: readonly ProgressSet[], score: (s: ProgressSet) => number | null): { s: ProgressSet; v: number } | null {
  let best: { s: ProgressSet; v: number } | null = null
  for (const s of sets) {
    const v = score(s)
    if (v === null || !(v > 0)) continue
    if (!best || v > best.v || (v === best.v && s.date < best.s.date)) best = { s, v }
  }
  return best
}

/**
 * Personal records of one exercise. Body-weight exercises (`tracking` = 'bodyweight_reps') get no
 * «1RM estimado»: their weight is only the added load, so an e1RM from it is not maximal strength
 * (volume is counted the same way: added load × reps).
 */
export function recordList(sets: readonly ProgressSet[], tracking?: TrackingType): RecordEntry[] {
  const work = sets.filter(isWorkSet)
  const out: RecordEntry[] = []
  const add = (id: RecordId, label: string, unit: string, hit: { s: ProgressSet; v: number } | null) => {
    if (!hit) return
    const { s, v } = hit
    out.push({ id, label, value: v, unit, date: s.date, sessionId: s.sessionId, set: { weight: s.weight, reps: s.reps, durationSec: s.durationSec, distanceM: s.distanceM } })
  }
  add('maxWeight', 'Peso máximo', 'kg', pickBest(work, (s) => s.weight))
  if (e1rmApplies(tracking)) add('e1rm', '1RM estimado', 'kg', pickBest(work, (s) => (s.weight !== null && s.reps !== null ? e1rm(s.weight, s.reps) : null)))
  add('volumeSet', 'Serie de mayor volumen', 'kg', pickBest(work, (s) => (s.weight !== null && s.reps !== null ? s.weight * s.reps : null)))
  add('maxReps', 'Más repeticiones', 'reps', pickBest(work, (s) => s.reps))
  add('maxDuration', 'Mayor duración', 's', pickBest(work, (s) => s.durationSec))
  add('maxDistance', 'Mayor distancia', 'm', pickBest(work, (s) => s.distanceM))
  return out
}

/** Heaviest session by volume (kg), with its date. */
export function bestVolumeSession(points: readonly SessionPoint[]): { value: number; date: string; sessionId: string } | null {
  let best: SessionPoint | null = null
  for (const p of points) if (p.volume > 0 && (!best || p.volume > best.volume || (p.volume === best.volume && p.date < best.date))) best = p
  return best ? { value: best.volume, date: best.date, sessionId: best.sessionId } : null
}

export interface RepRecord {
  /** 1…9, or 10 meaning "10 or more". */
  reps: number
  orMore: boolean
  weight: number
  /** Reps actually done (equals `reps` except in the "10 o más" row). */
  repsDone: number
  date: string
  sessionId: string
}

/**
 * Best weight lifted for each repetition count: exactly n reps for 1…9, and the heaviest set of 10 or
 * more in the last row. Only rows that exist are returned. Needs weight and reps (null otherwise).
 */
export function repRecords(sets: readonly ProgressSet[]): RepRecord[] {
  const best = new Map<number, RepRecord>()
  for (const s of sets) {
    if (!isWorkSet(s) || s.weight === null || s.weight <= 0 || s.reps === null || s.reps < 1) continue
    const key = Math.min(s.reps, 10)
    const cur = best.get(key)
    if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.date < cur.date))
      best.set(key, { reps: key, orMore: key === 10, weight: s.weight, repsDone: s.reps, date: s.date, sessionId: s.sessionId })
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps)
}

/** Reynolds, Gordon & Robergs 2006: linear 1RM equations only up to 10 reps (see E1RM_MAX_REPS). */
export const E1RM_NOTE = `1RM estimado con la fórmula de Epley, solo en series de 1 a ${E1RM_MAX_REPS} repeticiones (por encima pierde precisión y no se calcula). Supone una serie al fallo o muy cerca; no es una medición directa de fuerza máxima.`
