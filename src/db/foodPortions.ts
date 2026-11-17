import type { Food } from '../features/nutrition/food'
import { portionForFood } from '../domain/portions'
import type { Repo } from './repo'
import type { FoodPortion } from './types'

export async function saveFoodPortion(r: Repo, food: Food, input: {
  id?: string; label: string; equivalentAmount: number; equivalentUnit: 'g' | 'ml'
}): Promise<FoodPortion> {
  return r.db.transaction('rw', r.db.foodPortions, async () => {
  if (input.id) {
    const current = await r.get('foodPortions', input.id)
    if (!current || current.foodRef !== food.ref) throw new Error('La porción no pertenece a este alimento y perfil.')
  }
  const portion = {
    id: input.id ?? crypto.randomUUID(), foodRef: food.ref, label: input.label.trim(), quantity: 1,
    unit: input.label.trim(), equivalentAmount: input.equivalentAmount, equivalentUnit: input.equivalentUnit,
    kind: 'custom' as const, source: 'user' as const, verification: 'custom' as const,
    brand: food.brand, foodKind: food.kind,
  }
  if (!portionForFood(portion, food)) throw new Error('Indica una medida y una equivalencia positiva en la unidad de este alimento.')
  const rows = await r.byProfileIndex('foodPortions', 'foodRef', food.ref)
  if (rows.some((p) => p.id !== portion.id && p.label.toLocaleLowerCase() === portion.label.toLocaleLowerCase()))
    throw new Error('Ya existe una medida con ese nombre. Edítala o elige otro nombre.')
  return r.put('foodPortions', portion)
  })
}
