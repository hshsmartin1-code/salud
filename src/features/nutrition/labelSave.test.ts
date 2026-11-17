import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { createLabelSaver, type LabelFoodDraft } from './labelSave'

let db: SaludDB
let r: Repo
const draft: LabelFoodDraft = {
  source: 'label', name: 'Alimento sintético', brand: null, barcode: null, category: null, kind: 'packaged',
  basis: '100g', nutrients: { kcal: 100 }, portions: [], servingSize: null, servingUnit: null,
}
beforeEach(async () => {
  db = createDB(`label-save-${crypto.randomUUID()}`)
  await db.open()
  r = repo('profile-a', db)
})
afterEach(async () => { await db.delete() })

it('a double tap and a second save before the edit query resolves create only one food', async () => {
  const saver = createLabelSaver()
  const [a, b] = await Promise.all([saver.save(r, draft), saver.save(r, draft)])
  expect(a.id).toBe(b.id)
  const corrected = await saver.save(r, { ...draft, name: 'Corrección sintética' }, a.id)
  await saver.save(r, { ...draft, name: 'Otra corrección' })
  expect(corrected.id).toBe(a.id)
  expect(await r.count('customFoods')).toBe(1)
  expect(await r.get('customFoods', a.id)).toMatchObject({ name: 'Otra corrección' })
})

it('retry after failure creates one row and reset starts a separate label', async () => {
  const saver = createLabelSaver()
  vi.spyOn(r, 'add').mockRejectedValueOnce(new Error('Fallo sintético'))
  await expect(saver.save(r, draft)).rejects.toThrow('Fallo sintético')
  const first = await saver.save(r, draft)
  saver.reset()
  const second = await saver.save(r, draft)
  expect(first.id).not.toBe(second.id)
  expect(await r.count('customFoods')).toBe(2)
})

it('keeps independent pending and created identities after a profile switch', async () => {
  const saver = createLabelSaver()
  const other = repo('profile-b', db)
  const [a, b] = await Promise.all([saver.save(r, draft), saver.save(other, draft)])
  expect(a.profileId).toBe(r.profileId)
  expect(b.profileId).toBe(other.profileId)
  await saver.save(r, { ...draft, name: 'Perfil A' })
  await saver.save(other, { ...draft, name: 'Perfil B' })
  expect(await r.count('customFoods')).toBe(1)
  expect(await other.count('customFoods')).toBe(1)
  expect(await r.get('customFoods', b.id)).toBeUndefined()
})

it('does not resurrect a removed edit target or overwrite a foreign row', async () => {
  const saver = createLabelSaver()
  const a = await saver.save(r, draft)
  await expect(saver.save(repo('profile-b', db), draft, a.id)).rejects.toThrow()
  await r.remove('customFoods', a.id)
  await expect(saver.save(r, draft, a.id)).rejects.toThrow()
  expect(await r.count('customFoods')).toBe(0)
})

it('reset while a save is pending cannot attach the next form to the old row', async () => {
  const saver = createLabelSaver()
  const pending = saver.save(r, draft)
  saver.reset()
  const next = saver.save(r, { ...draft, name: 'Otra etiqueta' })
  const [a, b] = await Promise.all([pending, next])
  expect(a.id).not.toBe(b.id)
  await saver.save(r, { ...draft, name: 'Otra etiqueta corregida' })
  expect(await r.count('customFoods')).toBe(2)
  expect(await r.get('customFoods', b.id)).toMatchObject({ name: 'Otra etiqueta corregida' })
})
