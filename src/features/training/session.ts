import type { Repo } from '../../db/repo'
import type { ExerciseSet, Routine, TrainingSession } from '../../db/types'
import type { TrackingType } from '../../db/catalogTypes'
import { previousPerformance } from '../../domain/training'
import { todayLocal } from '../../domain/dates'

type OrderItem = TrainingSession['exerciseOrder'][number]

export const DEFAULT_REST: Record<TrackingType, number> = { weight_reps: 120, bodyweight_reps: 90, time: 60, distance: 0 }

/** Last completed sets of an exercise from an earlier session (for prefill and the "anterior" hint). */
export async function lastPerformance(r: Repo, exerciseId: string, date: string, sessionId?: string): Promise<ExerciseSet[]> {
  const all = (await r.byProfileIndex('exerciseSets', 'exerciseId', exerciseId)).filter((s) => s.done)
  const prev = previousPerformance(all, date, sessionId)
  if (!prev) return []
  return (prev.sets as ExerciseSet[]).slice().sort((a, b) => a.setIndex - b.setIndex)
}

function blankSet(session: TrainingSession, item: OrderItem, setIndex: number, from?: ExerciseSet): Omit<ExerciseSet, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> {
  return {
    sessionId: session.id,
    date: session.date,
    exerciseId: item.exerciseId,
    exerciseName: item.name,
    setIndex,
    weight: from?.weight ?? null,
    reps: from?.reps ?? null,
    durationSec: from?.durationSec ?? null,
    distanceM: from?.distanceM ?? null,
    rpe: null,
    isWarmup: from?.isWarmup ?? false,
    done: false,
    origin: 'app',
  }
}

/** Adds `count` pending set rows, prefilled from the previous session of that exercise. */
export async function addPendingSets(r: Repo, session: TrainingSession, item: OrderItem, count: number) {
  const prev = await lastPerformance(r, item.exerciseId, session.date, session.id)
  const existing = (await r.byIndex('exerciseSets', 'sessionId', session.id)).filter((s) => s.exerciseId === item.exerciseId)
  const start = existing.reduce((m, s) => Math.max(m, s.setIndex + 1), 0)
  const work = prev.filter((s) => !s.isWarmup)
  for (let i = 0; i < count; i++) {
    const src = work[Math.min(start + i, work.length - 1)] ?? existing[existing.length - 1]
    await r.add('exerciseSets', blankSet(session, item, start + i, src ? { ...src, isWarmup: false } : undefined))
  }
}

export async function startSession(r: Repo, opts: { routine?: Routine; date?: string; name?: string }): Promise<TrainingSession> {
  const routine = opts.routine
  const session = await r.add('trainingSessions', {
    date: opts.date ?? todayLocal(),
    name: opts.name ?? routine?.name ?? 'Entrenamiento libre',
    routineId: routine?.id ?? null,
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    restEndsAt: null,
    exerciseOrder: (routine?.exercises ?? []).map((e) => ({ exerciseId: e.exerciseId, name: e.name, trackingType: e.trackingType, restSec: e.restSec })),
    origin: 'app',
  })
  for (const e of routine?.exercises ?? []) {
    const item = session.exerciseOrder.find((o) => o.exerciseId === e.exerciseId)!
    await addPendingSets(r, session, item, Math.max(1, e.targetSets))
  }
  return session
}

/** Ends the session; pending (not done) rows are removed so they never count as performed. */
export async function finishSession(r: Repo, session: TrainingSession): Promise<{ removed: number }> {
  const sets = await r.byIndex('exerciseSets', 'sessionId', session.id)
  const pending = sets.filter((s) => !s.done).map((s) => s.id)
  await r.removeMany('exerciseSets', pending)
  const end = new Date()
  const durationMin = session.startedAt ? Math.max(1, Math.round((end.getTime() - new Date(session.startedAt).getTime()) / 60000)) : null
  await r.update('trainingSessions', session.id, { status: 'done', endedAt: end.toISOString(), restEndsAt: null, durationMin: session.durationMin ?? durationMin })
  return { removed: pending.length }
}

export async function deleteSession(r: Repo, session: TrainingSession) {
  const sets = await r.byIndex('exerciseSets', 'sessionId', session.id)
  await r.removeMany('exerciseSets', sets.map((s) => s.id))
  await r.remove('trainingSessions', session.id)
}
