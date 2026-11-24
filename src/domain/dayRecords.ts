/**
 * "One value per day" records (habit logs, day-complete marks).
 *
 * Their row id is derived from (profile, [habit], date), so a double tap or two devices writing the
 * same day write the SAME row (upsert) and sync converges on one row instead of two competing ones.
 * Older versions used random ids and could leave several rows for one day: readers collapse them
 * with `latestPerKey` (latest updatedAt wins, never summed) so legacy duplicates are not double counted.
 */
import type { DayMark, HabitLog } from '../db/types'

/** `<profileId>|…` is the repo's composite-id convention (also understood by sync and backup remapping). */
export const habitLogId = (profileId: string, habitId: string, date: string) => `${profileId}|habitlog:${habitId}:${date}`
export const dayMarkId = (profileId: string, date: string) => `${profileId}|daymark:${date}`

type Stamped = { id: string; updatedAt: string }

/** Latest row wins; ties on updatedAt break on id so every device picks the same one. */
const newer = (a: Stamped, b: Stamped) => (a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.id > b.id)

/** One row per key: the most recently updated. Output order follows first appearance of each key. */
export function latestPerKey<T extends Stamped>(rows: readonly T[], key: (r: T) => string): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const k = key(r)
    const cur = best.get(k)
    if (!cur || newer(r, cur)) best.set(k, r)
  }
  return [...best.values()]
}

/** Habit logs collapsed to one per (habit, date). */
export const dedupeHabitLogs = (logs: readonly HabitLog[]): HabitLog[] => latestPerKey(logs, (l) => `${l.habitId}|${l.date}`)

/** The value of a habit on a day (0 when not logged); never a sum across duplicate rows. */
export function habitValueOn(logs: readonly HabitLog[], habitId: string, date: string): number {
  const rows = logs.filter((l) => l.habitId === habitId && l.date === date)
  return rows.length ? latestPerKey(rows, () => 'k')[0]!.value : 0
}

/** Day marks collapsed to one per date. */
export const dedupeDayMarks = (marks: readonly DayMark[]): DayMark[] => latestPerKey(marks, (m) => m.date)

/** The effective mark for a day (null when none). */
export function dayMarkOf(marks: readonly DayMark[]): DayMark | null {
  return marks.length ? latestPerKey(marks, () => 'k')[0]! : null
}
