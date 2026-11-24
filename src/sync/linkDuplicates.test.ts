import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { syncProfile } from './engine'
import { linkProfile, previewLink } from './link'
import { MemoryServer } from './memoryRemote'

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`link-dups-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const mkProfile = (db: SaludDB) =>
  createProfile({ name: 'Ana', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)

const food = (db: SaludDB, pid: string, name: string, grams: number, meal = 'almuerzo') =>
  repo(pid, db).add('foodLogs', { date: '2026-11-10', meal, name, foodRef: `usda:${name}`, qty: grams, unit: 'g', grams, ml: null, nutrients: { kcal: grams }, missing: [], source: 'usda_sr' } as never)

/** The same day entered separately on two devices (different ids), plus one record only on each side. */
async function fill(db: SaludDB, pid: string, own: string, startedAt: string) {
  await food(db, pid, 'arroz', 150)
  await food(db, pid, own, 80, 'cena')
  await repo(pid, db).add('bodyMeasurements', { date: '2026-11-10', weightKg: 70.4, circumferences: {}, skinfolds: {}, protocol: null, derived: null } as never)
  await repo(pid, db).add('hydrationLogs', { date: '2026-11-10', time: '08:00', ml: 250 } as never)
  await repo(pid, db).add('trainingSessions', { date: '2026-11-10', name: 'Pierna', routineId: null, status: 'done', startedAt, endedAt: null, restEndsAt: null, exerciseOrder: [] } as never)
}

async function setup() {
  const server = new MemoryServer()
  const a = await device()
  const pa = (await mkProfile(a)).id
  await fill(a, pa, 'pera', '2026-11-10T12:00:00.000Z')
  await linkProfile(a, pa, server.remote(ANA.uid), ANA)
  const b = await device()
  const pb = (await mkProfile(b)).id
  await fill(b, pb, 'kiwi', '2026-11-10T12:01:00.000Z')
  return { server, a, b, pa, pb }
}

const names = async (db: SaludDB, pid: string) => (await repo(pid, db).all('foodLogs')).map((r) => r.name).sort()
const cloud = (server: MemoryServer, t: string) => [...server.docs(ANA.uid).values()].filter((d) => d.t === t && !d.del)

describe('"Unir" with probable duplicates', () => {
  it('the preview counts probable duplicates per table, reading only those tables', async () => {
    const { server, b, pb } = await setup()
    const plain = await previewLink(b, pb, server.remote(ANA.uid))
    expect(plain.duplicates).toBeNull()
    const before = server.calls.reads
    const p = await previewLink(b, pb, server.remote(ANA.uid), { duplicates: true })
    expect(p.duplicatesFailed).toBe(false)
    expect(p.duplicates?.byTable).toEqual({ foodLogs: 1, bodyMeasurements: 1, trainingSessions: 1, hydrationLogs: 1 })
    expect(p.duplicates?.skippable).toBe(3)
    // metadata + 2 food logs + 1 measurement + 1 session + 1 water entry
    expect(server.calls.reads - before).toBe(1 + 5)
  })

  it('"Omitir duplicados probables" copies neither copy and deletes nothing; verification passes', async () => {
    const { server, a, b, pa, pb } = await setup()
    const p = await previewLink(b, pb, server.remote(ANA.uid), { duplicates: true })
    const { verify, skippedDuplicates } = await linkProfile(b, pb, server.remote(ANA.uid), ANA, { skipDuplicates: p.duplicates!.pairs })
    expect(skippedDuplicates).toBe(3)
    expect(verify.ok).toBe(true)
    await syncProfile(a, pa, server.remote(ANA.uid))

    // Each side shows the shared lunch once; each keeps its own copy (nothing deleted anywhere).
    expect(await names(b, pb)).toEqual(['arroz', 'kiwi', 'pera'])
    expect(await names(a, pa)).toEqual(['arroz', 'kiwi', 'pera'])
    expect(cloud(server, 'foodLogs')).toHaveLength(3)
    for (const t of ['bodyMeasurements', 'hydrationLogs'] as const) {
      expect(await repo(pb, b).count(t)).toBe(1)
      expect(await repo(pa, a).count(t)).toBe(1)
      expect(cloud(server, t)).toHaveLength(1)
    }
    const bLunch = (await repo(pb, b).all('foodLogs')).find((r) => r.name === 'arroz')!
    const aLunch = (await repo(pa, a).all('foodLogs')).find((r) => r.name === 'arroz')!
    expect(bLunch.id).not.toBe(aLunch.id)
    // Training sessions carry their sets: both are kept (reported, never left out).
    expect(await repo(pb, b).count('trainingSessions')).toBe(2)
    expect(await repo(pa, a).count('trainingSessions')).toBe(2)
    // Nothing pending afterwards on either device.
    expect((await syncProfile(b, pb, server.remote(ANA.uid))).pending).toBe(0)
  })

  it('without the option the merge keeps both copies (calories counted twice), as before', async () => {
    const { server, b, pb } = await setup()
    const { verify, skippedDuplicates } = await linkProfile(b, pb, server.remote(ANA.uid), ANA)
    expect(skippedDuplicates).toBe(0)
    expect(verify.ok).toBe(true)
    expect(await names(b, pb)).toEqual(['arroz', 'arroz', 'kiwi', 'pera'])
  })

  it('a later change to either copy still syncs (no edit is held back)', async () => {
    const { server, a, b, pa, pb } = await setup()
    const p = await previewLink(b, pb, server.remote(ANA.uid), { duplicates: true })
    await linkProfile(b, pb, server.remote(ANA.uid), ANA, { skipDuplicates: p.duplicates!.pairs })
    await syncProfile(a, pa, server.remote(ANA.uid))

    // Editing the account's copy on A reaches B.
    const aWater = (await repo(pa, a).all('hydrationLogs'))[0]!
    await repo(pa, a).update('hydrationLogs', aWater.id, { ml: 300 } as never)
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    expect((await repo(pb, b).get('hydrationLogs', aWater.id))?.ml).toBe(300)

    // Editing B's own copy uploads it as its own row: A sees it (visible, never silently dropped).
    const bWeight = (await repo(pb, b).all('bodyMeasurements'))[0]!
    await repo(pb, b).update('bodyMeasurements', bWeight.id, { weightKg: 70.1 } as never)
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await repo(pa, a).get('bodyMeasurements', bWeight.id))?.weightKg).toBe(70.1)

    // Deleting B's own copy never deletes the account's copy.
    const bLunch = (await repo(pb, b).all('foodLogs')).find((r) => r.name === 'arroz')!
    await repo(pb, b).remove('foodLogs', bLunch.id)
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect(await names(a, pa)).toEqual(['arroz', 'kiwi', 'pera'])
  })

  it('a duplicate changed on this device after the preview is merged normally instead of left out', async () => {
    const { server, b, pb } = await setup()
    const p = await previewLink(b, pb, server.remote(ANA.uid), { duplicates: true })
    const lunch = (await repo(pb, b).all('foodLogs')).find((r) => r.name === 'arroz')!
    await repo(pb, b).update('foodLogs', lunch.id, { note: 'con sal' } as never)
    const { verify, skippedDuplicates } = await linkProfile(b, pb, server.remote(ANA.uid), ANA, { skipDuplicates: p.duplicates!.pairs })
    expect(skippedDuplicates).toBe(2)
    expect(verify.ok).toBe(true)
    expect(await names(b, pb)).toEqual(['arroz', 'arroz', 'kiwi', 'pera'])
  })
})
