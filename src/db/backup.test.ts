import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup, parseBackup, remapRows } from './backup'
import { createProfile, listProfiles } from './profiles'
import { repo } from './repo'
import { createDB, type SaludDB } from './schema'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`backup-test-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = (name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: null, color: 'violet', settings: { addActivityKcal: false } }, db)

async function seed(profileId: string) {
  const r = repo(profileId, db)
  const custom = await r.add('customFoods', {
    source: 'label',
    name: 'Yogur sintético',
    brand: null,
    barcode: null,
    category: null,
    kind: 'packaged',
    basis: '100g',
    nutrients: { kcal: 60, protein: 5 },
    portions: [],
    servingSize: null,
    servingUnit: null,
  })
  await r.add('foodLogs', {
    date: '2026-01-02',
    time: '08:00',
    meal: 'desayuno',
    foodRef: `custom:${custom.id}`,
    name: 'Yogur sintético',
    source: 'label',
    datasetVersion: null,
    qty: 150,
    unit: 'g',
    portionLabel: null,
    grams: 150,
    ml: null,
    nutrients: { kcal: 90, protein: 7.5 },
    missing: [],
  } as never)
  const session = await r.add('trainingSessions', {
    date: '2026-01-02',
    name: 'Sesión sintética',
    routineId: null,
    status: 'done',
    startedAt: null,
    endedAt: null,
    restEndsAt: null,
    exerciseOrder: [],
  })
  await r.add('exerciseSets', {
    sessionId: session.id,
    date: '2026-01-02',
    exerciseId: 'fedb:Barbell_Squat',
    exerciseName: 'Sentadilla',
    setIndex: 0,
    weight: 50,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    done: true,
  })
  await r.put('favorites', { id: `${profileId}|custom:${custom.id}`, foodRef: `custom:${custom.id}` } as never)
  return { custom, session }
}

describe('backup', () => {
  it('round-trips a profile: export → wipe → import (replace)', async () => {
    const a = await mk('Sintética A')
    await seed(a.id)
    const b = await exportBackup({ profileId: a.id }, db)
    const text = JSON.stringify(b)
    const parsed = parseBackup(text)
    expect(parsed.tables.foodLogs).toHaveLength(1)

    const r = repo(a.id, db)
    for (const t of ['foodLogs', 'customFoods', 'trainingSessions', 'exerciseSets', 'favorites'] as const) await r.clear(t)
    expect(await r.count('foodLogs')).toBe(0)

    const res = await importBackup(parsed, { mode: 'replace', mapping: { [a.id]: a.id } }, db)
    expect(res.inserted).toBe(5)
    expect((await r.all('foodLogs'))[0]!.nutrients.kcal).toBe(90)
    expect(await r.count('exerciseSets')).toBe(1)
  })

  it('merge keeps the newest version and is idempotent', async () => {
    const a = await mk('Sintética A')
    await seed(a.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    const res = await importBackup(b, { mode: 'merge', mapping: { [a.id]: a.id } }, db)
    expect(res.inserted).toBe(0)
    expect(res.updated).toBe(0)
    expect(res.skipped).toBe(5)
  })

  it('imports into a different profile with remapped ids and references', async () => {
    const a = await mk('Sintética A')
    const other = await mk('Sintética B')
    const { custom, session } = await seed(a.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    await importBackup(b, { mode: 'merge', mapping: { [a.id]: other.id } }, db)

    const ra = repo(a.id, db)
    const rb = repo(other.id, db)
    expect(await ra.count('foodLogs')).toBe(1) // source untouched
    const foods = await rb.all('customFoods')
    expect(foods).toHaveLength(1)
    expect(foods[0]!.id).not.toBe(custom.id)
    const log = (await rb.all('foodLogs'))[0]!
    expect(log.foodRef).toBe(`custom:${foods[0]!.id}`)
    const sess = (await rb.all('trainingSessions'))[0]!
    expect(sess.id).not.toBe(session.id)
    expect((await rb.all('exerciseSets'))[0]!.sessionId).toBe(sess.id)
    const fav = (await rb.all('favorites'))[0]!
    expect(fav.id).toBe(`${other.id}|custom:${foods[0]!.id}`)
  })

  it('can create a new profile from a backup', async () => {
    const a = await mk('Sintética A')
    await seed(a.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    const res = await importBackup(b, { mode: 'merge', mapping: { [a.id]: 'new' } }, db)
    expect(res.profilesCreated).toBe(1)
    expect(await listProfiles(db)).toHaveLength(2)
  })

  it('rejects foreign or malformed files', () => {
    expect(() => parseBackup('no json')).toThrow(/JSON/)
    expect(() => parseBackup(JSON.stringify({ format: 'otra-app' }))).toThrow(/Formato/)
    expect(() => parseBackup(JSON.stringify({ format: 'pho-backup', schemaVersion: 99, appVersion: 'x', exportedAt: 'x', scope: 'all', profiles: [{ id: 'p', name: 'x', sex: 'male' }], tables: {} }))).toThrow(/más nueva/)
  })

  it('remapRows rewrites exact ids, prefixed refs and composite ids', () => {
    const map = new Map([['old1', 'new1']])
    const [row] = remapRows([{ id: 'old1', profileId: 'P', ref: 'custom:old1', fav: 'P|recipe:old1', keep: 'fedb:X' }], map, 'P', 'Q')
    expect(row).toEqual({ id: 'new1', profileId: 'Q', ref: 'custom:new1', fav: 'Q|recipe:new1', keep: 'fedb:X' })
  })
})

describe('3.3 optional fields survive a backup', () => {
  it('profile physiologicalState and goal inputs method/palBand/pal round-trip through parse and restore', async () => {
    const a = await createProfile(
      { name: 'Sintética RIEN', sex: 'female', birthDate: '1995-01-01', heightCm: 160, activity: null, color: 'violet', settings: { addActivityKcal: false }, physiologicalState: 'lactating' },
      db,
    )
    const r = repo(a.id, db)
    await r.add('goals', {
      validFrom: '2026-01-01',
      goal: 'maintain',
      method: 'calculated',
      kcal: 2100,
      protein: 100,
      carbs: 280,
      fat: 63,
      fiber: 29,
      inputs: { weightKg: 60, heightCm: 160, ageYears: 31, sex: 'female', activity: 'moderate', goal: 'maintain', deficitKcal: 400, surplusKcal: 250, proteinGPerKg: 1.8, fatPct: 0.27, fiberPer1000: 14, method: 'rien', palBand: 'light', pal: 1.55 },
      methodText: 'Prueba',
      warnings: [],
      targetWeightKg: null,
    })
    const parsed = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    expect(parsed.profiles[0]!.physiologicalState).toBe('lactating')
    await r.clear('goals')
    await importBackup(parsed, { mode: 'replace', mapping: { [a.id]: a.id } }, db)
    const g = (await r.all('goals'))[0]!
    expect(g.inputs).toMatchObject({ method: 'rien', palBand: 'light', pal: 1.55 })
    expect((await db.profiles.get(a.id))!.physiologicalState).toBe('lactating')
  })
})
