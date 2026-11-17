import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useProfile, useRepo } from '../../../app/profile'
import { useToday } from '../../../app/useToday'
import { lastUsedByRoutine, prepareStats } from '../trainingStats'
import { doneDates } from './plan'
import { startSuggestion, type StartSuggestion } from './startSuggestion'

/** The start suggestion of today for the active profile (undefined while it loads). Read-only. */
export function useStartSuggestion(): StartSuggestion | undefined {
  const r = useRepo()
  const profile = useProfile()
  const today = useToday()
  const rows = useLiveQuery(async () => {
    const [routines, sessions] = await Promise.all([r.all('routines'), r.all('trainingSessions')])
    return { routines, sessions }
  }, [r])
  const plan = profile.settings.training?.plan
  return useMemo(() => {
    if (!rows) return undefined
    return startSuggestion({ plan, today, done: doneDates(rows.sessions), routines: rows.routines, lastUsed: lastUsedByRoutine(prepareStats(rows.sessions, [])) })
  }, [rows, plan, today])
}
