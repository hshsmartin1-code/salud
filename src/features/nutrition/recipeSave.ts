import type { Repo } from '../../db/repo'
import type { Recipe } from '../../db/types'
import { textRangeError } from '../../domain/units'

export type RecipeDraft = Pick<Recipe, 'name' | 'servings' | 'cookedWeightG' | 'ingredients' | 'notes'>

export const recipeServingsError = (text: string): string | null =>
  text.trim() ? textRangeError(text, 0.25, 1000) : 'Indica las porciones.'

/** Persistence used by the mounted recipe editor. */
export function createRecipeSaver() {
  let pending: Promise<Recipe> | null = null
  let createdId: string | undefined
  return (r: Repo, data: RecipeDraft, id?: string): Promise<Recipe> => {
    if (pending) return pending
    const target = id ?? createdId
    pending = (target ? r.put('recipes', { ...data, id: target }) : r.add('recipes', data))
      .then((row) => { createdId = row.id; return row })
      .finally(() => { pending = null })
    return pending
  }
}
