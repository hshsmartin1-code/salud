import { afterEach, beforeEach, expect, it } from 'vitest'
import { exportBackup, importBackup, parseBackup } from './backup'
import { saveFoodPortion } from './foodPortions'
import { createProfile } from './profiles'
import { repo } from './repo'
import { createDB, type SaludDB } from './schema'
import { buildSnapshot, fromCustomFood, unitOptions } from '../features/nutrition/food'
import { resizeSnapshot } from '../domain/foodSnapshot'

let db: SaludDB
beforeEach(async () => { db = createDB(`portions-${crypto.randomUUID()}`); await db.open() })
afterEach(async () => { await db.delete() })
const profile = (name: string) => createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
async function setup() {
  const a = await profile('Sintético A'), b = await profile('Sintético B')
  const ra = repo(a.id, db), rb = repo(b.id, db)
  const custom = await ra.add('customFoods', { source: 'user', name: 'Arroz cocido sintético', brand: null, barcode: null, category: null, kind: 'cooked', basis: '100g', nutrients: { kcal: 130, protein: 3, carbs: 28 }, portions: [], servingSize: null, servingUnit: null })
  return { a, b, ra, rb, food: fromCustomFood(custom) }
}

it('creates, edits and removes a measure for exactly one food and profile', async () => {
  const { ra, rb, food } = await setup()
  const p = await saveFoodPortion(ra, food, { label: 'Mi taza', equivalentAmount: 160, equivalentUnit: 'g' })
  expect(await rb.get('foodPortions', p.id)).toBeUndefined()
  await expect(saveFoodPortion(rb, food, { id: p.id, label: 'Ajena', equivalentAmount: 90, equivalentUnit: 'g' })).rejects.toThrow(/perfil/)
  await expect(saveFoodPortion(ra, { ...food, ref: 'otra' }, { id: p.id, label: 'Otra', equivalentAmount: 90, equivalentUnit: 'g' })).rejects.toThrow(/alimento/)
  const edited = await saveFoodPortion(ra, food, { id: p.id, label: 'Mi taza grande', equivalentAmount: 180, equivalentUnit: 'g' })
  expect(edited).toMatchObject({ id: p.id, equivalentAmount: 180, foodKind: 'cooked', verification: 'custom' })
  await ra.remove('foodPortions', p.id)
  expect(await ra.count('foodPortions')).toBe(0)
})

it('rejects density assumptions, unknown amounts and duplicate labels, even with concurrent taps', async () => {
  const { ra, food } = await setup()
  await expect(saveFoodPortion(ra, food, { label: 'Mi vaso', equivalentAmount: 250, equivalentUnit: 'ml' })).rejects.toThrow(/unidad/)
  await expect(saveFoodPortion(ra, food, { label: '', equivalentAmount: 0, equivalentUnit: 'g' })).rejects.toThrow()
  const input = { label: 'Mi taza', equivalentAmount: 160, equivalentUnit: 'g' as const }
  const attempts = await Promise.allSettled([saveFoodPortion(ra, food, input), saveFoodPortion(ra, food, input)])
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await ra.count('foodPortions')).toBe(1)
})

it('keeps historical nutrient snapshots through edits/deletion of a custom measure', async () => {
  const { ra, food } = await setup()
  const p = await saveFoodPortion(ra, food, { label: 'Mi taza', equivalentAmount: 160, equivalentUnit: 'g' })
  const enriched = { ...food, householdPortions: [p] }
  const snapshot = buildSnapshot(enriched, 0.5, unitOptions(enriched).find((o) => o.portionId === p.id)!)
  if ('error' in snapshot) throw new Error(snapshot.error)
  const log = await ra.add('foodLogs', { ...snapshot, date: '2026-11-15', meal: 'almuerzo' })
  expect(log).toMatchObject({ grams: 80, nutrients: { kcal: 104 }, portionEquivalentAmount: 160 })
  await saveFoodPortion(ra, food, { id: p.id, label: p.label, equivalentAmount: 200, equivalentUnit: 'g' })
  await ra.remove('foodPortions', p.id)
  expect((await ra.get('foodLogs', log.id))!.nutrients).toEqual(snapshot.nutrients)
  expect(resizeSnapshot(log, 2)).toMatchObject({ grams: 320, nutrients: { kcal: 416 }, missing: ['fat', 'fiber', 'sugars', 'satFat', 'sodium'] })
  expect(resizeSnapshot(log, 0)).toHaveProperty('error')
})

it('backs up personal measures and remaps food/portion references when restoring to another profile', async () => {
  const { a, b, ra, rb, food } = await setup()
  const p = await saveFoodPortion(ra, food, { label: 'Mi taza', equivalentAmount: 160, equivalentUnit: 'g' })
  const enriched = { ...food, householdPortions: [p] }
  const snapshot = buildSnapshot(enriched, 2, unitOptions(enriched).find((o) => o.portionId === p.id)!)
  if ('error' in snapshot) throw new Error(snapshot.error)
  await ra.add('foodLogs', { ...snapshot, date: '2026-11-15', meal: 'almuerzo' })
  const backup = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
  await importBackup(backup, { mode: 'merge', mapping: { [a.id]: b.id } }, db)
  const [restoredPortion] = await rb.all('foodPortions'), [restoredFood] = await rb.all('customFoods'), [log] = await rb.all('foodLogs')
  expect(restoredPortion!.foodRef).toBe(`custom:${restoredFood!.id}`)
  expect(log!.portionId).toBe(restoredPortion!.id)
  expect(log!.grams).toBe(320)
  expect(log!.nutrients).toEqual(snapshot.nutrients)
  await importBackup(backup, { mode: 'merge', mapping: { [a.id]: b.id } }, db)
  expect(await rb.count('foodPortions')).toBe(1)
})

it('restores a V2 backup without deleting newer measures and rejects invalid measure rows', async () => {
  const { a, ra, food } = await setup()
  const p = await saveFoodPortion(ra, food, { label: 'Mi taza', equivalentAmount: 160, equivalentUnit: 'g' })
  const backup = await exportBackup({ profileId: a.id }, db)
  delete backup.tables.foodPortions
  backup.includedTables = backup.includedTables.filter((t) => t !== 'foodPortions')
  await importBackup(parseBackup(JSON.stringify(backup)), { mode: 'replace', mapping: { [a.id]: a.id } }, db)
  expect(await ra.get('foodPortions', p.id)).toBeDefined()
  const invalid = await exportBackup({ profileId: a.id }, db)
  invalid.tables.foodPortions![0]!.equivalentAmount = -1
  expect(() => parseBackup(JSON.stringify(invalid))).toThrow(/porciones/)
})
