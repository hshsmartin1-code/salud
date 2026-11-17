import { useLiveQuery } from 'dexie-react-hooks'
import { useRepo } from '../../app/profile'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import type { ExerciseAliases } from './exerciseKnowledge'
import { getActiveSession, previousForRows } from './session'

/** The active profile's session in progress: undefined while loading, null when there is none. */
export function useActiveSession(): TrainingSession | null | undefined {
  const r = useRepo()
  return useLiveQuery(() => getActiveSession(r), [r])
}

/**
 * Previous comparable set for each row of one exercise (see previousForRows): same exercise
 * (alias-resolved), most recent finished session before this one, matched by ordinal among work sets
 * (warm-ups among warm-ups). undefined while loading.
 */
export function usePreviousSets(session: Pick<TrainingSession, 'id' | 'date' | 'startedAt' | 'createdAt'>, exerciseId: string, rows: readonly ExerciseSet[], aliases: ExerciseAliases = {}): Map<string, ExerciseSet | null> | undefined {
  const r = useRepo()
  const rowsKey = rows.map((s) => `${s.id}:${s.setIndex}:${s.isWarmup ? 1 : 0}:${s.kind ?? ''}`).join('|')
  const aliasKey = Object.keys(aliases).length
  return useLiveQuery(
    () => previousForRows(r, session, exerciseId, rows, aliases),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, session.id, session.date, session.startedAt, exerciseId, rowsKey, aliasKey],
  )
}
