import { useEffect } from 'react'
import type { Profile } from '../../../db/types'
import { useRestTimer, type RestTimer } from '../restTimer'

/** A rest that ended this many seconds ago is forgotten: the bar shows its finished state that long, then folds by itself. */
export const OVER_KEEP_SEC = 3

/** The session's rest timer on this device; forgets a rest that ended a while ago. */
export function useSessionRest(profile: Pick<Profile, 'id' | 'settings'>, sessionId: string): RestTimer {
  const timer = useRestTimer(profile.id, sessionId, { restAlert: profile.settings.training?.restAlert })
  const stale = timer.status === 'over' && timer.overSec >= OVER_KEEP_SEC
  useEffect(() => {
    if (stale) timer.expire() // not skip: a natural end must not cancel the notification waiting in the background
  }, [stale, timer])
  return timer
}
