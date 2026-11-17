import { addDays } from '../../domain/dates'

/** Health Connect only lets an app read 30 days before the first grant (we never request history). */
export const WINDOW_DAYS = 30
/** Daily aggregates are always recomputed for at least this many days (late data from a band, priority changes). */
export const RECOMPUTE_DAYS = 7

export interface SyncPlan {
  kind: 'first' | 'incremental'
  /** Daily aggregates are recomputed in [dailyFrom, today]. */
  dailyFrom: string
  today: string
  /** Where to re-read raw records when there is no token or it expired: max(lastSync − 1d, today − 30d). */
  rawFrom: string
}

const max = (a: string, b: string) => (a >= b ? a : b)
const min = (a: string, b: string) => (a <= b ? a : b)

/**
 * First sync: the whole 30-day window. Incremental: the last 7 days — or further back if the last sync was
 * longer ago, so there is never a gap — never beyond the 30-day window.
 */
export function planSync(today: string, lastSyncTo: string | null): SyncPlan {
  const windowStart = addDays(today, -(WINDOW_DAYS - 1))
  if (!lastSyncTo) return { kind: 'first', dailyFrom: windowStart, today, rawFrom: windowStart }
  const since = addDays(lastSyncTo, -1)
  return {
    kind: 'incremental',
    dailyFrom: max(windowStart, min(addDays(today, -(RECOMPUTE_DAYS - 1)), since)),
    today,
    rawFrom: max(windowStart, since),
  }
}
