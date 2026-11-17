import type { FoodSnapshot } from '../db/types'
import { scaleNutrients } from './nutrients'

/** Old entries retain frozen nutrition even if their source/measure changed or vanished. */
export function resizeSnapshot(original: FoodSnapshot, qty: number): FoodSnapshot | { error: string } {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(original.qty) || original.qty <= 0)
    return { error: 'La cantidad debe ser un número mayor que 0' }
  const factor = qty / original.qty
  return {
    foodRef: original.foodRef, name: original.name, brand: original.brand, source: original.source,
    datasetVersion: original.datasetVersion, kind: original.kind,
    qty, unit: original.unit, portionLabel: original.portionLabel,
    portionId: original.portionId, portionSource: original.portionSource,
    portionVerification: original.portionVerification, portionEquivalentAmount: original.portionEquivalentAmount,
    portionEquivalentUnit: original.portionEquivalentUnit,
    grams: original.grams === null ? null : original.grams * factor,
    ml: original.ml === null ? null : original.ml * factor,
    nutrients: scaleNutrients(original.nutrients, factor), missing: [...original.missing],
  }
}
