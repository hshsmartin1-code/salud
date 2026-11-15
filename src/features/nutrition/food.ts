import type { CatalogFoodRow, FoodBasis, FoodKind, FoodSource, NutrientCode, NutrientMap } from '../../db/catalogTypes'
import type { CustomFood, FoodSnapshot, MealKey, Recipe, RefFood } from '../../db/types'
import { CORE_NUTRIENTS, rowToNutrientMap, scaleNutrients, sumNutrients } from '../../domain/nutrients'
import { quantityFactor, type QtyUnit } from '../../domain/units'
import { SOURCE_RANK } from '../../domain/search'

/** Unified food model used by search, the quantity sheet and recipes. */
export interface Food {
  ref: string
  source: FoodSource
  name: string
  nameOrig: string
  brand: string | null
  barcode: string | null
  category: string | null
  kind: FoodKind
  basis: FoodBasis
  /** Per basis (100 g, 100 ml or one serving). Missing key = unknown. */
  nutrients: NutrientMap
  portions: [string, number][]
  flags: string[]
  synonyms: string
  datasetVersion: string | null
  curated: boolean
  /** USDA rows without a curated Spanish name. */
  englishOnly: boolean
  servingGrams: number | null
  /** What one label "serving" is, when it is not a plain serving (e.g. "envase completo"). */
  servingLabel?: string | null
}

export const SOURCE_LABEL: Record<FoodSource, string> = {
  usda_foundation: 'USDA Foundation',
  usda_sr: 'USDA SR Legacy',
  usda_fndds: 'USDA FNDDS',
  off: 'Open Food Facts',
  icbf_tcac2015: 'ICBF TCAC 2015',
  user: 'Mi alimento',
  label: 'Etiqueta',
  recipe: 'Receta',
}
export const SOURCE_SHORT: Record<FoodSource, string> = {
  usda_foundation: 'USDA',
  usda_sr: 'USDA',
  usda_fndds: 'USDA',
  off: 'OFF',
  icbf_tcac2015: 'ICBF',
  user: 'Mío',
  label: 'Etiqueta',
  recipe: 'Receta',
}
export const KIND_LABEL: Record<FoodKind, string> = {
  generic: 'Genérico',
  raw: 'Crudo',
  cooked: 'Cocido',
  prepared: 'Preparado',
  packaged: 'Empacado',
  recipe: 'Receta',
  user: 'Personal',
}

export const MEALS: { key: MealKey; es: string }[] = [
  { key: 'desayuno', es: 'Desayuno' },
  { key: 'media_manana', es: 'Media mañana' },
  { key: 'almuerzo', es: 'Almuerzo' },
  { key: 'onces', es: 'Onces' },
  { key: 'cena', es: 'Cena' },
  { key: 'otro', es: 'Otros' },
]
export const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.es])) as Record<MealKey, string>

export function defaultMeal(time: string): MealKey {
  const [h, m] = time.split(':').map(Number)
  const t = h * 60 + (m || 0)
  if (t < 10 * 60 + 30) return 'desayuno'
  if (t < 12 * 60) return 'media_manana'
  if (t < 15 * 60) return 'almuerzo'
  if (t < 18 * 60 + 30) return 'onces'
  if (t < 22 * 60) return 'cena'
  return 'otro'
}

export function foodRank(f: Food): number {
  if (f.curated) return SOURCE_RANK.curated
  return SOURCE_RANK[f.source] ?? 6
}

export function foodSearchText(f: Food): string {
  return [f.name, f.nameOrig !== f.name ? f.nameOrig : '', f.brand ?? '', f.synonyms, f.barcode ?? ''].join(' ')
}

export function fromCatalogRow(row: CatalogFoodRow, order: readonly NutrientCode[], datasetVersion: string): Food {
  const [id, name, nameEs, brand, barcode, category, kind, basis, values, portions, synonyms, flags] = row
  const source = id.slice(0, id.indexOf(':')) as FoodSource
  const flagList = flags ? flags.split(';').filter(Boolean) : []
  const isUsda = source.startsWith('usda_')
  return {
    ref: id,
    source,
    name: nameEs || name,
    nameOrig: name,
    brand,
    barcode,
    category,
    kind,
    basis,
    nutrients: rowToNutrientMap(values, order),
    portions: portions ?? [],
    flags: flagList,
    synonyms: synonyms ?? '',
    datasetVersion,
    curated: flagList.includes('curated_es'),
    englishOnly: isUsda && !nameEs,
    servingGrams: null,
  }
}

export function fromRefFood(r: RefFood): Food {
  return {
    ref: r.id,
    source: r.source,
    name: r.nameEs || r.name,
    nameOrig: r.name,
    brand: r.brand,
    barcode: r.barcode,
    category: r.category,
    kind: r.kind,
    basis: r.basis,
    nutrients: r.nutrients,
    portions: r.portions,
    flags: r.flags,
    synonyms: r.synonyms ?? '',
    datasetVersion: r.datasetVersion,
    curated: false,
    englishOnly: false,
    servingGrams: null,
  }
}

export function fromCustomFood(c: CustomFood): Food {
  return {
    ref: `custom:${c.id}`,
    source: c.source,
    name: c.name,
    nameOrig: c.name,
    brand: c.brand,
    barcode: c.barcode,
    category: c.category,
    kind: c.kind,
    basis: c.basis,
    nutrients: c.nutrients,
    portions: c.portions,
    flags: [],
    synonyms: '',
    datasetVersion: null,
    curated: false,
    englishOnly: false,
    servingGrams: c.basis === 'serving' ? null : c.servingSize,
    servingLabel: c.basis === 'serving' ? (c.servingLabel ?? null) : null,
  }
}

export interface RecipeTotals {
  totals: NutrientMap
  partial: NutrientCode[]
  rawWeightG: number | null
  perServing: NutrientMap
  per100g: NutrientMap | null
}

export function recipeTotals(r: Pick<Recipe, 'ingredients' | 'servings' | 'cookedWeightG'>): RecipeTotals {
  const { totals, partial } = sumNutrients(r.ingredients)
  const grams = r.ingredients.map((i) => i.grams)
  const rawWeightG = grams.every((g) => g !== null) ? grams.reduce<number>((a, b) => a + (b ?? 0), 0) : null
  const servings = r.servings > 0 ? r.servings : 1
  return {
    totals,
    partial,
    rawWeightG,
    perServing: scaleNutrients(totals, 1 / servings),
    per100g: r.cookedWeightG && r.cookedWeightG > 0 ? scaleNutrients(totals, 100 / r.cookedWeightG) : null,
  }
}

/** Recipes are logged per serving, or per gram only when the cooked weight is known. */
export function fromRecipe(r: Recipe): Food {
  const t = recipeTotals(r)
  const byWeight = t.per100g !== null && !!r.cookedWeightG
  return {
    ref: `recipe:${r.id}`,
    source: 'recipe',
    name: r.name,
    nameOrig: r.name,
    brand: null,
    barcode: null,
    category: 'Receta',
    kind: 'recipe',
    basis: byWeight ? '100g' : 'serving',
    nutrients: byWeight ? (t.per100g as NutrientMap) : t.perServing,
    portions: byWeight ? [['1 porción', (r.cookedWeightG as number) / (r.servings || 1)]] : [],
    flags: t.partial.length ? ['partial'] : [],
    synonyms: 'receta',
    datasetVersion: null,
    curated: false,
    englishOnly: false,
    servingGrams: null,
  }
}

// ───────────── Quantity units offered for a food ─────────────
export interface UnitOption {
  key: string // 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l' | 'serving' | 'portion:<i>'
  label: string
  unit: QtyUnit
  portionGrams?: number
  portionLabel?: string
  defaultQty: number
}

export function unitOptions(f: Food): UnitOption[] {
  const out: UnitOption[] = []
  if (f.basis === '100g') {
    out.push({ key: 'g', label: 'g', unit: 'g', defaultQty: 100 })
    out.push({ key: 'kg', label: 'kg', unit: 'kg', defaultQty: 1 })
    out.push({ key: 'oz', label: 'oz', unit: 'oz', defaultQty: 1 })
  } else if (f.basis === '100ml') {
    out.push({ key: 'ml', label: 'ml', unit: 'ml', defaultQty: 100 })
    out.push({ key: 'l', label: 'litros', unit: 'l', defaultQty: 1 })
  } else {
    out.push({ key: 'serving', label: f.servingLabel ? `${f.servingLabel} (etiqueta, porción)` : 'porción (etiqueta)', unit: 'serving', defaultQty: 1 })
  }
  if (f.basis !== 'serving') {
    f.portions.forEach(([label, grams], i) => {
      if (grams > 0)
        out.push({
          key: `portion:${i}`,
          label: `${label} (${fmtG(grams)} ${f.basis === '100ml' ? 'ml' : 'g'})`,
          unit: 'portion',
          portionGrams: grams,
          portionLabel: label,
          defaultQty: 1,
        })
    })
  }
  return out
}

function fmtG(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}

export function buildSnapshot(f: Food, qty: number, opt: UnitOption): FoodSnapshot | { error: string } {
  const r = quantityFactor({
    qty,
    unit: opt.unit,
    basis: f.basis,
    portionGrams: opt.portionGrams ?? null,
    servingGrams: f.servingGrams,
  })
  if ('error' in r) return { error: r.error }
  const nutrients = scaleNutrients(f.nutrients, r.factor)
  return {
    foodRef: f.ref,
    name: f.name,
    brand: f.brand,
    source: f.source,
    datasetVersion: f.datasetVersion,
    kind: f.kind,
    qty,
    unit: opt.unit,
    portionLabel: opt.portionLabel ?? null,
    grams: r.grams,
    ml: r.ml,
    nutrients,
    missing: CORE_NUTRIENTS.filter((c) => nutrients[c] === undefined),
  }
}

export function describeQty(s: Pick<FoodSnapshot, 'qty' | 'unit' | 'portionLabel' | 'grams' | 'ml'>): string {
  const q = fmtQty(s.qty)
  switch (s.unit) {
    case 'portion':
      return `${q} × ${s.portionLabel ?? 'porción'}${s.grams ? ` (${fmtG(round1(s.grams))} g)` : s.ml ? ` (${fmtG(round1(s.ml))} ml)` : ''}`
    case 'serving':
      return `${q} ${s.qty === 1 ? 'porción' : 'porciones'}${s.grams ? ` (${fmtG(round1(s.grams))} g)` : ''}`
    case 'l':
      return `${q} L`
    default:
      return `${q} ${s.unit}`
  }
}
const round1 = (n: number) => Math.round(n * 10) / 10
function fmtQty(n: number) {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString().replace('.', ',')
}
