/**
 * What the big number of a Progreso panel says. Under "Últimos 90 días" a bare value is ambiguous (it used
 * to be today's partial total), so each panel states what it is:
 *  - `sum` metrics (kcal, protein, steps, sleep per day; volume per week): the average of the COMPLETE
 *    periods with data. The day (week) in progress is left out, the way the Salud panels do.
 *  - `level` metrics (weight, waist, body fat, 1RM): the latest value, with its date.
 */
export interface HeadlinePoint {
  date: string
  value: number | null
  /** Weekly bars: days of the bar's week elapsed so far (7 = complete). Absent for daily points. */
  span?: number
}

export type HeadlineKind = 'sum' | 'level'

export interface Headline {
  value: number | null
  /** "Media diaria", "Media semanal", "Último valor". */
  label: string
  /** Number of periods behind a mean (sum) or 1 (level). */
  n: number
  /** Date of the latest value (level) or of the latest complete period (sum); null if none. */
  date: string | null
  /** The in-progress day/week was left out of the average. */
  partialExcluded: boolean
}

export function headlineOf(points: HeadlinePoint[], kind: HeadlineKind, today: string, weekly = false): Headline {
  const have = points.filter((p): p is HeadlinePoint & { value: number } => p.value !== null).sort((a, b) => a.date.localeCompare(b.date))
  if (kind === 'level') {
    const last = have.at(-1)
    return { value: last ? last.value : null, label: 'Último valor', n: last ? 1 : 0, date: last?.date ?? null, partialExcluded: false }
  }
  const complete = have.filter((p) => (weekly ? (p.span ?? 7) >= 7 : p.date < today))
  const value = complete.length ? complete.reduce((s, p) => s + p.value, 0) / complete.length : null
  return { value, label: weekly ? 'Media semanal' : 'Media diaria', n: complete.length, date: complete.at(-1)?.date ?? null, partialExcluded: complete.length < have.length }
}

/** Sub-line under the big number: what it is, with its date for level metrics, and the period. */
export function headlinePeriod(h: Headline, periodText: string, today: string, dateText: (d: string) => string): string {
  if (h.label === 'Último valor') return h.date ? `Último valor (${h.date === today ? 'hoy' : dateText(h.date)}) · ${periodText}` : periodText
  return h.value === null ? `${h.label} · sin periodos completos` : `${h.label} · ${periodText}`
}
