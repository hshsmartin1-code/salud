import type { TrackingType } from '../../db/catalogTypes'
import type { Repo } from '../../db/repo'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { addPendingSets, DEFAULT_REST } from './session'

type OrderItem = TrainingSession['exerciseOrder'][number]

export interface SubstituteTarget {
  id: string
  nameEs: string
  trackingType: TrackingType
}

/**
 * Swaps `item` for `next` in a live session, for the not-yet-done part only.
 * - Pending (not done) sets of the original are removed; the same number is created for the substitute.
 * - With no completed sets the original is replaced in place.
 * - With completed sets the original stays (its sets are history) and the substitute is inserted right after it.
 * Completed sets are never rewritten. Returns false if the substitute is already in the session.
 */
export async function substituteExercise(r: Repo, session: TrainingSession, sets: ExerciseSet[], item: OrderItem, next: SubstituteTarget): Promise<boolean> {
  if (session.exerciseOrder.some((o) => o.exerciseId === next.id)) return false
  const mine = sets.filter((s) => s.exerciseId === item.exerciseId)
  const pending = mine.filter((s) => !s.done)
  const hasDone = mine.some((s) => s.done)
  const newItem: OrderItem = { exerciseId: next.id, name: next.nameEs, trackingType: next.trackingType, restSec: item.restSec ?? DEFAULT_REST[next.trackingType] }
  const order = session.exerciseOrder.flatMap((o) => (o.exerciseId !== item.exerciseId ? [o] : hasDone ? [o, newItem] : [newItem]))
  await r.removeMany('exerciseSets', pending.map((s) => s.id))
  await r.update('trainingSessions', session.id, { exerciseOrder: order })
  await addPendingSets(r, { ...session, exerciseOrder: order }, newItem, Math.max(1, pending.length))
  return true
}
