/**
 * Presentation model shared by the Salud overview and the detail pages: for one metric and one period,
 * the figure to show (with unit), the neutral delta, the coverage text, the sentence from the series layer
 * and the chart series. Pure (no React, no database); everything numeric comes from series.ts.
 */
import { addDays, daysBetween, formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { formatMinutes } from '../../integrations/health-connect/format'
import type { Source } from '../dashboard/controlCenter'
import { goalFor, metricDef, type MetricDef, type MetricId } from './metrics'
import {
  bucket,
  buildSeries,
  describe,
  measuredSeries,
  previousSeries,
  summarize,
  trendSeries,
  weightHistory,
  type BucketUnit,
  type ChartPoint,
  type ChartSeries,
  type DateRange,
  type HealthInput,
  type HealthPoint,
  type SeriesOptions,
  type Summary,
} from './series'

export function sourceLabel(s: Source | string | null | undefined): string {
  return s === 'health-connect' ? 'Health Connect' : s === 'phase0' ? 'Importado' : s === 'manual' ? 'Manual' : 'Sin fuente'
}

/** Point-in-time measures show their latest value; everything else shows the mean per day with data. */
const LATEST: ReadonlySet<MetricId> = new Set<MetricId>(['weight', 'waist', 'bodyFat', 'fatMass', 'leanMass', 'ffmi'])
export const isLatestMetric = (id: MetricId) => LATEST.has(id)

export interface Figure {
  value: string
  unit: string
}

/** A metric value split into figure and unit, the way a panel prints it. `perDay` marks means of daily totals. */
export function figure(id: MetricId, v: number | null, opts: { low?: number | null } = {}): Figure {
  const d = metricDef(id)
  if (v === null) return { value: '—', unit: d.unit }
  switch (id) {
    case 'sleep':
      return { value: formatMinutes(Math.round(v * 60)), unit: '' }
    case 'bedtime':
    case 'wakeTime': {
      const m = ((Math.round(v) % 1440) + 1440) % 1440
      return { value: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, unit: '' }
    }
    case 'water':
      return v >= 1000 ? { value: formatNumber(v / 1000, 2), unit: 'L/día' } : { value: formatNumber(v, 0), unit: 'ml/día' }
    case 'steps':
      return { value: formatNumber(v, 0), unit: 'pasos/día' }
    case 'activeMinutes':
      return { value: formatNumber(v, 0), unit: 'min/día' }
    case 'activeKcal':
      return { value: formatNumber(v, 0), unit: 'kcal/día' }
    case 'bloodPressure':
      return { value: `${formatNumber(v, 0)}/${opts.low != null ? formatNumber(opts.low, 0) : '—'}`, unit: 'mmHg' }
    case 'habits':
      return { value: formatNumber(v, 0), unit: '% al día' }
    case 'energyScale':
    case 'sorenessScale':
    case 'stressScale':
    case 'moodScale':
      return { value: formatNumber(v, 1), unit: 'de 5' }
    default:
      return { value: formatNumber(v, d.decimals), unit: d.unit }
  }
}

export interface DeltaProps {
  value: number
  unit?: string
  period: string
  goodWhen?: 'up' | 'down'
}

/** Change against the previous period in the units people use (percent for totals, minutes for sleep). */
export function deltaFor(id: MetricId, s: Summary, period: string): DeltaProps | undefined {
  if (s.delta === null) return undefined
  const d = metricDef(id)
  if (d.compare === 'percent') {
    if (s.previousMean === null || s.previousMean === 0) return undefined
    return { value: (s.delta / s.previousMean) * 100, unit: '%', period }
  }
  switch (id) {
    case 'sleep':
      return { value: s.delta * 60, unit: 'min', period }
    case 'bedtime':
    case 'wakeTime':
      return { value: s.delta, unit: 'min', period }
    case 'habits':
      return { value: s.delta, unit: 'pts', period }
    default:
      return { value: s.delta, unit: d.unit === '/5' ? 'pts' : d.unit, period }
  }
}

export const coverageText = (s: Summary): string =>
  `${s.coverage.days} de ${s.coverage.total} ${s.coverage.total === 1 ? 'día' : 'días'} con dato${s.excludedToday ? ' (sin contar hoy)' : ''}`

export interface MetricView {
  id: MetricId
  def: MetricDef
  points: HealthPoint[]
  previousPoints: HealthPoint[]
  summary: Summary
  /** Main figure: the latest value for point-in-time measures, the mean otherwise. */
  main: Figure
  /** Say which one it is: "Último, 14 nov" or "Media del periodo". */
  mainKind: string
  delta?: DeltaProps
  coverage: string
  sentence: string
  goal: number | null
  /** Days with data in the period. */
  count: number
}

export interface ViewOptions {
  today: string
  comparison: string
  series?: SeriesOptions
}

export function buildView(id: MetricId, input: HealthInput, range: DateRange, previous: DateRange, o: ViewOptions): MetricView {
  const def = metricDef(id)
  const points = buildSeries(id, input, range.from, range.to, o.series)
  const previousPoints = buildSeries(id, input, previous.from, previous.to, o.series)
  const summary = summarize(points, previousPoints, { metricId: id, today: o.today, ...(id === 'weight' ? { history: weightHistory(input) } : {}) })
  const latest = isLatestMetric(id)
  const main = latest ? figure(id, summary.latest?.value ?? null) : figure(id, summary.mean, { low: summary.meanLow })
  return {
    id,
    def,
    points,
    previousPoints,
    summary,
    main,
    mainKind: latest ? (summary.latest ? `Último · ${formatDateEs(summary.latest.date)}` : '') : 'Media por día con dato',
    delta: deltaFor(id, summary, o.comparison),
    coverage: coverageText(summary),
    sentence: describe(id, summary, range),
    goal: goalFor(id, input.profile?.settings),
    count: points.filter((p) => p.value !== null).length,
  }
}

// ───────────── Grouping ─────────────
export const groupLabel: Record<BucketUnit, string> = { day: 'Día', week: 'Semana', month: 'Mes' }

/** Default grouping: days up to 45 days, weeks beyond (bars at 90 days become weekly). */
export function defaultGroup(days: number): BucketUnit {
  return days > 45 ? 'week' : 'day'
}

/**
 * Daily points grouped into weeks or months as mean per day with data; each bin is one chart point whose
 * `span` is the number of days of the bin inside the range (the first bin may start before `range.from`).
 */
export function groupPoints(points: HealthPoint[], unit: BucketUnit, range: DateRange): ChartPoint[] {
  if (unit === 'day') return points.map((p) => ({ date: p.date, value: p.value, ...(p.source ? { source: p.source } : {}) }))
  return bucket(points, unit, 'mean').map((b) => {
    const start = b.start < range.from ? range.from : b.start
    const end = b.end > range.to ? range.to : b.end
    return { date: start, value: b.value, span: daysBetween(start, end) + 1 }
  })
}

export interface SeriesChoice {
  group: BucketUnit
  compare: boolean
  range: DateRange
  previous: DateRange
  label?: string
}

/** Chart series of a metric view: measured (+ calculated trend for weight) (+ previous period). */
export function chartSeries(v: MetricView, o: SeriesChoice): ChartSeries[] {
  const def = v.def
  const grouped = def.kind === 'bar' && o.group !== 'day'
  const base = measuredSeries(v.id, v.points, o.label ? { label: o.label } : {})
  const measured: ChartSeries = grouped ? { ...base, points: groupPoints(v.points, o.group, o.range) } : base
  const out: ChartSeries[] = [measured]
  if (v.id === 'weight' && v.summary.trend) out.push(trendSeries('weight', v.summary.trend.points))
  if (o.compare) {
    const prev = grouped ? groupedAsHealth(v.previousPoints, o.group, o.previous) : v.previousPoints
    out.push(previousSeries(v.id, prev, o.previous, o.range))
  }
  return out
}

const groupedAsHealth = (points: HealthPoint[], unit: BucketUnit, range: DateRange): HealthPoint[] =>
  groupPoints(points, unit, range).map((p) => ({ date: p.date, value: p.value, source: null }))

/** Date of the previous period that lines up with `date` of the current one (for the comparison caption). */
export const shiftBack = (date: string, range: DateRange, previous: DateRange): string => addDays(previous.from, daysBetween(range.from, date))
