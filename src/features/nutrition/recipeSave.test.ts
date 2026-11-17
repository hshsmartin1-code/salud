import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDB, type SaludDB } from '../../db/schema'
import { repo, type Repo } from '../../db/repo'
import { createRecipeSaver, recipeServingsError, type RecipeDraft } from './recipeSave'

let db: SaludDB
let r: Repo
beforeEach(async () => {
  db = createDB(`recipe-save-${crypto.randomUUID()}`)
  await db.open()
  r = repo('synthetic-profile', db)
})

it('a failed write unlocks retry without retaining an unsaved id', async () => {
  const save = createRecipeSaver()
  vi.spyOn(r, 'add').mockRejectedValueOnce(new Error('Fallo sintético'))
  await expect(save(r, draft)).rejects.toThrow('Fallo sintético')
  await save(r, draft)
  expect(await r.count('recipes')).toBe(1)
})
afterEach(async () => { await db.delete() })
const draft: RecipeDraft = { name: 'Receta sintética', servings: 2, cookedWeightG: 500, ingredients: [], notes: '' }

it('allows a 50 kg batch to yield 500 portions of 100 g', () => {
  expect(recipeServingsError('500')).toBeNull()
  expect(recipeServingsError('abc')).not.toBeNull()
  expect(recipeServingsError('0')).not.toBeNull()
  expect(recipeServingsError('')).not.toBeNull()
})

it('a double submission creates one recipe, including before the edit query resolves', async () => {
  const save = createRecipeSaver()
  const [a, b] = await Promise.all([save(r, draft), save(r, draft)])
  expect(a.id).toBe(b.id)
  await save(r, { ...draft, name: 'Corrección sintética' })
  expect(await r.count('recipes')).toBe(1)
  expect(await r.get('recipes', a.id)).toMatchObject({ name: 'Corrección sintética' })
})
