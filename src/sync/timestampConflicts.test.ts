import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { pendingCount, syncProfile } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`ts-conflicts-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const mkProfile = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)

async function twoDevices() {
  const server = new MemoryServer()
  const a = await device()
  const pa = await mkProfile(a, 'Ana')
  const base = await repo(pa.id, a).add('foodLogs', { date: '2026-11-10', meal: 'almuerzo', name: 'Arroz', foodRef: 'usda:1', qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal: 130 }, missing: [], source: 'usda_sr' } as never)
  await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
  return { server, a, b, pa: pa.id, pb, baseId: base.id }
}

describe('rows that differ only in their timestamps are not conflicts', () => {
  it('the same edit made on two devices at different times merges silently (pull)', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await a.foodLogs.update(baseId, { qty: 150, grams: 150, updatedAt: '2026-11-11T10:00:00.000Z' })
    await b.foodLogs.update(baseId, { qty: 150, grams: 150, updatedAt: '2026-11-11T11:30:00.000Z' })
    await syncProfile(a, pa, server.remote(ANA.uid))
    const r = await syncProfile(b, pb, server.remote(ANA.uid))
    expect(r.conflicts).toBe(0)
    expect(await b.syncConflicts.count()).toBe(0)
    expect(await pendingCount(b, pb)).toBe(0)
    expect((await b.foodLogs.get(baseId))?.qty).toBe(150)
    // Nothing extra was written: the server keeps A's revision.
    const doc = [...server.docs(ANA.uid).values()].find((d) => d.t === 'foodLogs')!
    expect(doc.rev).toBe(2)
  })

  it('a real difference is still a conflict', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await a.foodLogs.update(baseId, { qty: 150, updatedAt: '2026-11-11T10:00:00.000Z' })
    await b.foodLogs.update(baseId, { qty: 151, updatedAt: '2026-11-11T11:30:00.000Z' })
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await syncProfile(b, pb, server.remote(ANA.uid))).conflicts).toBe(1)
  })

  it('the same edit landing between this device\'s pull and push merges silently (push)', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await a.foodLogs.update(baseId, { qty: 175, grams: 175, updatedAt: '2026-11-11T10:00:00.000Z' })
    await b.foodLogs.update(baseId, { qty: 175, grams: 175, updatedAt: '2026-11-11T11:30:00.000Z' })
    const remote = server.remote(ANA.uid)
    const realCommit = remote.commit.bind(remote)
    let once = true
    remote.commit = async (w) => {
      if (once) {
        once = false
        await syncProfile(a, pa, server.remote(ANA.uid)) // A's identical edit wins the race
      }
      return realCommit(w)
    }
    const r = await syncProfile(b, pb, remote)
    expect(r.conflicts).toBe(0)
    expect(await b.syncConflicts.count()).toBe(0)
    expect(await pendingCount(b, pb)).toBe(0)
    expect((await b.foodLogs.get(baseId))?.qty).toBe(175)
  })

  it('linking ("Unir") a device whose rows match the account except for timestamps raises no conflict', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    const daily = { date: '2026-11-10', metric: 'steps', value: 8000, valueText: null, unit: 'pasos', label: 'Pasos' }
    await a.importedDaily.put({ ...daily, id: `${pa.id}|hc:daily:steps:2026-11-10`, profileId: pa.id, createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z' } as never)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)

    // Another device: the same person, the same profile settings and the same imported day, created
    // independently (different timestamps). Before, both the profile row and the day became conflicts
    // whose card showed no difference at all.
    const b = await device()
    const pb = await mkProfile(b, 'Ana')
    await b.importedDaily.put({ ...daily, id: `${pb.id}|hc:daily:steps:2026-11-10`, profileId: pb.id, createdAt: '2026-11-10T21:00:00.000Z', updatedAt: '2026-11-10T21:00:00.000Z' } as never)
    const { sync, verify } = await linkProfile(b, pb.id, server.remote(ANA.uid), ANA)
    expect(sync.conflicts).toBe(0)
    expect(await b.syncConflicts.count()).toBe(0)
    expect(verify.ok).toBe(true)
    expect(await repo(pb.id, b).count('importedDaily')).toBe(1)
  })
})
