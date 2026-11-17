import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { setKindPatch } from '../../domain/setKind'
import { addSessionExercise, addSetLikeLast, finishSession, markSetDone, moveSessionExercise, removeSessionExercise, startSession, updateSessionExercise } from './session'

// Live-editing helpers of the V3 session screen. Synthetic data only.
let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`editing-${Date.now()}-${n++}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil', sex: 'male', birthDate: '1990-01-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const SQUAT = { id: 'fedb:squat', nameEs: 'Sentadilla', trackingType: 'weight_reps' as const }
const ROW = { id: 'fedb:row', nameEs: 'Remo', trackingType: 'weight_reps' as const }
const PLANK = { id: 'fedb:plank', nameEs: 'Plancha', trackingType: 'time' as const }

async function sessionWith(...exs: (typeof SQUAT | typeof PLANK)[]): Promise<TrainingSession> {
  const s = await startSession(r, { date: '2026-11-10', name: 'Libre' })
  for (const e of exs) await addSessionExercise(r, s.id, e)
  return (await r.get('trainingSessions', s.id))!
}
const setsOf = async (sid: string, eid: string): Promise<ExerciseSet[]> =>
  (await r.byIndex('exerciseSets', 'sessionId', sid)).filter((s) => s.exerciseId === eid).sort((a, b) => a.setIndex - b.setIndex)

describe('session editing helpers', () => {
  it('adds an exercise once, with one pending set and the default rest', async () => {
    const s = await sessionWith(SQUAT)
    expect(await addSessionExercise(r, s.id, SQUAT)).toBe(false)
    const fresh = (await r.get('trainingSessions', s.id))!
    expect(fresh.exerciseOrder).toEqual([{ exerciseId: SQUAT.id, name: 'Sentadilla', trackingType: 'weight_reps', restSec: 120 }])
    expect(await setsOf(s.id, SQUAT.id)).toHaveLength(1)
  })

  it('prefills as many sets as were done last time', async () => {
    const prev = await sessionWith(SQUAT)
    const [first] = await setsOf(prev.id, SQUAT.id)
    await markSetDone(r, first!.id, { weight: 60, reps: 8 }, true)
    await addSetLikeLast(r, prev, prev.exerciseOrder[0]!)
    await addSetLikeLast(r, prev, prev.exerciseOrder[0]!)
    for (const s of await setsOf(prev.id, SQUAT.id)) await r.update('exerciseSets', s.id, { done: true })
    await finishSession(r, prev)
    const next = await sessionWith(SQUAT)
    const rows = await setsOf(next.id, SQUAT.id)
    expect(rows.map((x) => [x.weight, x.reps, x.done])).toEqual([[60, 8, false], [60, 8, false], [60, 8, false]])
  })

  it('patches, moves and removes exercises reading the stored order (never a stale copy)', async () => {
    const stale = await sessionWith(SQUAT, ROW, PLANK)
    await updateSessionExercise(r, stale.id, ROW.id, { restSec: 75 })
    await moveSessionExercise(r, stale.id, PLANK.id, -1) // the stale copy does not know about restSec 75
    let order = (await r.get('trainingSessions', stale.id))!.exerciseOrder
    expect(order.map((o) => o.exerciseId)).toEqual([SQUAT.id, PLANK.id, ROW.id])
    expect(order.find((o) => o.exerciseId === ROW.id)!.restSec).toBe(75)
    await moveSessionExercise(r, stale.id, SQUAT.id, -1) // first: no-op
    await moveSessionExercise(r, stale.id, ROW.id, 1) // last: no-op
    order = (await r.get('trainingSessions', stale.id))!.exerciseOrder
    expect(order.map((o) => o.exerciseId)).toEqual([SQUAT.id, PLANK.id, ROW.id])
    const removed = await removeSessionExercise(r, stale.id, PLANK.id)
    expect(removed).toHaveLength(1)
    expect((await r.get('trainingSessions', stale.id))!.exerciseOrder.map((o) => o.exerciseId)).toEqual([SQUAT.id, ROW.id])
    expect(await setsOf(stale.id, PLANK.id)).toEqual([])
  })

  it('"+ Serie" copies the last row of this session as a normal pending set', async () => {
    const s = await sessionWith(SQUAT)
    const [first] = await setsOf(s.id, SQUAT.id)
    await r.update('exerciseSets', first!.id, { weight: 40, reps: 10, ...setKindPatch('warmup') })
    await addSetLikeLast(r, s, s.exerciseOrder[0]!)
    const rows = await setsOf(s.id, SQUAT.id)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ setIndex: 1, weight: 40, reps: 10, isWarmup: false, done: false })
    expect('kind' in rows[1]!).toBe(false)
  })

  it('completing prefills the next row only when it is empty; un-completing keeps the values', async () => {
    const s = await sessionWith(SQUAT)
    await r.add('exerciseSets', { sessionId: s.id, date: s.date, exerciseId: SQUAT.id, exerciseName: 'Sentadilla', setIndex: 1, weight: null, reps: null, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: false })
    await r.add('exerciseSets', { sessionId: s.id, date: s.date, exerciseId: SQUAT.id, exerciseName: 'Sentadilla', setIndex: 2, weight: 50, reps: null, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: false })
    let rows = await setsOf(s.id, SQUAT.id)
    await markSetDone(r, rows[0]!.id, { weight: 60, reps: 8, rpe: 8 }, true)
    rows = await setsOf(s.id, SQUAT.id)
    expect(rows.map((x) => [x.weight, x.reps, x.done])).toEqual([[60, 8, true], [60, 8, false], [50, null, false]])
    expect(rows[1]!.rpe).toBeNull() // effort is never copied forward
    await markSetDone(r, rows[1]!.id, {}, true)
    expect((await setsOf(s.id, SQUAT.id))[2]!.weight).toBe(50) // not empty: untouched
    await markSetDone(r, rows[0]!.id, {}, false)
    expect((await setsOf(s.id, SQUAT.id))[0]).toMatchObject({ weight: 60, reps: 8, done: false })
  })
})
