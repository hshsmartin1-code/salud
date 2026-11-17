import type { HydrationLog } from '../db/types'
import { addDays } from './dates'

/** Total ml per date (only dates that have entries). */
export function dailyTotals(logs: readonly Pick<HydrationLog, 'date' | 'ml'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of logs) out[l.date] = (out[l.date] ?? 0) + l.ml
  return out
}

/** One value per date; null when nothing was logged that day (missing is not zero). */
export function seriesFor(totals: Record<string, number>, dates: readonly string[]): (number | null)[] {
  return dates.map((d) => (d in totals ? totals[d]! : null))
}

/**
 * Consecutive days with total >= goal. Ends today if today is already met; otherwise ends yesterday
 * (today is still in progress and does not break the streak).
 */
export function goalStreak(totals: Record<string, number>, goal: number | null | undefined, today: string): number {
  if (!goal || goal <= 0) return 0
  let day = (totals[today] ?? 0) >= goal ? today : addDays(today, -1)
  let n = 0
  while ((totals[day] ?? 0) >= goal) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/** Mean over days WITH records only; null when there are none. */
export function meanOverRecordedDays(totals: Record<string, number>, dates: readonly string[]): number | null {
  const xs = dates.filter((d) => d in totals).map((d) => totals[d]!)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export const QUICK_ADD = [
  { ml: 250, label: 'Vaso', drink: 'vaso' },
  { ml: 500, label: 'Botella', drink: 'botella' },
] as const

/** Plausible single entry, to catch typos. */
export function validateMl(ml: number | null): string | null {
  if (ml === null) return 'Ingresa una cantidad en ml.'
  if (ml < 10 || ml > 3000) return 'La cantidad debe estar entre 10 y 3000 ml.'
  return null
}
export function validateGoalMl(ml: number | null): string | null {
  if (ml === null) return 'Ingresa una meta en ml.'
  if (ml < 500 || ml > 10000) return 'La meta debe estar entre 500 y 10000 ml.'
  return null
}
