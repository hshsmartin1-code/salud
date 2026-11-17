import { afterEach, beforeEach, expect, it } from 'vitest'
import { checkIntegrity, repairIntegrity } from './integrity'
import { createProfile } from './profiles'
import { repo } from './repo'
import { createDB, type SaludDB } from './schema'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`integrity-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = () =>
  createProfile({ name: 'Perfil sintético', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'rose', settings: { addActivityKcal: false } }, db)

const hc = (profileId: string, id: string, lastModified: string) => ({
  id,
  profileId,
  provider: 'health-connect' as const,
  kind: 'record' as const,
  metric: 'weight' as const,
  date: '2026-04-01',
  start: '2026-04-01T07:00:00Z',
  end: null,
  value: 70,
  unit: 'kg',
  sources: ['com.example.scale'],
  externalId: 'ext-1',
  lastModified,
  importedAt: lastModified,
  createdAt: lastModified,
  updatedAt: lastModified,
})

it('a clean database reports no issues', async () => {
  const p = await mk()
  await repo(p.id, db).add('vitals', { date: '2026-04-01', time: null, kind: 'restingHr', value: 60, unit: 'lpm' })
  const rep = await checkIntegrity(db)
  expect(rep.issues).toEqual([])
  expect(rep.rows).toBe(1)
})

it('reports impossible dates without deleting the original rows', async () => {
  const p = await mk()
  const r = repo(p.id, db)
  const row = await r.add('hydrationLogs', { date: '2026-02-29', time: null, ml: 250 })
  const report = await checkIntegrity(db)
  expect(report.issues).toMatchObject([{ code: 'invalid_date', ids: [row.id] }])
  expect(await repairIntegrity(report.issues, db)).toBe(0)
  expect(await r.get('hydrationLogs', row.id)).toBeDefined()
})

it('finds and repairs orphans, loose sets, broken photo links and duplicated imports', async () => {
  const p = await mk()
  const now = new Date().toISOString()
  // Orphan row of a deleted profile (written below the repo layer on purpose).
  await db.vitals.add({ id: 'v-orphan', profileId: 'deleted', date: '2026-04-01', time: null, kind: 'spo2', value: 98, unit: '%', createdAt: now, updatedAt: now })
  await db.exerciseSets.add({ id: 's-loose', profileId: p.id, sessionId: 'missing', date: '2026-04-01', exerciseId: 'x', exerciseName: 'x', setIndex: 0, weight: 10, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, createdAt: now, updatedAt: now })
  const r = repo(p.id, db)
  const food = await r.add('customFoods', { source: 'label', name: 'Galleta sintética', brand: null, barcode: null, category: null, kind: 'packaged', basis: '100g', nutrients: {}, portions: [], servingSize: null, servingUnit: null, labelImageId: 'no-such-image' } as never)
  await db.labelImages.add({ id: 'img-orphan', profileId: p.id, foodId: 'deleted-food', dataUrl: 'data:', width: 1, height: 1, bytes: 1, createdAt: now, updatedAt: now })
  await db.healthRecords.bulkAdd([hc(p.id, `${p.id}|a`, '2026-04-01T08:00:00Z'), hc(p.id, `${p.id}|b`, '2026-04-02T08:00:00Z')])
  await db.hydrationLogs.add({ id: 'h-bad', profileId: p.id, date: '1/4/2026', time: null, ml: 250, createdAt: now, updatedAt: now })

  const rep = await checkIntegrity(db)
  const codes = rep.issues.map((i) => i.code).sort()
  expect(codes).toEqual(['dangling_label_image', 'duplicate_health_record', 'invalid_date', 'orphan_label_image', 'orphan_rows', 'set_without_session'])
  expect(rep.issues.find((i) => i.code === 'duplicate_health_record')?.ids).toEqual([`${p.id}|a`]) // keeps the newest

  const changed = await repairIntegrity(rep.issues, db)
  expect(changed).toBe(5)
  expect(await db.vitals.get('v-orphan')).toBeUndefined()
  expect(await db.exerciseSets.get('s-loose')).toBeUndefined()
  expect((await r.get('customFoods', food.id))?.labelImageId).toBeNull()
  expect(await db.healthRecords.count()).toBe(1)
  expect(await db.hydrationLogs.get('h-bad')).toBeDefined() // invalid dates are only reported
  const after = await checkIntegrity(db)
  expect(after.issues.map((i) => i.code)).toEqual(['invalid_date'])
})
