/**
 * "Terminar" with completion of touched rows, and "Deshacer" (reopen), including how it converges with
 * sync whether or not the deletion was already pushed. Synthetic data only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { syncProfile } from '../../sync/engine'
import { createProfileFromAccount, linkProfile } from '../../sync/link'
import { MemoryServer } from '../../sync/memoryRemote'
import { deleteSession, getActiveSession, reopenSession, startSession } from './session'
import { applyAndTouch, finishSessionWhenSettled, markSetTouched, touchedSetIds, undoFinish } from './sessionWork'

const ACC = { uid: 'uid-sintetico', email: 'sintetico@example.test', displayName: 'Persona Sintetica' }
const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`finish-undo-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const PROFILE = { name: 'Perfil sintetico', sex: 'female' as const, birthDate: '1990-01-01', heightCm: 165, activity: 'moderate' as const, color: 'violet' as const, settings: { addActivityKcal: false } }

async function sessionWithRows(r: Repo) {
  const session = await startSession(r, {})
  await r.update('trainingSessions', session.id, { exerciseOrder: [{ exerciseId: 'synthetic:lift', name: 'Ejercicio sintetico', trackingType: 'weight_reps', restSec: 90 }] })
  const row = (setIndex: number, done: boolean, weight: number | null, reps: number | null) =>
    r.add('exerciseSets', { sessionId: session.id, date: session.date, exerciseId: 'synthetic:lift', exerciseName: 'Ejercicio sintetico', setIndex, weight, reps, rpe: null, durationSec: null, distanceM: null, isWarmup: false, done })
  const done = await row(0, true, 60, 8)
  const typed = await row(1, false, 62.5, 8) // performed, values typed, not ticked
  const prefilled = await row(2, false, 60, 8) // prefilled from last time, never touched
  const half = await row(3, false, 60, null) // touched but incomplete
  markSetTouched(session.id, typed.id)
  markSetTouched(session.id, half.id)
  return { session: (await r.get('trainingSessions', session.id))!, done, typed, prefilled, half }
}

const ids = (rows: readonly ExerciseSet[]) => rows.map((s) => s.id).sort()

describe('finish and undo', () => {
  it('"Marcar como hechas" keeps touched rows with data; untouched and incomplete rows are discarded; undo restores everything', async () => {
    const db = await device()
    const p = await createProfile(PROFILE, db)
    const r = repo(p.id, db)
    const { session, done, typed, prefilled, half } = await sessionWithRows(r)
    const before = await r.byIndex('exerciseSets', 'sessionId', session.id)

    const out = await finishSessionWhenSettled(r, session, { complete: [typed.id, half.id] })
    expect(out.completed).toBe(1) // half has no reps: cannot be a done set
    expect(ids(await r.byIndex('exerciseSets', 'sessionId', session.id))).toEqual([done.id, typed.id].sort())
    expect(await r.get('exerciseSets', typed.id)).toMatchObject({ done: true, weight: 62.5 })
    expect(ids(out.snapshot.removed)).toEqual([prefilled.id, half.id].sort())
    expect(touchedSetIds(session.id).size).toBe(0)

    expect(await undoFinish(r, out.snapshot, out.touchedIds)).toBe(true)
    expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'active', endedAt: null })
    expect(await r.byIndex('exerciseSets', 'sessionId', session.id)).toEqual(expect.arrayContaining(before.map((s) => expect.objectContaining({ id: s.id, done: s.done, weight: s.weight, reps: s.reps }))))
    expect(await r.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(4)
    expect([...touchedSetIds(session.id)].sort()).toEqual([typed.id, half.id].sort())
  })

  it('undo is refused when another session became active meanwhile', async () => {
    const db = await device()
    const p = await createProfile(PROFILE, db)
    const r = repo(p.id, db)
    const { session } = await sessionWithRows(r)
    const out = await finishSessionWhenSettled(r, session)
    const other = await startSession(r, {})
    expect(await reopenSession(r, out.snapshot)).toBe(false)
    expect((await getActiveSession(r))?.id).toBe(other.id)
    expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'done' })
  })

  it('undo refuses a later edit to the finished session without replacing it', async () => {
    const db = await device()
    const r = repo((await createProfile(PROFILE, db)).id, db)
    const { session } = await sessionWithRows(r)
    const out = await finishSessionWhenSettled(r, session)
    await r.update('trainingSessions', session.id, { notes: 'Escrita después de terminar' })
    expect(await undoFinish(r, out.snapshot, out.touchedIds)).toBe(false)
    expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'done', notes: 'Escrita después de terminar' })
    expect(await r.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(1)
  })

  it('undo refuses a later edit to a set completed by finishing', async () => {
    const db = await device()
    const r = repo((await createProfile(PROFILE, db)).id, db)
    const { session, typed } = await sessionWithRows(r)
    const out = await finishSessionWhenSettled(r, session, { complete: [typed.id] })
    await r.update('exerciseSets', typed.id, { reps: 9 })
    expect(await undoFinish(r, out.snapshot, out.touchedIds)).toBe(false)
    expect(await r.get('exerciseSets', typed.id)).toMatchObject({ done: true, reps: 9 })
    expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'done' })
  })

  async function linked() {
    const server = new MemoryServer()
    const a = await device()
    const pa = (await createProfile(PROFILE, a)).id
    await linkProfile(a, pa, server.remote(ACC.uid), ACC)
    const b = await device()
    const { profileId: pb } = await createProfileFromAccount(b, server.remote(ACC.uid), ACC)
    return { server, a, b, pa, pb, ra: repo(pa, a), rb: repo(pb, b) }
  }
  const cloudSets = (server: MemoryServer) => [...server.docs(ACC.uid).values()].filter((d) => d.t === 'exerciseSets' && !d.del).length

  it('sync converges when undo happens before the deletion was pushed', async () => {
    const { server, a, b, pa, pb, ra, rb } = await linked()
    const { session } = await sessionWithRows(ra)
    await syncProfile(a, pa, server.remote(ACC.uid))
    expect(cloudSets(server)).toBe(4)
    const out = await finishSessionWhenSettled(ra, session)
    expect(await undoFinish(ra, out.snapshot, out.touchedIds)).toBe(true)
    await syncProfile(a, pa, server.remote(ACC.uid))
    await syncProfile(b, pb, server.remote(ACC.uid))
    expect(cloudSets(server)).toBe(4)
    expect(await rb.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(4)
    expect((await rb.get('trainingSessions', session.id)) as TrainingSession).toMatchObject({ status: 'active' })
  })

  it('sync converges when the deletion was already pushed: the same ids come back', async () => {
    const { server, a, b, pa, pb, ra, rb } = await linked()
    const { session } = await sessionWithRows(ra)
    await syncProfile(a, pa, server.remote(ACC.uid))
    const out = await finishSessionWhenSettled(ra, session)
    await syncProfile(a, pa, server.remote(ACC.uid)) // deletions pushed
    expect(cloudSets(server)).toBe(1)
    await syncProfile(b, pb, server.remote(ACC.uid))
    expect(await rb.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(1)

    expect(await undoFinish(ra, out.snapshot, out.touchedIds)).toBe(true)
    await syncProfile(a, pa, server.remote(ACC.uid))
    await syncProfile(b, pb, server.remote(ACC.uid))
    expect(cloudSets(server)).toBe(4)
    expect(ids(await rb.byIndex('exerciseSets', 'sessionId', session.id))).toEqual(ids(await ra.byIndex('exerciseSets', 'sessionId', session.id)))
    expect(await rb.get('trainingSessions', session.id)).toMatchObject({ status: 'active' })
    expect(await a.syncConflicts.count()).toBe(0)
  })

  it('applying values writes pending rows only, marks them touched, and undo restores values and touched state', async () => {
    const db = await device()
    const r = repo((await createProfile(PROFILE, db)).id, db)
    const { session, done, typed, prefilled } = await sessionWithRows(r)
    const { count, undo } = await applyAndTouch(r, session.id, [done.id, typed.id, prefilled.id], { weight: 65, reps: 10 })
    expect(count).toBe(2)
    expect(await r.get('exerciseSets', done.id)).toMatchObject({ weight: 60, reps: 8, done: true })
    expect(await r.get('exerciseSets', prefilled.id)).toMatchObject({ weight: 65, reps: 10 })
    expect(touchedSetIds(session.id).has(prefilled.id)).toBe(true)
    await r.update('exerciseSets', typed.id, { reps: 9 }) // edited after applying: kept by undo
    await undo()
    expect(await r.get('exerciseSets', prefilled.id)).toMatchObject({ weight: 60, reps: 8 })
    expect(await r.get('exerciseSets', typed.id)).toMatchObject({ weight: 65, reps: 9 })
    expect(touchedSetIds(session.id).has(prefilled.id)).toBe(false)
    expect(touchedSetIds(session.id).has(typed.id)).toBe(true) // was touched before
  })

  it('undo of applied values keeps touched state when a later edit prevents restoration', async () => {
    const db = await device()
    const r = repo((await createProfile(PROFILE, db)).id, db)
    const { session, prefilled } = await sessionWithRows(r)
    const { undo } = await applyAndTouch(r, session.id, [prefilled.id], { weight: 65, reps: 10 })
    await r.update('exerciseSets', prefilled.id, { reps: 11 })
    await undo()
    expect(await r.get('exerciseSets', prefilled.id)).toMatchObject({ weight: 65, reps: 11 })
    expect(touchedSetIds(session.id).has(prefilled.id)).toBe(true)
  })

  it('deleteSession removes the session and its sets in one transaction (a failure keeps everything)', async () => {
    const db = await device()
    const r = repo((await createProfile(PROFILE, db)).id, db)
    const { session } = await sessionWithRows(r)
    await db.trainingSessions.delete(session.id) // the session row vanishes: removing it fails mid-way
    await expect(deleteSession(r, session)).rejects.toThrow()
    expect(await r.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(4) // rolled back
    await db.trainingSessions.put(session)
    await deleteSession(r, session)
    expect(await r.byIndex('exerciseSets', 'sessionId', session.id)).toHaveLength(0)
    expect(await r.get('trainingSessions', session.id)).toBeUndefined()
  })
})
