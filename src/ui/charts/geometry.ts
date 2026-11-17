/**
 * Pure geometry for time-series charts. No React, no DOM. Dates are `YYYY-MM-DD` calendar days; every
 * computation uses UTC day numbers so DST/timezones can never shift a point.
 * (Deliberately independent of src/domain/dates.ts: that module pulls date-fns + locale into the chart chunk.)
 */

export function dayNum(date: string): number {
  const y = +date.slice(0, 4)
  const m = +date.slice(5, 7)
  const d = +date.slice(8, 10)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function addDays(date: string, n: number): string {
  return new Date((dayNum(date) + n) * 86_400_000).toISOString().slice(0, 10)
}

export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a)

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  const dow = new Date(dayNum(date) * 86_400_000).getUTCDay() // 0 = Sunday
  return addDays(date, -((dow + 6) % 7))
}

// ---------------------------------------------------------------------------------------------
// Time scale
// ---------------------------------------------------------------------------------------------

export interface TimeScale {
  /** Number of calendar days in [from, to] (inclusive). */
  days: number
  /** Width of one day's slot in px. */
  slot: number
  /** x of the centre of the day's slot (days outside the range extrapolate). */
  x(date: string): number
  /** Day index (0-based) to x. */
  xAt(index: number): number
  /** Index of the day under pixel x, clamped to [0, days-1]. */
  indexAt(px: number): number
  dateAt(index: number): string
}

/** Calendar-true scale: every day owns an equal slot, whether it has data or not. */
export function timeScale(from: string, to: string, x0: number, x1: number): TimeScale {
  const f = dayNum(from)
  const days = Math.max(1, dayNum(to) - f + 1)
  const slot = (x1 - x0) / days
  const xAt = (i: number) => x0 + (i + 0.5) * slot
  return {
    days,
    slot,
    xAt,
    x: (date) => xAt(dayNum(date) - f),
    indexAt: (px) => Math.min(days - 1, Math.max(0, Math.floor((px - x0) / slot))),
    dateAt: (i) => addDays(from, i),
  }
}

// ---------------------------------------------------------------------------------------------
// Y domain and ticks
// ---------------------------------------------------------------------------------------------

export interface YDomain {
  min: number
  max: number
  ticks: number[]
  step: number
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

/**
 * "Nice" y domain with at most `maxTicks` (default 4) ticks. `zero` forces the baseline to 0 (bars).
 * The domain always covers every value; ticks are multiples of the step inside the domain.
 */
export function yDomain(values: number[], opts: { zero?: boolean; maxTicks?: number; integer?: boolean } = {}): YDomain {
  const maxTicks = opts.maxTicks ?? 4
  const finite = values.filter((v) => Number.isFinite(v))
  let lo = finite.length ? Math.min(...finite) : 0
  let hi = finite.length ? Math.max(...finite) : 1
  if (opts.zero) {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.05 || 1
    lo -= pad
    hi += pad
    if (opts.zero && finite.every((v) => v >= 0)) lo = 0
  }
  if (opts.integer) {
    // Counts: whole-number ticks only.
    lo = Math.floor(lo)
    hi = Math.max(Math.ceil(hi), lo + 1)
  }
  let step = niceStep((hi - lo) / (maxTicks - 1))
  if (opts.integer) step = Math.max(1, Math.ceil(step))
  for (let guard = 0; guard < 12; guard++) {
    const first = Math.floor(lo / step + 1e-9) * step
    const last = Math.ceil(hi / step - 1e-9) * step
    if (Math.round((last - first) / step) + 1 <= maxTicks) {
      const ticks: number[] = []
      for (let t = first; t <= last + step * 1e-9; t += step) ticks.push(+t.toFixed(10))
      return { min: first, max: last, ticks, step }
    }
    step = opts.integer ? Math.max(1, Math.ceil(niceStep(step * 1.5))) : niceStep(step * 1.5)
  }
  return { min: lo, max: hi, ticks: [lo, hi], step: hi - lo }
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

export interface Pt {
  date: string
  value: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Straight-segment path. The line breaks (new `M`) at a null value and wherever two consecutive data
 * points are more than `maxGapDays` apart. A run of a single point produces no segment (its marker
 * is drawn separately).
 */
export function linePath(
  points: Pt[],
  x: (date: string) => number,
  y: (v: number) => number,
  maxGapDays = 3,
): string {
  const parts: string[] = []
  let run: string[] = []
  let prev: string | null = null
  const flush = () => {
    if (run.length > 1) parts.push(`M${run.join('L')}`)
    run = []
  }
  for (const p of points) {
    if (p.value === null || !Number.isFinite(p.value)) {
      flush()
      prev = null
      continue
    }
    if (prev !== null && daysBetween(prev, p.date) > maxGapDays) flush()
    run.push(`${r2(x(p.date))} ${r2(y(p.value))}`)
    prev = p.date
  }
  flush()
  return parts.join('')
}

/** Bar with rounded top corners only (anchored to a flat baseline). `y0` is the baseline, `y1` the top. */
export function barPath(x: number, w: number, y0: number, y1: number, radius = 4): string {
  const top = Math.min(y0, y1)
  const h = Math.abs(y0 - y1)
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(radius, w / 2, h)
  const base = Math.max(y0, y1)
  return `M${r2(x)} ${r2(base)}V${r2(top + r)}Q${r2(x)} ${r2(top)} ${r2(x + r)} ${r2(top)}H${r2(x + w - r)}Q${r2(x + w)} ${r2(top)} ${r2(x + w)} ${r2(top + r)}V${r2(base)}Z`
}

// ---------------------------------------------------------------------------------------------
// Lookup, coverage
// ---------------------------------------------------------------------------------------------

/** Index in `xs` (ascending) of the value nearest to `px`; -1 when empty. */
export function nearestIndex(xs: number[], px: number): number {
  if (!xs.length) return -1
  let lo = 0
  let hi = xs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! < px) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && px - xs[lo - 1]! <= xs[lo]! - px) return lo - 1
  return lo
}

/** Nearest point WITH data to pixel x. */
export function nearestPoint<T extends Pt>(points: T[], x: (date: string) => number, px: number): T | null {
  const withData = points.filter((p) => p.value !== null)
  const i = nearestIndex(
    withData.map((p) => x(p.date)),
    px,
  )
  return i < 0 ? null : withData[i]!
}

export interface Coverage {
  daysWithData: number
  totalDays: number
}

/** Distinct days in [from, to] having a non-null value. */
export function coverage(points: Pt[], from: string, to: string): Coverage {
  const a = dayNum(from)
  const b = dayNum(to)
  const seen = new Set<number>()
  for (const p of points) {
    if (p.value === null) continue
    const d = dayNum(p.date)
    if (d >= a && d <= b) seen.add(d)
  }
  return { daysWithData: seen.size, totalDays: Math.max(0, b - a + 1) }
}

// ---------------------------------------------------------------------------------------------
// Aggregation and previous-period overlay
// ---------------------------------------------------------------------------------------------

export type Bin = { date: string; value: number; count: number }

/** Daily to weekly (ISO Monday) or monthly (first day) bins; `date` is the bin start. Nulls are ignored. */
export function aggregate(points: Pt[], by: 'week' | 'month', how: 'mean' | 'sum'): Bin[] {
  const bins = new Map<string, { sum: number; count: number }>()
  for (const p of points) {
    if (p.value === null) continue
    const key = by === 'week' ? isoWeekStart(p.date) : `${p.date.slice(0, 7)}-01`
    const b = bins.get(key) ?? { sum: 0, count: 0 }
    b.sum += p.value
    b.count++
    bins.set(key, b)
  }
  return [...bins.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, b]) => ({ date, value: how === 'mean' ? b.sum / b.count : b.sum, count: b.count }))
}

/** Move a previous-period series onto the current axis: day `prevFrom + k` becomes `curFrom + k`. */
export function shiftToPeriod<T extends { date: string }>(points: T[], prevFrom: string, curFrom: string): T[] {
  const off = daysBetween(prevFrom, curFrom)
  return points.map((p) => ({ ...p, date: addDays(p.date, off) }))
}

/** Previous period of the same length, ending the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to) + 1
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

// ---------------------------------------------------------------------------------------------
// Formatting (es-CO)
// ---------------------------------------------------------------------------------------------

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `2026-03-05` becomes `5 mar`. */
export function shortDate(date: string): string {
  return `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]}`
}

const nfCache = new Map<number, Intl.NumberFormat>()
/** es-CO number: comma decimal, dot thousands (same output as domain/units.formatNumber, which drags in the nutrient catalog). */
export function fmtNumber(n: number, maxDecimals = 1): string {
  let nf = nfCache.get(maxDecimals)
  if (!nf) {
    nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: maxDecimals, useGrouping: 'always' })
    nfCache.set(maxDecimals, nf)
  }
  return nf.format(n)
}

/** Decimals needed to print ticks of this step without noise. */
export const tickDecimals = (step: number) => (Number.isInteger(+step.toFixed(6)) ? 0 : Number.isInteger(+(step * 10).toFixed(6)) ? 1 : 2)

export function defaultFormat(v: number, unit: string): string {
  const s = fmtNumber(v, Math.abs(v) >= 100 ? 0 : 1)
  return unit ? `${s} ${unit}` : s
}

/** Big read-out of a panel: numbers always go through the es-CO formatter (96,2 · 2.516); text passes as is. */
export function panelValueText(value: string | number | null): string {
  if (value === null) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? fmtNumber(value, Math.abs(value) >= 100 ? 0 : 1) : '—'
  return value
}

/** Unit with the right number: "1 rep", "2 reps". */
export function repsUnit(n: number, unit: string): string {
  return unit === 'reps' && Math.abs(Math.round(n)) === 1 ? 'rep' : unit
}

/** x-axis tick indices (at most `max`, always first and last). */
export function xTickIndices(days: number, max = 4): number[] {
  if (days <= 1) return [0]
  const n = Math.min(max, days)
  return Array.from({ length: n }, (_, i) => Math.round((i * (days - 1)) / (n - 1)))
}
