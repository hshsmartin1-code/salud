import { dayNum, fmtNumber, shortDate } from './geometry'
import type { Point, Readout, Series } from './types'

export type Formatter = (v: number, unit: string) => string

/** The series the selection snaps to: first measured one (not trend, not previous). */
export function primaryOf(series: Series[]): Series | undefined {
  return series.find((s) => s.role !== 'trend' && s.role !== 'previous') ?? series[0]
}

export const hasValue = (p: Point) => p.value !== null && Number.isFinite(p.value)

/** Text for one point, number plus unit. Range points read "118/76 mmHg". */
export function pointText(s: Series, p: Point, fmt: Formatter, withUnit = true): string {
  const unit = withUnit ? s.unit : ''
  if (s.kind === 'range' && p.high !== undefined && p.low !== undefined) {
    const t = s.formatRange ? s.formatRange(p.low, p.high) : `${fmtNumber(p.high, 0)}/${fmtNumber(p.low, 0)}`
    return unit ? `${t} ${unit}` : t
  }
  return p.value === null ? '—' : fmt(p.value, unit)
}

/** Header read-out for a selected point of the primary series. */
export function readoutFor(s: Series, p: Point, fmt: Formatter): Readout {
  return { date: p.date, value: pointText(s, p, fmt, false), unit: s.unit }
}

/** Map date → point (last wins) for the points with data. */
export function byDate(s: Series): Map<string, Point> {
  const m = new Map<string, Point>()
  for (const p of s.points) if (hasValue(p)) m.set(p.date, p)
  return m
}

/** Sorted dates (ascending) with data in the series. */
export function dataDates(s: Series): string[] {
  return [...byDate(s).keys()].sort((a, b) => dayNum(a) - dayNum(b))
}

/** Coverage points for the headline: primary series. */
export function summaryLabel(series: Series[], ariaLabel: string, from: string, to: string): string {
  const p = primaryOf(series)
  if (!p) return ariaLabel
  const pts = p.points.filter((x) => hasValue(x) && dayNum(x.date) >= dayNum(from) && dayNum(x.date) <= dayNum(to))
  if (!pts.length) return `${ariaLabel}. Sin datos entre el ${shortDate(from)} y el ${shortDate(to)}.`
  const vals = pts.map((x) => x.value as number)
  const f = (v: number) => fmtNumber(v, Math.abs(v) >= 100 ? 0 : 1)
  const last = pts.reduce((a, b) => (a.date > b.date ? a : b))
  return `${ariaLabel}. ${pts.length} registros de ${p.label}, mínimo ${f(Math.min(...vals))} ${p.unit}, máximo ${f(Math.max(...vals))} ${p.unit}, último ${f(last.value as number)} ${p.unit} el ${shortDate(last.date)}.`
}
