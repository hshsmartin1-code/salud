/**
 * Training calendar (pure): weeks start on Monday, dates are local YYYY-MM-DD strings, and a day counts
 * as trained when it has at least one finished session that counts in stats (see prepareStats).
 */
import { addDays, isoWeekStart } from '../../domain/dates'
import type { Prepared } from './trainingStats'

export interface CalendarDay {
  date: string
  /** Counted sessions of that day, newest first. */
  sessions: { id: string; name: string }[]
  future: boolean
  today: boolean
}

/** The last `weeks` weeks (oldest first) ending with the week of `today`, 7 days each, Monday first. */
export function calendarWeeks(p: Prepared, today: string, weeks = 5): CalendarDay[][] {
  const byDate = new Map<string, { id: string; name: string }[]>()
  for (const s of p.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), { id: s.id, name: s.name }])
  const start = addDays(isoWeekStart(today), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      return { date, sessions: byDate.get(date) ?? [], future: date > today, today: date === today }
    }),
  )
}

/**
 * Consecutive ISO weeks with at least one counted session. The current week counts when it already has
 * one; when it has none it is not over yet, so the count starts at the previous week.
 */
export function weekStreak(p: Prepared, today: string): number {
  const weeksWith = new Set(p.sessions.map((s) => isoWeekStart(s.date)))
  let w = isoWeekStart(today)
  if (!weeksWith.has(w)) w = addDays(w, -7)
  let n = 0
  while (weeksWith.has(w)) {
    n++
    w = addDays(w, -7)
  }
  return n
}

/** "3 semanas seguidas con al menos 1 sesión"; only from 2 weeks on, never a score. */
export function streakText(n: number): string | null {
  return n >= 2 ? `${n} semanas seguidas con al menos 1 sesión` : null
}
