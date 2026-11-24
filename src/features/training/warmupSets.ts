import type { Repo } from '../../db/repo'
import type { ExerciseSet, SessionExercise, TrainingSession } from '../../db/types'
import { isWarmupSet, isWorkSet, withSetKind } from '../../domain/setKind'
import type { WarmupStep } from '../../domain/warmup'
import { blankSet } from './session'
import { trackSessionWork } from './sessionWork'

export interface AddedWarmups {
  count: number
  /** Removes the rows that are still pending and closes the gap (the toast's "Deshacer"). */
  undo: () => Promise<void>
}

/**
 * Inserts warm-up rows ('calentamiento', never counted as work) for one exercise: after the warm-ups it
 * already has and before its first work row. Later rows move down by the amount inserted; everything is
 * written in one transaction. Warm-ups are excluded from volume, records and previous-work matching by
 * the set-kind rules (domain/setKind.ts), so nothing else needs to know about them.
 */
export function addWarmupSteps(r: Repo, session: Pick<TrainingSession, 'id' | 'date'>, item: SessionExercise, steps: readonly WarmupStep[]): Promise<AddedWarmups> {
  return trackSessionWork(addWarmupStepsNow(r, session, item, steps))
}

async function addWarmupStepsNow(r: Repo, session: Pick<TrainingSession, 'id' | 'date'>, item: SessionExercise, steps: readonly WarmupStep[]): Promise<AddedWarmups> {
  const k = steps.length
  if (!k) return { count: 0, undo: async () => {} }
  const db = r.db
  const addedIds: string[] = []
  let at = 0
  await db.transaction('rw', [db.exerciseSets], async () => {
    const rows = (await r.byIndex('exerciseSets', 'sessionId', session.id)).filter((s) => s.exerciseId === item.exerciseId).sort((a, b) => a.setIndex - b.setIndex)
    const firstWork = rows.find(isWorkSet)
    at = firstWork ? firstWork.setIndex : rows.reduce((m, s) => Math.max(m, s.setIndex + 1), 0)
    for (const s of [...rows].reverse()) if (s.setIndex >= at) await r.update('exerciseSets', s.id, { setIndex: s.setIndex + k })
    for (const [i, step] of steps.entries()) {
      const row = await r.add('exerciseSets', withSetKind({ ...blankSet(session, item, at + i), weight: step.weight, reps: step.reps }, 'warmup'))
      addedIds.push(row.id)
    }
  })
  return {
    count: k,
    undo: async () => {
      await trackSessionWork(
        db.transaction('rw', [db.exerciseSets], async () => {
          const rows = (await r.byIndex('exerciseSets', 'sessionId', session.id)).filter((s) => s.exerciseId === item.exerciseId)
          const removable = rows.filter((s) => addedIds.includes(s.id) && !s.done && isWarmupSet(s))
          if (!removable.length) return
          await r.removeMany('exerciseSets', removable.map((s) => s.id))
          const gone = new Set(removable.map((s) => s.id))
          // Close the gap: every remaining row after the first removed one moves up by what was removed before it.
          const removedIdx = removable.map((s) => s.setIndex).sort((a, b) => a - b)
          for (const s of rows.filter((x) => !gone.has(x.id)).sort((a, b) => a.setIndex - b.setIndex)) {
            const shift = removedIdx.filter((i) => i < s.setIndex).length
            if (shift) await r.update('exerciseSets', s.id, { setIndex: s.setIndex - shift })
          }
        }),
      )
    },
  }
}

/** First working weight of an exercise in this session (done or not): what a warm-up ramp builds towards. */
export function firstWorkWeight(sets: readonly ExerciseSet[]): number | null {
  const w = sets.find((s) => isWorkSet(s) && s.weight !== null && s.weight > 0)?.weight
  return w ?? null
}
