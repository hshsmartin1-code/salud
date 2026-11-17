import type { FoodBasis, FoodKind, FoodSource } from '../db/catalogTypes'

export type PortionEquivalentUnit = 'g' | 'ml'
export type PortionKind = 'household' | 'serving' | 'package' | 'custom'
export type PortionVerification = 'standard' | 'derived' | 'custom'

/** A food-specific measure. Its equivalent belongs to this exact food/state/brand. */
export interface HouseholdPortion {
  id: string
  foodRef: string
  label: string
  quantity: number
  unit: string
  equivalentAmount: number
  equivalentUnit: PortionEquivalentUnit
  kind: PortionKind
  source: FoodSource
  verification: PortionVerification
  sourceRef?: string | null
  brand?: string | null
  qualifier?: string | null
  foodKind?: FoodKind | null
}

export function validHouseholdPortion(value: unknown): value is HouseholdPortion {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  const sources: FoodSource[] = ['usda_foundation', 'usda_sr', 'usda_fndds', 'off', 'icbf_tcac2015', 'user', 'label', 'recipe']
  const kinds: PortionKind[] = ['household', 'serving', 'package', 'custom']
  const verifications: PortionVerification[] = ['standard', 'derived', 'custom']
  const foodKinds: FoodKind[] = ['generic', 'raw', 'cooked', 'prepared', 'packaged', 'recipe', 'user']
  return nonempty(p.id) && nonempty(p.foodRef) && nonempty(p.label) && nonempty(p.unit)
    && positive(p.quantity) && positive(p.equivalentAmount)
    && (p.equivalentUnit === 'g' || p.equivalentUnit === 'ml')
    && sources.includes(p.source as FoodSource) && kinds.includes(p.kind as PortionKind)
    && verifications.includes(p.verification as PortionVerification)
    && (p.sourceRef == null || typeof p.sourceRef === 'string')
    && (p.brand == null || typeof p.brand === 'string')
    && (p.qualifier == null || typeof p.qualifier === 'string')
    && (p.foodKind == null || foodKinds.includes(p.foodKind as FoodKind))
}

/** No implicit mass/volume conversion; no cross-food, brand, or raw/cooked reuse. */
export function portionForFood(p: HouseholdPortion, food: {
  ref: string; basis: FoodBasis; brand: string | null; kind: FoodKind
}): boolean {
  if (!validHouseholdPortion(p) || p.foodRef !== food.ref || food.basis === 'serving') return false
  if (p.equivalentUnit !== (food.basis === '100g' ? 'g' : 'ml')) return false
  if (p.brand != null && p.brand !== food.brand) return false
  if (p.foodKind != null && p.foodKind !== food.kind) return false
  return true
}

/** Count means multiples of the displayed measure (e.g. 2 × "2 galletas"). */
export function portionEquivalent(p: HouseholdPortion, count: number): number | null {
  if (!validHouseholdPortion(p) || !Number.isFinite(count) || count <= 0) return null
  const amount = p.equivalentAmount * count
  return Number.isFinite(amount) ? amount : null
}

export function legacyPortion(
  food: { ref: string; source: FoodSource; basis: FoodBasis; brand: string | null; kind: FoodKind; flags?: string[] },
  label: string, equivalentAmount: number, index: number,
): HouseholdPortion | null {
  if (food.basis === 'serving') return null
  // Older OFF catalog rows do not retain the normalized unit. Only an explicit
  // matching label or a newly checked row can be used without a density guess.
  if (food.source === 'off' && !food.flags?.includes('portion_units_checked')) {
    const units = [...label.matchAll(/\b\d+(?:[.,]\d+)?\s*(kg|mg|g|gr|ml|cl|dl|l|lt)\b/gi)]
      .map((m) => ['kg', 'mg', 'g', 'gr'].includes(m[1].toLowerCase()) ? 'g' : 'ml')
    if (units.length !== 1 || units[0] !== (food.basis === '100g' ? 'g' : 'ml')) return null
  }
  const p: HouseholdPortion = {
    id: `${food.ref}:legacy:${index}`,
    foodRef: food.ref,
    label,
    quantity: 1,
    unit: label,
    equivalentAmount,
    equivalentUnit: food.basis === '100g' ? 'g' : 'ml',
    kind: /envase|paquete|package/i.test(label) ? 'package' : 'household',
    source: food.source,
    verification: food.source.startsWith('usda_') ? 'standard' : 'derived',
    brand: food.brand,
    foodKind: food.kind,
  }
  return validHouseholdPortion(p) ? p : null
}
