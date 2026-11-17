/**
 * Training sessions across two devices (V3): "Combinar", session deletion against unsynced changes,
 * retries. Synthetic data only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import type { ExerciseSet, TrainingSession } from '../db/types'
import { deleteSession } from '../features/training/session'
import { canKeepBoth, canMerge, conflictGroups, pendingCount, resolveConflict, syncProfile, type ConflictChoice } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

const ACC = { uid: 'uid-prueba', email: 'prueba@example.test', displayName: 'Persona Prueba' }
const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`session-sync-test-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const SESSION = { date: '2026-11-14', name: 'Empuje', routineId: null, status: 'done', startedAt: '2026-11-14T10:00:00.000Z', endedAt: '2026-11-14T11:00:00.000Z', restEndsAt: null, exerciseOrder: [{ exerciseId: 'fedb:bench', name: 'Press banca', trackingType: 'weight_reps', restSec: 120 }] }
const setRow = (sessionId: string, setIndex: number, weight: number) => ({ sessionId, date: '2026-11-14', exerciseId: 'fedb:bench', exerciseName: 'Press banca', setIndex, weight, reps: 8, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true })

async function pair() {
  const server = new MemoryServer()
  const a = await device()
  const pa = (await createProfile({ name: 'Prueba', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, a)).id
  await linkProfile(a, pa, server.remote(ACC.uid), ACC)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ACC.uid), ACC)
  const sync = (db: SaludDB, pid: string, remote = server.remote(ACC.uid)) => syncProfile(db, pid, remote)
  const ra = repo(pa, a)
  const rb = repo(pb, b)
  const session = (await ra.add('trainingSessions', SESSION as never)) as TrainingSession
  const s0 = (await ra.add('exerciseSets', setRow(session.id, 0, 60) as never)) as ExerciseSet
  const s1 = (await ra.add('exerciseSets', setRow(session.id, 1, 60) as never)) as ExerciseSet
  await sync(a, pa)
  await sync(b, pb)
  return { server, a, b, pa, pb, ra, rb, sync, session, s0, s1 }
}

const strip = (rows: readonly object[]) => (rows as Record<string, unknown>[]).map(({ profileId: _p, ...r }) => (void _p, r)).sort((x, y) => String(x.id).localeCompare(String(y.id)))
async function snapshot(db: SaludDB, pid: string) {
  const r = repo(pid, db)
  return { sessions: strip(await r.all('trainingSessions')), sets: strip(await r.all('exerciseSets')) }
}
function cloud(server: MemoryServer, t: string) {
  return [...server.docs(ACC.uid).values()].filter((d) => d.t === t && !d.del)
}
async function resolveAll(db: SaludDB, pid: string, choice: ConflictChoice) {
  const groups = conflictGroups(await db.syncConflicts.toArray())
  for (const g of groups) await resolveConflict(db, pid, g.conflict.id, choice)
  return groups
}

describe('Combinar (merge) a session edited on two devices', () => {
  it('offers merge (not keep both), keeps every set exactly once and converges on both devices, twice', async () => {
    const { a, b, pa, pb, ra, rb, sync, session, server } = await pair()
    for (const cycle of [1, 2]) {
      server.offline = true
      await ra.update('trainingSessions', session.id, { notes: `A${cycle}`, name: `Empuje A${cycle}` } as never)
      await ra.add('exerciseSets', setRow(session.id, 10 + cycle, 70) as never)
      await rb.update('trainingSessions', session.id, { notes: `B${cycle}` } as never)
      await rb.add('exerciseSets', setRow(session.id, 20 + cycle, 80) as never)
      server.offline = false
      await sync(a, pa)
      expect((await sync(b, pb)).conflicts).toBe(1)
      const [c] = await b.syncConflicts.toArray()
      expect(canMerge(c!)).toBe(true)
      expect(canKeepBoth(c!)).toBe(false)
      await expect(resolveConflict(b, pb, c!.id, 'both')).rejects.toThrow()
      await resolveConflict(b, pb, c!.id, 'merge')
      await sync(b, pb)
      await sync(a, pa)
      expect(await a.syncConflicts.count()).toBe(0)
      expect(await b.syncConflicts.count()).toBe(0)
      const sa = await snapshot(a, pa)
      expect(sa).toEqual(await snapshot(b, pb))
      expect(sa.sessions).toHaveLength(1)
      expect(sa.sets).toHaveLength(2 + cycle * 2)
      expect(new Set(sa.sets.map((s) => s.id)).size).toBe(sa.sets.length)
      const notes = String(sa.sessions[0]!.notes)
      expect(notes).toContain(`A${cycle}`)
      expect(notes).toContain(`B${cycle}`)
      // Plain fields come from the newer edit (B's, made last); there is no common base to diff against.
      expect(sa.sessions[0]!.name).toBe('Empuje')
      expect(await pendingCount(a, pa)).toBe(0)
      expect(await pendingCount(b, pb)).toBe(0)
    }
  })

  it('a lost acknowledgement of the merged row is an idempotent retry, not a new conflict', async () => {
    const { a, b, pa, pb, ra, rb, sync, session, server } = await pair()
    await ra.update('trainingSessions', session.id, { notes: 'A' } as never)
    await rb.update('trainingSessions', session.id, { notes: 'B' } as never)
    await sync(a, pa)
    await sync(b, pb)
    const [c] = await b.syncConflicts.toArray()
    await resolveConflict(b, pb, c!.id, 'merge')
    server.loseAcks = 1
    await expect(sync(b, pb)).rejects.toThrow()
    const r = await sync(b, pb)
    expect(r.conflicts).toBe(0)
    await sync(a, pa)
    expect(await snapshot(a, pa)).toEqual(await snapshot(b, pb))
    expect(await b.syncConflicts.count()).toBe(0)
  })

  it('merge, then a new edit elsewhere before the upload: a second merge converges', async () => {
    const { a, b, pa, pb, ra, rb, sync, session } = await pair()
    await ra.update('trainingSessions', session.id, { notes: 'A1' } as never)
    await rb.update('trainingSessions', session.id, { notes: 'B1' } as never)
    await sync(a, pa)
    await sync(b, pb)
    await resolveConflict(b, pb, (await b.syncConflicts.toArray())[0]!.id, 'merge')
    await ra.update('trainingSessions', session.id, { notes: 'A1\nA2' } as never)
    await sync(a, pa)
    expect((await sync(b, pb)).conflicts).toBe(1)
    await resolveConflict(b, pb, (await b.syncConflicts.toArray())[0]!.id, 'merge')
    await sync(b, pb)
    await sync(a, pa)
    const sa = await snapshot(a, pa)
    expect(sa).toEqual(await snapshot(b, pb))
    expect(String(sa.sessions[0]!.notes).split('\n').sort()).toEqual(['A1', 'A2', 'B1'])
  })

  it('after a merge both devices are quiet: nothing is uploaded again by either one', async () => {
    const { a, b, pa, pb, ra, rb, sync, session, server } = await pair()
    await ra.update('trainingSessions', session.id, { notes: 'A' } as never)
    await rb.update('trainingSessions', session.id, { notes: 'B' } as never)
    await sync(a, pa)
    await sync(b, pb)
    await resolveConflict(b, pb, (await b.syncConflicts.toArray())[0]!.id, 'merge')
    await sync(b, pb)
    const before = server.calls.written
    await sync(a, pa)
    await sync(b, pb)
    expect(server.calls.written).toBe(before) // nothing re-uploaded by either device
  })
})

describe('session deleted on one device while the other has unsynced changes', () => {
  async function receiverCase() {
    const ctx = await pair()
    const { b, pb, ra, rb, sync, session, s0, server } = ctx
    await deleteSession(rb, (await rb.get('trainingSessions', session.id)) as TrainingSession)
    await sync(b, pb)
    expect(cloud(server, 'exerciseSets')).toHaveLength(0)
    // A, offline meanwhile: edits a set and adds a new one.
    await ra.update('exerciseSets', s0.id, { weight: 65 } as never)
    const extra = (await ra.add('exerciseSets', setRow(session.id, 2, 62.5) as never)) as ExerciseSet
    const r = await sync(ctx.a, ctx.pa)
    return { ...ctx, extra, r }
  }

  it('the receiver keeps the session and its sets and asks once (one card with its sets)', async () => {
    const { a, pa, ra, session, extra, r, server } = await receiverCase()
    expect(await ra.get('trainingSessions', session.id)).toBeDefined()
    expect(await ra.count('exerciseSets')).toBe(3)
    const groups = conflictGroups(await a.syncConflicts.toArray())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conflict.table).toBe('trainingSessions')
    expect(groups[0]!.dependents).toHaveLength(2)
    expect(r.conflicts).toBe(3)
    // Nothing of that session goes up while the question is open (not even the new set).
    expect(cloud(server, 'exerciseSets').find((d) => d.id.includes(extra.id))).toBeUndefined()
    expect(await pendingCount(a, pa)).toBe(0)
  })

  it('receiver chooses "this device": the session and all its sets come back on the other device', async () => {
    const { a, b, pa, pb, sync } = await receiverCase()
    await resolveAll(a, pa, 'local')
    expect(await a.syncConflicts.count()).toBe(0)
    await sync(a, pa)
    await sync(b, pb)
    const sb = await snapshot(b, pb)
    expect(sb).toEqual(await snapshot(a, pa))
    expect(sb.sessions).toHaveLength(1)
    expect(sb.sets.map((s) => s.weight).sort()).toEqual([60, 62.5, 65])
  })

  it('receiver accepts the deletion: the session and every set of it go, on both devices', async () => {
    const { a, b, pa, pb, sync, server } = await receiverCase()
    await resolveAll(a, pa, 'remote')
    await sync(a, pa)
    await sync(b, pb)
    for (const [db, pid] of [[a, pa], [b, pb]] as const) {
      expect(await repo(pid, db).count('trainingSessions')).toBe(0)
      expect(await repo(pid, db).count('exerciseSets')).toBe(0)
    }
    expect(cloud(server, 'exerciseSets')).toHaveLength(0)
    expect(await a.syncConflicts.count()).toBe(0)
  })

  async function deleterCase() {
    const ctx = await pair()
    const { a, pa, ra, rb, sync, session, s1 } = ctx
    // Another session whose set B deletes on purpose (it must stay deleted after a restore).
    const other = (await ra.add('trainingSessions', { ...SESSION, date: '2026-11-13', name: 'Tirón' } as never)) as TrainingSession
    const otherSet = (await ra.add('exerciseSets', setRow(other.id, 0, 40) as never)) as ExerciseSet
    await sync(a, pa)
    await sync(ctx.b, ctx.pb)
    // A edits the session and a set, adds a set; B (not synced since) deletes the session.
    await ra.update('trainingSessions', session.id, { notes: 'desde A' } as never)
    await ra.update('exerciseSets', s1.id, { reps: 6 } as never)
    const extra = (await ra.add('exerciseSets', setRow(session.id, 2, 70) as never)) as ExerciseSet
    await sync(a, pa)
    await deleteSession(rb, (await rb.get('trainingSessions', session.id)) as TrainingSession)
    await rb.remove('exerciseSets', otherSet.id)
    const r = await sync(ctx.b, ctx.pb)
    return { ...ctx, other, otherSet, extra, r }
  }

  it('the deleter is asked; meanwhile no set of that session is deleted in the cloud', async () => {
    const { b, server, r, session } = await deleterCase()
    expect(r.conflicts).toBeGreaterThanOrEqual(2) // the session and the edited set
    const groups = conflictGroups(await b.syncConflicts.toArray())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conflict.rowId).toBe(session.id)
    expect(groups[0]!.conflict.local).toBeNull()
    expect(cloud(server, 'exerciseSets').filter((d) => (JSON.parse(d.d!) as { sessionId: string }).sessionId === session.id)).toHaveLength(3)
  })

  it('deleter restores ("the other device"): the session and all its sets are back, the other deletion stays', async () => {
    const { a, b, pa, pb, sync, session, otherSet, server } = await deleterCase()
    await resolveAll(b, pb, 'remote')
    await sync(b, pb)
    await sync(a, pa)
    await sync(b, pb)
    const sb = await snapshot(b, pb)
    expect(sb).toEqual(await snapshot(a, pa))
    expect(sb.sessions.find((s) => s.id === session.id)?.notes).toBe('desde A')
    expect(sb.sets.filter((s) => s.sessionId === session.id)).toHaveLength(3)
    expect(sb.sets.find((s) => s.id === otherSet.id)).toBeUndefined()
    expect(cloud(server, 'exerciseSets').find((d) => d.id.includes(otherSet.id))).toBeUndefined()
    expect(await b.meta.get(`sync.restoreSets|${pb}`)).toBeUndefined()
    expect(await pendingCount(b, pb)).toBe(0)
  })

  it('deleter keeps the deletion: the session and every set (the new one too) are gone everywhere', async () => {
    const { a, b, pa, pb, sync, session, server } = await deleterCase()
    await resolveAll(b, pb, 'local')
    await sync(b, pb)
    await sync(a, pa)
    for (const [db, pid] of [[a, pa], [b, pb]] as const) {
      expect(await repo(pid, db).get('trainingSessions', session.id)).toBeUndefined()
      expect(((await repo(pid, db).all('exerciseSets')) as ExerciseSet[]).filter((s) => s.sessionId === session.id)).toHaveLength(0)
    }
    expect(cloud(server, 'exerciseSets').filter((d) => (JSON.parse(d.d!) as { sessionId: string }).sessionId === session.id)).toHaveLength(0)
    expect(await snapshot(a, pa)).toEqual(await snapshot(b, pb))
  })

  it('race in the upload itself (the edit lands between the pull and the push): set deletions are held', async () => {
    const { a, b, pa, pb, ra, rb, sync, session, server } = await pair()
    await deleteSession(rb, (await rb.get('trainingSessions', session.id)) as TrainingSession)
    await ra.update('trainingSessions', session.id, { notes: 'justo ahora' } as never)
    const remote = server.remote(ACC.uid)
    const commit = remote.commit.bind(remote)
    let hook: (() => Promise<unknown>) | null = () => sync(a, pa)
    remote.commit = async (w) => {
      const h = hook
      hook = null
      if (h) await h()
      return commit(w)
    }
    const r = await sync(b, pb, remote)
    expect(r.conflicts).toBe(1)
    expect(cloud(server, 'exerciseSets')).toHaveLength(2) // nothing deleted
    await resolveAll(b, pb, 'remote')
    await sync(b, pb)
    expect(await snapshot(b, pb)).toEqual(await snapshot(a, pa))
    expect(await repo(pb, b).count('exerciseSets')).toBe(2)
  })

  it('a single set deleted elsewhere is still a normal deletion (no question)', async () => {
    const { a, b, pa, pb, ra, rb, sync, s0, s1 } = await pair()
    await rb.remove('exerciseSets', s0.id)
    await sync(b, pb)
    await ra.update('exerciseSets', s1.id, { weight: 61 } as never)
    const r = await sync(a, pa)
    expect(r.conflicts).toBe(0)
    expect(await ra.get('exerciseSets', s0.id)).toBeUndefined()
    await sync(b, pb)
    expect(await snapshot(a, pa)).toEqual(await snapshot(b, pb))
  })

  it('a set deleted on one device and edited on the other is one set conflict; "this device" re-uploads it', async () => {
    const { a, b, pa, pb, ra, rb, sync, s0 } = await pair()
    await rb.remove('exerciseSets', s0.id)
    await sync(b, pb)
    await ra.update('exerciseSets', s0.id, { weight: 67.5 } as never)
    expect((await sync(a, pa)).conflicts).toBe(1)
    const [c] = await a.syncConflicts.toArray()
    expect(c!.remote).toBeNull()
    expect(conflictGroups([c!])[0]!.dependents).toHaveLength(0)
    await resolveConflict(a, pa, c!.id, 'local')
    await sync(a, pa)
    await sync(b, pb)
    expect(((await rb.get('exerciseSets', s0.id)) as ExerciseSet).weight).toBe(67.5)
  })
})
