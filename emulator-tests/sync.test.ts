import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../src/db/profiles'
import { repo } from '../src/db/repo'
import { createDB, type SaludDB } from '../src/db/schema'
import { resolveConflict, syncProfile } from '../src/sync/engine'
import { FirestoreRemote } from '../src/sync/firestoreRemote'
import { createProfileFromAccount, deleteCloudData, linkProfile, previewLink } from '../src/sync/link'
import { RemoteError } from '../src/sync/remote'

// The real sync engine against the Firestore emulator and the real security rules. Synthetic data.
let env: RulesTestEnvironment
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-salud', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } })
})
afterAll(() => env.cleanup())
beforeEach(() => env.clearFirestore())

const remote = (sessionUid: string, treeUid = sessionUid) => new FirestoreRemote(env.authenticatedContext(sessionUid).firestore() as unknown as Firestore, treeUid)

const dbs: SaludDB[] = []
let n = 0
async function device() {
  const db = createDB(`emu-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})
const mkProfile = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)
const food = (db: SaludDB, pid: string, name: string, qty = 100) =>
  repo(pid, db).add('foodLogs', { date: '2026-11-10', meal: 'almuerzo', name, foodRef: 'usda:1', qty, unit: 'g', grams: qty, ml: null, nutrients: { kcal: qty }, missing: [], source: 'usda_sr' } as never)

describe('sync over Firestore', () => {
  it('links, downloads on a second device with paging over shared batch timestamps, and verifies', async () => {
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 450; i++) await food(a, pa.id, `C${i}`, i + 1)
    const first = await linkProfile(a, pa.id, remote(ANA.uid), ANA)
    expect(first.verify.ok).toBe(true)
    const b = await device()
    const { profileId, verify } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    expect(await repo(profileId, b).count('foodLogs')).toBe(450)
  })

  it('concurrent edits become a preserved conflict, and the chosen version is uploaded', async () => {
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    const base = await food(a, pa.id, 'Arroz', 100)
    await linkProfile(a, pa.id, remote(ANA.uid), ANA)
    const b = await device()
    const { profileId: pb } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    await repo(pa.id, a).update('foodLogs', base.id, { qty: 150 } as never)
    await syncProfile(a, pa.id, remote(ANA.uid))
    await repo(pb, b).update('foodLogs', base.id, { qty: 200 } as never)
    const r = await syncProfile(b, pb, remote(ANA.uid))
    expect(r.conflicts).toBe(1)
    const [c] = await b.syncConflicts.toArray()
    await resolveConflict(b, pb, c!.id, 'local')
    await syncProfile(b, pb, remote(ANA.uid))
    await syncProfile(a, pa.id, remote(ANA.uid))
    expect((await repo(pa.id, a).get('foodLogs', base.id))?.qty).toBe(200)
  })

  it('a stale batch is refused by the rules and falls back to a per-row conflict', async () => {
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz', 100)
    await linkProfile(a, pa.id, remote(ANA.uid), ANA)
    const doc = (await remote(ANA.uid).pull(null, null, 50)).find((d) => d.t === 'foodLogs')!
    const stale = { key: doc.key, t: doc.t, id: doc.id, baseRev: 0, del: false, d: '{"qty":1}', h: 'x' }
    await expect(remote(ANA.uid).commit([stale])).rejects.toMatchObject({ code: 'permission' })
    const one = await remote(ANA.uid).commitOne(stale)
    expect(one.ok).toBe(false)
    if (!one.ok) expect(one.current?.rev).toBe(doc.rev)
  })

  it('a session can never read or write another account', async () => {
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz')
    await linkProfile(a, pa.id, remote(ANA.uid), ANA)
    const intruder = remote('uid-otro', ANA.uid)
    await expect(intruder.pull(null, null, 10)).rejects.toMatchObject({ code: 'permission' })
    await expect(intruder.liveCounts()).rejects.toBeInstanceOf(RemoteError)
    await expect(intruder.commit([{ key: 'foodLogs~x', t: 'foodLogs', id: 'x', baseRev: 0, del: false, d: '{}', h: 'h' }])).rejects.toMatchObject({ code: 'permission' })
  })

  it('deleting cloud data removes every document and keeps the device copy', async () => {
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz')
    await linkProfile(a, pa.id, remote(ANA.uid), ANA)
    await deleteCloudData(a, pa.id, remote(ANA.uid))
    expect(await remote(ANA.uid).liveCounts()).toEqual({})
    expect(await remote(ANA.uid).getMeta()).toBeNull()
    expect(await repo(pa.id, a).count('foodLogs')).toBe(1)
  })

  it('training sessions, their sets and exact nutrients survive the real Firestore round trip', async () => {
    const a = await device()
    const pa = (await mkProfile(a, 'Ana')).id
    const nutrients = { kcal: 247.5, protein: 46.5, fat: 5.4, sodium: 111 }
    await repo(pa, a).add('foodLogs', { date: '2026-11-12', meal: 'almuerzo', name: 'Pollo', foodRef: 'usda:171477', qty: 150, unit: 'g', grams: 150, ml: null, nutrients, missing: ['fiber'], source: 'usda_sr' } as never)
    const session = await repo(pa, a).add('trainingSessions', { date: '2026-11-12', name: 'Pierna', routineId: null, status: 'done', startedAt: null, endedAt: null, restEndsAt: null, exerciseOrder: [] } as never)
    for (let i = 0; i < 3; i++)
      await repo(pa, a).add('exerciseSets', { sessionId: session.id, date: '2026-11-12', exerciseId: 'fedb:squat', exerciseName: 'Sentadilla', setIndex: i, weight: 80 + i * 2.5, reps: 8, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true } as never)
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    const b = await device()
    const { profileId: pb, verify } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    const [log] = (await repo(pb, b).all('foodLogs')) as { nutrients: unknown; missing: unknown }[]
    expect(log?.nutrients).toEqual(nutrients)
    expect(log?.missing).toEqual(['fiber'])
    const sets = (await repo(pb, b).all('exerciseSets')) as { sessionId: string; weight: number }[]
    expect(sets.map((x) => x.weight).sort()).toEqual([80, 82.5, 85])
    expect(sets.every((x) => x.sessionId === session.id)).toBe(true)
  })

  it('a device stops when the cloud copy was erased and recreated by another device', async () => {
    const a = await device()
    const pa = (await mkProfile(a, 'Ana')).id
    await food(a, pa, 'Arroz')
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    const b = await device()
    const { profileId: pb } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    await deleteCloudData(a, pa, remote(ANA.uid))
    await new Promise((r) => setTimeout(r, 5))
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    await food(b, pb, 'Nuevo en B')
    await expect(syncProfile(b, pb, remote(ANA.uid))).rejects.toMatchObject({ code: 'cloud-reset' })
    expect((await remote(ANA.uid).liveCounts()).foodLogs).toBe(1)
  })
})

describe('read cost and "Unir" duplicates over Firestore', () => {
  it('idle pulls settle the overlap window, then resume strictly after the last document', async () => {
    const a = await device()
    const pa = (await mkProfile(a, 'Ana')).id
    for (let i = 0; i < 30; i++) await food(a, pa, `C${i}`, i + 1)
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    const b = await device()
    const { profileId: pb } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    let offset = 0
    const now = () => new Date(Date.now() + offset)
    expect((await syncProfile(b, pb, remote(ANA.uid), { now })).pulled).toBe(31) // window re-read
    offset += 5 * 60_000 // device time only: the settle rule never trusts the server clock
    expect((await syncProfile(b, pb, remote(ANA.uid), { now })).pulled).toBe(31) // last re-read
    expect((await b.syncLinks.get(pb))?.cursorSettled).toBe(true)
    expect((await syncProfile(b, pb, remote(ANA.uid), { now })).pulled).toBe(0)
    await food(a, pa, 'Nueva')
    await syncProfile(a, pa, remote(ANA.uid))
    const r = await syncProfile(b, pb, remote(ANA.uid), { now })
    expect([r.pulled, r.applied]).toEqual([1, 1])
    expect(await repo(pb, b).count('foodLogs')).toBe(31)
  })

  it('a link stored by the previous version (no cursor key) learns it and settles without an invalid cursor', async () => {
    const a = await device()
    const pa = (await mkProfile(a, 'Ana')).id
    await food(a, pa, 'Arroz')
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    const b = await device()
    const { profileId: pb } = await createProfileFromAccount(b, remote(ANA.uid), ANA)
    const link = (await b.syncLinks.get(pb))!
    await b.syncLinks.put({ ...link, cursorKey: undefined, cursorSeenAt: undefined, cursorSettled: undefined })
    let offset = 0
    const now = () => new Date(Date.now() + offset)
    await syncProfile(b, pb, remote(ANA.uid), { now })
    offset += 5 * 60_000
    await syncProfile(b, pb, remote(ANA.uid), { now })
    expect((await syncProfile(b, pb, remote(ANA.uid), { now })).pulled).toBe(0)
  })

  it('previews probable duplicates and leaves them out under the real rules; later edits still sync', async () => {
    const a = await device()
    const pa = (await mkProfile(a, 'Ana')).id
    await food(a, pa, 'arroz', 150)
    await repo(pa, a).add('bodyMeasurements', { date: '2026-11-10', weightKg: 70.4, circumferences: {}, skinfolds: {}, protocol: null, derived: null } as never)
    await linkProfile(a, pa, remote(ANA.uid), ANA)
    const b = await device()
    const pb = (await mkProfile(b, 'Ana')).id
    const bLunch = await food(b, pb, 'arroz', 150)
    const bWeight = await repo(pb, b).add('bodyMeasurements', { date: '2026-11-10', weightKg: 70.4, circumferences: {}, skinfolds: {}, protocol: null, derived: null } as never)
    await food(b, pb, 'kiwi', 80)
    const p = await previewLink(b, pb, remote(ANA.uid), { duplicates: true })
    expect(p.duplicatesFailed).toBe(false)
    expect(p.duplicates?.byTable).toEqual({ foodLogs: 1, bodyMeasurements: 1 })
    const { verify, skippedDuplicates } = await linkProfile(b, pb, remote(ANA.uid), ANA, { skipDuplicates: p.duplicates!.pairs })
    expect([verify.ok, skippedDuplicates]).toEqual([true, 2])
    expect((await remote(ANA.uid).liveCounts()).foodLogs).toBe(2)
    // An edit of B's own copy is uploaded as a new row (rev 1 is accepted by the rules)…
    await repo(pb, b).update('bodyMeasurements', bWeight.id, { weightKg: 70.1 } as never)
    // …and deleting B's own copy never deletes the account's copy.
    await repo(pb, b).remove('foodLogs', bLunch.id)
    const r = await syncProfile(b, pb, remote(ANA.uid))
    expect([r.rejected, r.pending]).toEqual([0, 0])
    await syncProfile(a, pa, remote(ANA.uid))
    expect((await repo(pa, a).get('bodyMeasurements', bWeight.id))?.weightKg).toBe(70.1)
    expect((await repo(pa, a).all('foodLogs')).map((x) => x.name).sort()).toEqual(['arroz', 'kiwi'])
  })
})
