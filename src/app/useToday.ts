import { useEffect, useState } from 'react'
import { APP_TZ, todayLocal } from '../domain/dates'

/**
 * Milliseconds from `now` until the next local midnight in `tz` (plus a small margin so the timer
 * fires on the new day, never a few ms before it). APP_TZ (America/Bogota) has no DST, so a local
 * day is always 24 h; the result is recomputed after every wake-up anyway.
 */
export function msUntilNextMidnight(now: Date, tz: string = APP_TZ, marginMs = 500): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds()
  return Math.max(0, 86_400_000 - elapsed) + marginMs
}

/**
 * The local calendar date (YYYY-MM-DD, APP_TZ), kept current while the app stays open: it updates at
 * the next local midnight (one timer, rescheduled each day) and when the app comes back
 * (`visibilitychange`, `focus`, `pageshow`, e.g. Android resuming the next morning).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayLocal())
  useEffect(() => {
    let timer: number | undefined
    const refresh = () => {
      setToday((prev) => {
        const now = todayLocal()
        return now === prev ? prev : now
      })
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        refresh()
        schedule()
      }, msUntilNextMidnight(new Date()))
    }
    const wake = () => {
      if (document.visibilityState === 'hidden') return
      refresh()
      // Timers can be frozen while hidden: reschedule from the real clock.
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [])
  return today
}
