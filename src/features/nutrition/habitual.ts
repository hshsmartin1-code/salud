import type { FoodSnapshot } from '../../db/types'
import { buildSnapshot, isRealPortion, shortQty, unitOptions, type Food } from './food'
import { formatNutrient } from '../../domain/nutrients'

export interface Habitual {
  snapshot: FoodSnapshot
  /** Where the quantity comes from: the last log of the food, its first proper portion, or its basis (100 g / 100 ml / 1 serving). */
  from: 'last' | 'portion' | 'basis'
  /** "150 g", "2 × tajada". */
  qty: string
  /** Energy of that quantity, rounded like the diary ("99"), or null when the food has no energy value. */
  kcal: string | null
}

/**
 * The quantity a food row offers: the last logged quantity of that food (the snapshot a quick add copies), else
 * the food's first proper portion (never a reference quantity), else 100 g / 100 ml (one serving for a label food).
 * Built with the same `unitOptions` and `buildSnapshot` the detail uses, so the row never disagrees with it.
 */
export function habitualFor(food: Food, last?: FoodSnapshot | null): Habitual | null {
  let snapshot: FoodSnapshot | null = null
  let from: Habitual['from'] = 'last'
  if (last) snapshot = last
  else {
    const options = unitOptions(food)
    const portion = options.find(isRealPortion)
    const basis = options.find((o) => o.unit === 'g' || o.unit === 'ml' || o.unit === 'serving')
    const pick = portion ?? basis
    if (pick) {
      const s = buildSnapshot(food, pick.defaultQty, pick)
      if (!('error' in s)) {
        snapshot = s
        from = portion ? 'portion' : 'basis'
      }
    }
  }
  if (!snapshot) return null
  const kcal = snapshot.nutrients.kcal
  return { snapshot, from, qty: shortQty(snapshot), kcal: kcal === undefined ? null : formatNutrient('kcal', kcal, false) }
}
