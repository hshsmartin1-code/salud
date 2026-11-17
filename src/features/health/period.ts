/**
 * The Salud period lives in the URL (`?p=7|30|90|custom:AAAA-MM-DD..AAAA-MM-DD`) so it survives going to a
 * detail page and back. Pure helpers (no React, no router): parsing, ranges, labels and link building.
 */
import { addDays, daysBetween, formatDateEs } from '../../domain/dates'
import { makeCustomPeriod, parseCustomPeriod, validateCustomRange } from '../../ui/period'
import { periodRange, previousRange, rangeLength, type DateRange } from './series'

export const PERIOD_PARAM = 'p'
export const DEFAULT_PERIOD = '30'
export const PERIOD_OPTIONS = [
  { value: '7', label: '7 d' },
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
] as const
/** Longest custom range (days). Longer ones keep their end and lose the oldest days. */
export const MAX_CUSTOM_DAYS = 366

export interface ResolvedPeriod {
  /** Normalised URL value: '7' | '30' | '90' | 'custom:…'. */
  value: string
  range: DateRange
  previous: DateRange
  days: number
  custom: boolean
}

/** Any string from the URL → a valid period value (default when it is missing or malformed). */
export function normalizePeriod(raw: string | null | undefined, today: string): string {
  if (!raw) return DEFAULT_PERIOD
  if (raw === '7' || raw === '30' || raw === '90') return raw
  const c = parseCustomPeriod(raw)
  if (c && validateCustomRange(c.from, c.to) === null && c.from <= today) return makeCustomPeriod(c.from, c.to > today ? today : c.to)
  return DEFAULT_PERIOD
}

export function resolvePeriod(raw: string | null | undefined, today: string): ResolvedPeriod {
  const value = normalizePeriod(raw, today)
  const c = parseCustomPeriod(value)
  let range: DateRange
  if (c) {
    const days = daysBetween(c.from, c.to) + 1
    range = { from: days > MAX_CUSTOM_DAYS ? addDays(c.to, -(MAX_CUSTOM_DAYS - 1)) : c.from, to: c.to }
  } else range = periodRange(today, Number(value))
  return { value, range, previous: previousRange(range), days: rangeLength(range), custom: !!c }
}

/** "Últimos 30 días" or "12 oct – 14 nov". */
export function periodTitle(p: ResolvedPeriod): string {
  if (p.custom) return rangeText(p.range)
  return `Últimos ${p.days} días`
}

/** "12 oct – 14 nov". */
export const rangeText = (r: DateRange): string => `${formatDateEs(r.from)} – ${formatDateEs(r.to)}`

/** What the change is compared with: "vs. 30 d anteriores". */
export function comparisonLabel(p: ResolvedPeriod): string {
  return p.custom ? 'vs. periodo anterior' : `vs. ${p.days} d anteriores`
}

/** "Frente a los 30 días anteriores": said once on the overview instead of in every panel. */
export const comparisonSentence = (p: ResolvedPeriod): string => (p.custom ? 'Frente al periodo anterior' : `Frente a los ${p.days} días anteriores`)

/** Adds or replaces query parameters of a route path ("/sueno?x=1" + {p:'30'}); null removes one. */
export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const [base, query = ''] = path.split('?')
  const q = new URLSearchParams(query)
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) q.delete(k)
    else q.set(k, v)
  }
  const s = q.toString()
  return s ? `${base}?${s}` : (base as string)
}

/** Link to a route that keeps the period (and optionally selects a tab with `m`). */
export function withPeriod(path: string, period: string, extra: Record<string, string | null | undefined> = {}): string {
  return withQuery(path, { [PERIOD_PARAM]: period, ...extra })
}

/**
 * Days of history the screens load once so changing between 7, 30 and 90 days never reloads: the previous
 * period of the longest preset (180 days) plus a day of margin. Custom ranges extend it when needed.
 */
export const PRESET_WINDOW_DAYS = 181
export function loadFrom(p: ResolvedPeriod, today: string): string {
  const preset = addDays(today, -PRESET_WINDOW_DAYS)
  return p.previous.from < preset ? p.previous.from : preset
}
