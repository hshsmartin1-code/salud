/**
 * "Guardar como rutina": builds a routine from what was actually done in a session.
 *
 * - Exercises keep the session order (`exerciseOrder`). An exercise without any completed work set is
 *   left out (a target of zero sets means nothing); warm-ups never count.
 * - Target sets = number of completed work sets (drop and failure sets are work sets).
 * - Target reps = the reps done, as one number ("8") when they are all equal or as a range ("8-10").
 *   Time exercises use seconds ("45 s", "40-60 s"); distance exercises use km ("2,5 km"). Empty when
 *   nothing was recorded.
 * - Rest and the per-exercise note are carried over.
 *
 * Pure: the caller stores the result (`repo.add('routines', …)`). Reused by the training home.
 */
import type { NewRow } from '../../db/repo'
import type { ExerciseSet, Routine, RoutineExercise, TrainingSession } from '../../db/types'
import type { TrackingType } from '../../db/catalogTypes'
import { isWarmupSet, isWorkSet } from '../../domain/setKind'
import { formatNumber } from '../../domain/units'

const range = (values: number[], fmt: (n: number) => string, unit = ''): string => {
  if (!values.length) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const text = lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`
  return unit ? `${text} ${unit}` : text
}

/** The target text for the completed work sets of one exercise. */
export function targetRepsFromSets(sets: readonly Pick<ExerciseSet, 'reps' | 'durationSec' | 'distanceM'>[], tracking: TrackingType): string {
  const nums = (pick: (s: (typeof sets)[number]) => number | null | undefined) =>
    sets.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  switch (tracking) {
    case 'weight_reps':
    case 'bodyweight_reps':
      return range(nums((s) => s.reps), (n) => String(Math.round(n)))
    case 'time':
      return range(nums((s) => s.durationSec), (n) => String(Math.round(n)), 's')
    case 'distance':
      return range(nums((s) => s.distanceM).map((m) => m / 1000), (km) => formatNumber(km, 2), 'km')
  }
}

export interface RoutineFromSessionOptions {
  /** Routine name (default: the session name). */
  name?: string
  /** Key generator for routine exercises (tests pass a deterministic one). */
  makeKey?: (index: number) => string
}

const randomKey = () => Math.random().toString(36).slice(2, 10)

export function routineFromSession(
  session: Pick<TrainingSession, 'name' | 'exerciseOrder' | 'id'>,
  sets: readonly ExerciseSet[],
  opts: RoutineFromSessionOptions = {},
): NewRow<Routine> {
  const makeKey = opts.makeKey ?? randomKey
  const exercises: RoutineExercise[] = []
  for (const item of session.exerciseOrder) {
    const done = sets
      .filter((s) => s.sessionId === session.id && s.exerciseId === item.exerciseId && s.done && isWorkSet(s))
      .sort((a, b) => a.setIndex - b.setIndex)
    if (!done.length) continue
    const ex: RoutineExercise = {
      key: makeKey(exercises.length),
      exerciseId: item.exerciseId,
      name: item.name,
      trackingType: item.trackingType,
      targetSets: done.length,
      targetReps: targetRepsFromSets(done, item.trackingType),
      restSec: item.restSec,
    }
    // Completed warm-up rows become the routine's warm-up count (started first next time).
    const warmups = sets.filter((s) => s.sessionId === session.id && s.exerciseId === item.exerciseId && s.done && isWarmupSet(s)).length
    if (warmups > 0) ex.warmupSets = warmups
    if (item.notes && item.notes.trim()) ex.notes = item.notes
    exercises.push(ex)
  }
  return { name: (opts.name ?? session.name).trim() || 'Rutina', exercises }
}

/** A name that does not clash with existing routines: "Pierna A", then "Pierna A (copia)", "Pierna A (copia 2)"… */
export function uniqueRoutineName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!taken.has(base.trim().toLowerCase())) return base
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${base} (copia)` : `${base} (copia ${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
