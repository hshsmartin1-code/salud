import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../src/db/profiles'
import { repo } from '../src/db/repo'
import { createDB, type SaludDB } from '../src/db/schema'
import type { ExerciseSet, TrainingSession } from '../src/db/types'
import { deleteSession } from '../src/features/training/session'
import { encodeRow } from '../src/sync/codec'
import { canMerge, conflictGroups, pendingCount, resolveConflict, syncProfile } from '../src/sync/engine'
import { FirestoreRemote } from '../src/sync/firestoreRemote'
import { createProfileFromAccount, linkProfile } from '../src/sync/link'
import { V221_ROUTINE, V221_SESSION, V221_SET, V221_WARMUP_SET } from '../src/test/fixtures/v221Rows'

// V3 training data against the Firestore emulator and the real security rules. Synthetic data.
let env: RulesTestEnvironment
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
const ACC = { uid: 'uid-v3', email: 'v3@example.test', displayName: 'Persona Prueba' }

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-salud', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } })
})
afterAll(() => env.cleanup())
beforeEach(() => env.clearFirestore())

const remote = () => new FirestoreRemote(env.authenticatedContext(ACC.uid).firestore() as unknown as Firestore, ACC.uid)
const dbs: SaludDB[] = []
let n = 0
async function device() {
  const db = createDB(`emu-v3-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const { id: _sid, profileId: _sp, ...SESSION_FIELDS } = clone(V221_SESSION)
const { id: _setid, profileId: _setp, sessionId: _ss, ...SET_FIELDS } = clone(V221_SET)
void [_sid, _sp, _setid, _setp, _ss]

async function pair(seed?: (db: SaludDB, pid: string) => Promise<void>) {
  const a = await device()
  const pa = (await createProfile({ name: 'Prueba', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false, training: { autoRest: true, effort: 'rir', restAlert: false } } }, a)).id
  if (seed) await seed(a, pa)
  await linkProfile(a, pa, remote(), ACC)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, remote(), ACC)
  return { a, b, pa, pb, sync: (db: SaludDB, pid: string) => syncProfile(db, pid, remote()) }
}
const strip = (rows: readonly object[]) => (rows as Record<string, unknown>[]).map(({ profileId: _p, ...r }) => (void _p, r)).sort((x, y) => String(x.id).localeCompare(String(y.id)))
async function snapshot(db: SaludDB, pid: string) {
  const r = repo(pid, db)
  return { routines: strip(await r.all('routines')), sessions: strip(await r.all('trainingSessions')), sets: strip(await r.all('exerciseSets')) }
}

describe('V3 training fields over Firestore', () => {
  it('new optional fields round-trip byte for byte to a second device', async () => {
    const { a, b, pa, pb } = await pair(async (db, pid) => {
      const r = repo(pid, db)
      const { id: _rid, profileId: _rp, ...routine } = clone(V221_ROUTINE)
      void [_rid, _rp]
      await r.add('routines', { ...routine, order: 1 } as never)
      const s = await r.add('trainingSessions', {
        ...SESSION_FIELDS,
        exerciseOrder: [{ exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 150, targetSets: 4, targetReps: '6-8', notes: 'Profundidad paralela' }],
      } as never)
      await r.add('exerciseSets', { ...SET_FIELDS, sessionId: s.id, kind: 'drop', rir: 2 } as never)
      await r.add('exerciseSets', { ...SET_FIELDS, sessionId: s.id, setIndex: 2, kind: 'failure', rir: 0 } as never)
      await r.add('exerciseSets', { ...SET_FIELDS, sessionId: s.id, setIndex: 3, rir: null } as never)
    })
    const sa = await snapshot(a, pa)
    expect(await snapshot(b, pb)).toEqual(sa)
    const setsB = (await repo(pb, b).all('exerciseSets')) as ExerciseSet[]
    for (const s of setsB) {
      const mine = (await repo(pa, a).get('exerciseSets', s.id))!
      expect(encodeRow('exerciseSets', s as never, pb).d).toBe(encodeRow('exerciseSets', mine as never, pa).d)
    }
    expect(setsB.map((s) => s.kind ?? 'normal').sort()).toEqual(['drop', 'failure', 'normal'])
    expect((await b.profiles.get(pb))?.settings.training).toEqual({ autoRest: true, effort: 'rir', restAlert: false })
    expect(await pendingCount(a, pa)).toBe(0)
    expect(await pendingCount(b, pb)).toBe(0)
  })

  it('2.2.1-shaped rows (no new field) are never re-uploaded by a V3 client', async () => {
    const { a, b, pa, pb, sync } = await pair(async (db, pid) => {
      await db.routines.put({ ...clone(V221_ROUTINE), profileId: pid } as never)
      await db.trainingSessions.put({ ...clone(V221_SESSION), profileId: pid } as never)
      await db.exerciseSets.bulkPut([{ ...clone(V221_SET), profileId: pid }, { ...clone(V221_WARMUP_SET), profileId: pid }] as never)
    })
    for (const [db, pid] of [[a, pa], [b, pb], [a, pa], [b, pb]] as const) {
      const r = await sync(db, pid)
      expect(r.pushed).toBe(0)
      expect(r.conflicts).toBe(0)
    }
    // Byte-identical to the frozen rows on the second device.
    expect(await b.trainingSessions.get(V221_SESSION.id)).toEqual({ ...V221_SESSION, profileId: pb })
    expect(await b.exerciseSets.get(V221_SET.id)).toEqual({ ...V221_SET, profileId: pb })
  })
})

describe('two devices, one session (T3)', () => {
  async function sessionPair() {
    let sessionId = ''
    const ctx = await pair(async (db, pid) => {
      const r = repo(pid, db)
      const s = await r.add('trainingSessions', { ...SESSION_FIELDS } as never)
      sessionId = s.id
      await r.add('exerciseSets', { ...SET_FIELDS, sessionId: s.id } as never)
    })
    return { ...ctx, sessionId }
  }

  it('offline edits on both → conflict → Combinar → identical rows, each set once, no new conflict (two cycles)', async () => {
    const { a, b, pa, pb, sync, sessionId } = await sessionPair()
    for (const cycle of [1, 2]) {
      await repo(pa, a).update('trainingSessions', sessionId, { notes: `nota A${cycle}` } as never)
      await repo(pa, a).add('exerciseSets', { ...SET_FIELDS, sessionId, setIndex: 10 + cycle, weight: 90 } as never)
      await repo(pb, b).update('trainingSessions', sessionId, { notes: `nota B${cycle}`, rpe: 9 } as never)
      await repo(pb, b).add('exerciseSets', { ...SET_FIELDS, sessionId, setIndex: 20 + cycle, weight: 95 } as never)
      await sync(a, pa)
      expect((await sync(b, pb)).conflicts).toBe(1)
      const [c] = await b.syncConflicts.toArray()
      expect(canMerge(c!)).toBe(true)
      await resolveConflict(b, pb, c!.id, 'merge')
      expect((await sync(b, pb)).conflicts).toBe(0)
      expect((await sync(a, pa)).conflicts).toBe(0)
      const sa = await snapshot(a, pa)
      expect(sa).toEqual(await snapshot(b, pb))
      expect(sa.sets).toHaveLength(1 + 2 * cycle)
      expect(String(sa.sessions[0]!.notes)).toContain(`nota A${cycle}`)
      expect(String(sa.sessions[0]!.notes)).toContain(`nota B${cycle}`)
      expect(await a.syncConflicts.count()).toBe(0)
      expect(await b.syncConflicts.count()).toBe(0)
      // Quiet afterwards: nothing left to upload on either device.
      expect((await sync(a, pa)).pushed).toBe(0)
      expect((await sync(b, pb)).pushed).toBe(0)
    }
  })

  it('a session deleted on one device while the other edited a set: asked once, nothing lost until decided', async () => {
    const { a, b, pa, pb, sync, sessionId } = await sessionPair()
    await deleteSession(repo(pb, b), (await repo(pb, b).get('trainingSessions', sessionId)) as TrainingSession)
    await sync(b, pb)
    const [set] = (await repo(pa, a).all('exerciseSets')) as ExerciseSet[]
    await repo(pa, a).update('exerciseSets', set!.id, { weight: 100 } as never)
    await sync(a, pa)
    const groups = conflictGroups(await a.syncConflicts.toArray())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.dependents).toHaveLength(1)
    expect(await repo(pa, a).count('exerciseSets')).toBe(1)
    await resolveConflict(a, pa, groups[0]!.conflict.id, 'local')
    await sync(a, pa)
    await sync(b, pb)
    const sb = await snapshot(b, pb)
    expect(sb).toEqual(await snapshot(a, pa))
    expect(sb.sets.map((s) => s.weight)).toEqual([100])
  })
})
