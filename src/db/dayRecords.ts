import { dayMarkId, habitLogId } from '../domain/dayRecords'
import type { Repo } from './repo'

/**
 * Sets the value of a habit for a day as ONE row with a deterministic id, in a single transaction
 * (upsert): a double tap, two tabs or two synced devices converge on the same row. Rows of the same
 * habit and day left by older versions (random ids) are removed in the same transaction.
 * A value <= 0 clears the day.
 */
export async function setHabitValue(r: Repo, habitId: string, date: string, value: number): Promise<void> {
  const id = habitLogId(r.profileId, habitId, date)
  await r.db.transaction('rw', r.db.habitLogs, async () => {
    const rows = (await r.onDate('habitLogs', date)).filter((l) => l.habitId === habitId)
    const stale = rows.filter((l) => l.id !== id).map((l) => l.id)
    if (stale.length) await r.removeMany('habitLogs', stale)
    if (value > 0) await r.put('habitLogs', { id, habitId, date, value })
    else if (rows.some((l) => l.id === id)) await r.remove('habitLogs', id)
  })
}

/** Sets the day-complete mark as ONE row with a deterministic id (transactional upsert). 'none' removes it. */
export async function setDayMark(r: Repo, date: string, v: 'none' | 'complete' | 'incomplete'): Promise<void> {
  const id = dayMarkId(r.profileId, date)
  await r.db.transaction('rw', r.db.dayMarks, async () => {
    const rows = await r.onDate('dayMarks', date)
    const stale = rows.filter((m) => m.id !== id).map((m) => m.id)
    if (stale.length) await r.removeMany('dayMarks', stale)
    if (v === 'none') {
      if (rows.some((m) => m.id === id)) await r.remove('dayMarks', id)
      return
    }
    await r.put('dayMarks', { id, date, complete: v === 'complete' })
  })
}
