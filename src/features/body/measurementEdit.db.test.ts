import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { measurementDraft, saveMeasurementEdit } from './measurementEdit'

let db: SaludDB
let r: Repo
beforeEach(async () => {
  db = createDB(`measurement-edit-${crypto.randomUUID()}`)
  await db.open()
  r = repo('profile-a', db)
})
afterEach(async () => { await db.delete() })
const profile = { sex: 'female' as const, birthDate: null, heightCm: null }
const add = () => r.add('bodyMeasurements', {
  date: '2026-11-01', time: '08:00', weightKg: 70, circumferences: {}, skinfolds: {}, protocol: null, derived: null, notes: 'Inicial', origin: 'app',
})

it('reads and writes inside the same Dexie transaction and retains the last stored changes', async () => {
  const row = await add()
  const initial = measurementDraft(row)
  await r.update('bodyMeasurements', row.id, { notes: 'Desde otra pestaña' })
  const originalGet = r.get.bind(r)
  vi.spyOn(r, 'get').mockImplementation(async (table, id) => {
    // Dexie scopes this observation to the transaction used by the save helper.
    const { default: Dexie } = await import('dexie')
    expect(Dexie.currentTransaction).not.toBeNull()
    return originalGet(table, id)
  })
  await saveMeasurementEdit(r, row.id, initial, { ...initial, weight: '72' }, profile)
  expect(await originalGet('bodyMeasurements', row.id)).toMatchObject({ weightKg: 72, notes: 'Desde otra pestaña' })
})

it('does not resurrect a row removed by sync', async () => {
  const row = await add()
  await r.remove('bodyMeasurements', row.id)
  await expect(saveMeasurementEdit(r, row.id, measurementDraft(row), { ...measurementDraft(row), weight: '72' }, profile)).rejects.toThrow()
  expect(await r.count('bodyMeasurements')).toBe(0)
})

it('refuses another profile and rolls back a write that fails', async () => {
  const row = await add()
  await expect(saveMeasurementEdit(repo('profile-b', db), row.id, measurementDraft(row), measurementDraft(row), profile)).rejects.toThrow()
  const originalPut = r.put.bind(r)
  vi.spyOn(r, 'put').mockImplementation(async (table, data) => {
    await originalPut(table, data)
    throw new Error('Fallo sintético')
  })
  await expect(saveMeasurementEdit(r, row.id, measurementDraft(row), { ...measurementDraft(row), weight: '72' }, profile)).rejects.toThrow('Fallo sintético')
  expect(await r.get('bodyMeasurements', row.id)).toEqual(row)
})
