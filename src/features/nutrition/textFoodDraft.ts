import { NUTRIENTS, type NutrientMap } from '../../db/catalogTypes'
import { uuid, type Repo } from '../../db/repo'
import type { FoodLog, FoodSnapshot, MealKey } from '../../db/types'
import { checkLabelDraft, convertLabel, type LabelDraft } from '../../domain/labelConvert'
import { CORE_NUTRIENTS, scaleNutrients } from '../../domain/nutrients'
import { amountError } from './amountRange'
import { buildSnapshot, fromCustomFood, unitOptions } from './food'
import type { TextBasis, TextUnit } from './foodText'
import { labelBaseAmount, labelValueError } from './labelRanges'
import type { LabelFoodDraft } from './labelSave'
import { logSnapshots } from './quickAdd'

export const hasPendingNutrition = (log: FoodLog) => log.foodRef.startsWith('text:') && log.nutrients.kcal === undefined

export interface TextFoodInput {
  name: string
  qty: number | null
  unit: TextUnit
  portion: { qty: number; unit: 'g' | 'ml' } | null
  package: { qty: number; unit: 'g' | 'ml' } | null
  basis: TextBasis | ''
  nutrients: NutrientMap
  sourceText: string
}

type Preview = { food: LabelFoodDraft; snapshot: FoodSnapshot; warnings: string[] }

export function previewTextFood(input: TextFoodInput): Preview | { error: string } {
  const { unit, qty, portion } = input
  const name = input.name.trim()
  if (!name || name.length > 120) return { error: 'Escribe el nombre del alimento.' } as const
  const quantityError = amountError(qty, unit)
  if (qty === null || quantityError) return { error: quantityError ?? 'Indica cuánto consumiste.' } as const
  const hasNutrients = Object.keys(input.nutrients).length > 0
  const basis = input.basis || (!hasNutrients ? unit === 'g' ? '100g' : unit === 'ml' ? '100ml' : 'serving' : '')
  if (!basis) return { error: 'Indica a qué cantidad corresponden los valores.' } as const
  const consumed = basis === 'consumed'
  const physical = unit === 'serving' ? portion && { qty: qty * portion.qty, unit: portion.unit } : { qty, unit }
  if ((physical && amountError(physical.qty, physical.unit)) || (portion && amountError(portion.qty, portion.unit)))
    return { error: 'Revisa la equivalencia y la cantidad consumida.' }
  // An explicit total for what was eaten can be normalized using that amount, never the package size.
  const draft: LabelDraft = {
    basis: consumed ? 'serving' : basis,
    nutrients: consumed && !physical ? scaleNutrients(input.nutrients, 1 / qty) : input.nutrients,
    servingSize: consumed ? physical?.qty ?? null : portion?.qty ?? null,
    servingUnit: consumed ? physical?.unit ?? null : portion?.unit ?? null,
    servingLabel: portion ? 'unidad' : null,
    servingsPerPackage: null,
    packageSize: input.package?.qty ?? null,
    packageUnit: input.package?.unit ?? null,
  }
  const base = labelBaseAmount(draft.basis, draft.servingSize, draft.packageSize)
  const baseUnit = draft.basis === '100g' ? 'g' : draft.basis === '100ml' ? 'ml' : draft.basis === 'package' ? draft.packageUnit : draft.servingUnit
  for (const n of NUTRIENTS) {
    const value = draft.nutrients[n.code]
    if (value === undefined) continue
    const err = labelValueError(String(value).replace('.', ','), n.unit, base, baseUnit)
    if (err || !Number.isFinite(value)) return { error: `${n.es}: ${err ?? 'valor no válido'}` } as const
  }
  const check = checkLabelDraft(draft, { requireEnergy: false })
  if (check.errors.length) return { error: check.errors[0]! } as const
  const converted = convertLabel(draft)
  const portions = consumed ? (portion && converted.basis !== 'serving' ? [['unidad', portion.qty]] as [string, number][] : []) : converted.portions
  const data: LabelFoodDraft = {
    source: 'user', name, brand: null, barcode: null, category: null, kind: 'user', basis: converted.basis,
    nutrients: converted.nutrients, portions, servingSize: consumed ? portion?.qty ?? null : converted.servingSize,
    servingUnit: consumed ? portion?.unit ?? null : converted.servingUnit, servingLabel: null,
    packageSize: draft.packageSize, packageUnit: draft.packageUnit,
    ...(consumed ? {} : { labelBasis: draft.basis, labelNutrients: draft.nutrients }),
    entryMethod: 'text', sourceText: input.sourceText.slice(0, 20_000), validation: 'confirmed',
  }
  const food = fromCustomFood({ ...data, id: 'text-preview', profileId: '', createdAt: '', updatedAt: '' })
  const opts = unitOptions(food)
  const volumeOrMass = food.basis === '100g' ? 'g' : food.basis === '100ml' ? 'ml' : null
  if (draft.basis === 'package' && !draft.packageSize) return { error: 'Indica el contenido del envase para calcular la cantidad.' } as const
  if (!consumed && unit === 'serving' && draft.basis === 'package' && !portion)
    return { error: 'Indica cuánto pesa o mide una porción del envase.' } as const
  const option = unit === 'serving' && volumeOrMass
    ? opts.find((o) => o.unit === 'portion' && !!portion && portion.unit === volumeOrMass && o.portionGrams === portion.qty)
    : opts.find((o) => o.unit === unit)
  if (!option) return { error: volumeOrMass ? `Indica la cantidad en ${volumeOrMass} o añade la equivalencia de la porción.` : 'Indica la equivalencia en g o ml de una porción.' } as const
  const snapshot = buildSnapshot(food, qty, option)
  if ('error' in snapshot) return { error: snapshot.error } as const
  return { food: data, snapshot, warnings: check.warnings }
}

export async function saveTextFood(r: Repo, preview: Preview, date: string, meal: MealKey, existing?: FoodLog) {
  return r.db.transaction('rw', r.db.customFoods, r.db.foodLogs, r.db.recents, async () => {
    const pending = preview.snapshot.nutrients.kcal === undefined
    const previous = existing && await r.get('foodLogs', existing.id)
    if (existing && (!previous || previous.updatedAt !== existing.updatedAt || !hasPendingNutrition(previous))) {
      throw new Error('El registro cambió. Ábrelo de nuevo para completar sus datos.')
    }
    if (existing && pending) throw new Error('Indica la energía para completar este registro.')
    if (existing) {
      const snap = preview.snapshot
      const sameAmount = existing.grams !== null || existing.ml !== null
        ? existing.grams === snap.grams && existing.ml === snap.ml
        : snap.grams === null && snap.ml === null && existing.qty === snap.qty && existing.unit === snap.unit
      const nutrients = sameAmount ? { ...existing.nutrients, ...snap.nutrients } : snap.nutrients
      await r.update('foodLogs', existing.id, { ...snap, foodRef: existing.foodRef, nutrients,
        portionId: snap.portionId, portionSource: snap.portionSource, portionVerification: snap.portionVerification,
        portionEquivalentAmount: snap.portionEquivalentAmount, portionEquivalentUnit: snap.portionEquivalentUnit,
        missing: CORE_NUTRIENTS.filter((code) => nutrients[code] === undefined), meal })
      return null
    }
    const item = pending ? null : await r.add('customFoods', preview.food)
    const snapshot = { ...preview.snapshot, foodRef: item ? `custom:${item.id}` : `text:${uuid()}` }
    return logSnapshots(r, [{ snapshot }], date, meal)
  })
}
