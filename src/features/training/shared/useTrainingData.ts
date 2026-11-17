import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useRepo } from '../../../app/profile'
import { useToday } from '../../../app/useToday'
import { useExercises } from '../exercises'
import { lastUsedByRoutine, prepareStats } from '../trainingStats'

/**
 * Everything the training home, the history and the routine screens read: routines, finished-session
 * stats (see trainingStats.ts) and the exercise catalog. `ready` is false while any of it is loading.
 */
export function useTrainingData() {
  const r = useRepo()
  const routines = useLiveQuery(() => r.all('routines'), [r])
  const sessions = useLiveQuery(() => r.all('trainingSessions'), [r])
  const sets = useLiveQuery(() => r.all('exerciseSets'), [r])
  const ex = useExercises()
  const prepared = useMemo(() => (sessions && sets ? prepareStats(sessions, sets) : null), [sessions, sets])
  const lastUsed = useMemo(() => (prepared ? lastUsedByRoutine(prepared) : new Map<string, string>()), [prepared])
  // Follows the clock: rolls over at midnight and when the app resumes (useToday).
  const today = useToday()
  // The catalog only adds muscle groups and thumbnails: if it cannot load (offline first run) the screens still work.
  const ready = !!routines && !!prepared && (ex.ready || !!ex.error)
  return { r, routines, sessions, prepared, lastUsed, ex, today, ready }
}
