import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '../../../app/profile'
import { isNativePlatform } from '../../../integrations/notifications/native'
import { clearAllTrainingReminders, syncTrainingReminders, type DesiredReminder } from '../../../integrations/notifications/planReminders'
import { desiredReminders } from './plan'
import { usePlan } from './usePlan'

/** Wait this long after the last change before touching the system, so quick edits and profile loading settle first. */
const SETTLE_MS = 400

/**
 * Mount once, keyed by the active profile (`<TrainingReminderSync key={profile.id} />`): it keeps the system's
 * scheduled reminders equal to what the plan of THAT profile asks for. Renders nothing; does nothing on the web.
 *
 * Runs (the reconcile is idempotent, so a trigger that changes nothing makes no native scheduling call):
 *  - when the app starts with a profile, and when the profile changes (the previous profile's reminders are cancelled);
 *  - when the app returns to the foreground (`visibilitychange`, `focus`, `pageshow`);
 *  - when the plan, its reminder switch or time, or the routines' names change;
 *  - when a session is finished, deleted or re-dated (the finished days change);
 *  - at the local midnight rollover (`useToday` moves `today`).
 * Turning the reminder off or removing the plan makes `desired` empty, which cancels everything scheduled.
 */
export function TrainingReminderSync(): null {
  const profile = useProfile()
  const p = usePlan()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== 'hidden') setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [])

  // The instant is read from the real clock each time the dependencies change or the app wakes up.
  const desiredKey = useMemo(() => {
    if (!p.ready) return null
    return JSON.stringify(desiredReminders(p.plan, Date.now(), p.done, p.routines))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` re-reads the clock when the app returns to the foreground
  }, [p.ready, p.plan, p.done, p.routines, p.today, tick])

  useEffect(() => {
    if (desiredKey === null || !isNativePlatform()) return
    const timer = window.setTimeout(() => void syncTrainingReminders(profile.id, JSON.parse(desiredKey) as DesiredReminder[]), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [profile.id, desiredKey, p.today, tick])

  return null
}

/**
 * Mount where the app has NO profile after having had one (the last profile was removed): the synchroniser above is
 * unmounted then, so the reminders it scheduled are cancelled here. Renders nothing; does nothing on the web.
 */
export function TrainingReminderCleanup(): null {
  useEffect(() => {
    if (isNativePlatform()) void clearAllTrainingReminders()
  }, [])
  return null
}
