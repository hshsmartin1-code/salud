import type { CatalogFoodRow, FoodBasis, FoodKind, FoodSource, NutrientCode, NutrientMap } from '../../db/catalogTypes'
import type { CustomFood, FoodSnapshot, MealKey, Recipe, RefFood } from '../../db/types'
import { CORE_NUTRIENTS, rowToNutrientMap, scaleNutrients, sumNutrients } from '../../domain/nutrients'
import { quantityFactor, type QtyUnit } from '../../domain/units'
import { SOURCE_RANK } from '../../domain/search'
import { formatEach, normalizePortion } from '../../domain/portionLabel'
import { legacyPortion, portionForFood, type HouseholdPortion, type PortionEquivalentUnit, type PortionVerification } from '../../domain/portions'

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
  householdPortions?: HouseholdPortion[]
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
  /** Shown text: "porción (150 g)" for a measure, "g" for a plain unit. */
  label: string
  /** Name of a measure without its equivalence ("porción"): what chips and the diary show. */
  name?: string
  unit: QtyUnit
  portionGrams?: number
  portionLabel?: string
  portionId?: string
  portionSource?: FoodSource
  portionVerification?: PortionVerification
  portionEquivalentAmount?: number
  portionEquivalentUnit?: PortionEquivalentUnit
  defaultQty: number
}

/** The reference measures the catalogs add that are not something a person eats ("Cantidad no especificada"). */
export const NOT_A_PORTION = /cantidad no especificada|cantidad de referencia/i

/** A catalog measure as the person sees it; a person's own measure keeps their words. */
function shownPortion(label: string, amount: number, unit: PortionEquivalentUnit, custom: boolean) {
  const shown = custom ? { name: label, each: formatEach(amount, unit) } : normalizePortion(label, amount, unit)
  return { name: shown.name, text: `${shown.name} (${shown.each})` }
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
    const seen = new Set<string>()
    const add = (o: UnitOption) => {
      const k = o.label.toLowerCase()
      if (seen.has(k)) return
      seen.add(k)
      out.push(o)
    }
    for (const p of f.householdPortions ?? []) {
      if (!portionForFood(p, f)) continue
      const shown = shownPortion(p.label, p.equivalentAmount, p.equivalentUnit, p.verification === 'custom')
      add({
        key: `household:${p.id}`,
        label: shown.text,
        name: shown.name,
        unit: 'portion',
        portionGrams: p.equivalentAmount,
        portionLabel: p.label,
        portionId: p.id,
        portionSource: p.source,
        portionVerification: p.verification,
        portionEquivalentAmount: p.equivalentAmount,
        portionEquivalentUnit: p.equivalentUnit,
        defaultQty: 1,
      })
    }
    f.portions.forEach(([label, grams], i) => {
      const p = legacyPortion(f, label, grams, i)
      if (!p) return
      const shown = shownPortion(label, grams, f.basis === '100ml' ? 'ml' : 'g', f.source === 'user')
      add({
        key: `portion:${i}`,
        label: shown.text,
        name: shown.name,
        unit: 'portion',
        portionGrams: grams,
        portionLabel: label,
        portionId: p.id,
        portionSource: p.source,
        portionVerification: p.verification,
        portionEquivalentAmount: p.equivalentAmount,
        portionEquivalentUnit: p.equivalentUnit,
        defaultQty: 1,
      })
    })
  }
  return out
}

/** A measure worth offering as "a portion" (not a reference quantity). */
export const isRealPortion = (o: UnitOption) => o.unit === 'portion' && !NOT_A_PORTION.test(o.label)

function fmtG(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}

export function buildSnapshot(f: Food, qty: number, opt: UnitOption): FoodSnapshot | { error: string } {
  if (opt.unit === 'portion' && opt.portionEquivalentUnit &&
      opt.portionEquivalentUnit !== (f.basis === '100g' ? 'g' : f.basis === '100ml' ? 'ml' : null)) {
    return { error: 'La unidad de la porción no coincide con la base nutricional' }
  }
  const r = quantityFactor({
    qty,
    unit: opt.unit,
    basis: f.basis,
    portionGrams: opt.portionGrams ?? null,
    servingGrams: f.servingGrams,
  })
  if ('error' in r) return { error: r.error }
  if (!Number.isFinite(r.factor) || (r.grams !== null && !Number.isFinite(r.grams)) ||
      (r.ml !== null && !Number.isFinite(r.ml))) return { error: 'La cantidad es demasiado grande' }
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
    ...(opt.portionId ? {
      portionId: opt.portionId,
      portionSource: opt.portionSource,
      portionVerification: opt.portionVerification,
      portionEquivalentAmount: opt.portionEquivalentAmount,
      portionEquivalentUnit: opt.portionEquivalentUnit,
    } : {}),
    grams: r.grams,
    ml: r.ml,
    nutrients,
    missing: CORE_NUTRIENTS.filter((c) => nutrients[c] === undefined),
  }
}

type QtyView = Pick<FoodSnapshot, 'qty' | 'unit' | 'portionLabel' | 'grams' | 'ml'> & Partial<Pick<FoodSnapshot, 'source' | 'portionVerification' | 'portionEquivalentAmount'>>

/** What ONE measure of a logged portion weighs: its stored equivalence, else the total over the quantity. */
function eachOf(s: QtyView): { amount: number; unit: 'g' | 'ml' } | null {
  const unit: 'g' | 'ml' = s.grams !== null && s.grams !== undefined ? 'g' : 'ml'
  const total = unit === 'g' ? s.grams : s.ml
  const amount = s.portionEquivalentAmount ?? (total !== null && total !== undefined && s.qty > 0 ? total / s.qty : null)
  return amount !== null && Number.isFinite(amount) && amount > 0 ? { amount, unit } : null
}

/** "porción (150 g)": a logged measure through the normaliser (a person's own measure keeps its words). */
export function measureText(s: QtyView): { name: string; text: string } {
  const each = eachOf(s)
  const raw = s.portionLabel ?? 'porción'
  if (s.portionVerification === 'custom' || s.source === 'user') {
    const name = raw.trim() || 'medida'
    return { name, text: each ? `${name} (${formatEach(each.amount, each.unit)})` : name }
  }
  if (!each) {
    const n = normalizePortion(raw, 1)
    return { name: n.name, text: n.name }
  }
  const n = normalizePortion(raw, each.amount, each.unit)
  return { name: n.name, text: `${n.name} (${n.each})` }
}

/** Full quantity: "150 g", "porción (150 g)", "2 × tajada (25 g)". */
export function describeQty(s: QtyView): string {
  const q = fmtQty(s.qty)
  switch (s.unit) {
    case 'portion': {
      const m = measureText(s)
      return s.qty === 1 ? m.text : `${q} × ${m.text}`
    }
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

/** Short quantity for a button or a row: "150 g", "2 × tajada", "tajada". The long form is `describeQty`. */
export function shortQty(s: QtyView): string {
  const q = fmtQty(s.qty)
  switch (s.unit) {
    case 'portion': {
      const m = measureText(s)
      return s.qty === 1 ? m.name : `${q} × ${m.name}`
    }
    case 'serving':
      return `${q} ${s.qty === 1 ? 'porción' : 'porciones'}`
    case 'l':
      return `${q} L`
    default:
      return `${q} ${s.unit}`
  }
}
