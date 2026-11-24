/**
 * Convert community-contributed Open Food Facts data (ODbL 1.0 / DbCL 1.0).
 */
import type { NutrientCode, NutrientMap } from '../../db/catalogTypes'
import type { RefFood } from '../../db/types'
import { alcoholGramsPer100ml, atwaterKcal } from '../../domain/nutrients'

type Nutriments = Record<string, unknown>
export interface OffProduct {
  code?: string
  product_name?: string
  product_name_es?: string
  brands?: string | string[]
  quantity?: string
  serving_size?: string
  serving_quantity?: number | string
  serving_quantity_unit?: string
  nutriments?: Nutriments
  categories_tags?: string[]
  product_quantity?: number | string
  product_quantity_unit?: string
  nutrition_data_per?: string
  countries_tags?: string[]
  image_front_small_url?: string
  rev?: number
}
const MAP: [string, NutrientCode, number][] = [
  ['proteins', 'protein', 1],
  ['carbohydrates', 'carbs', 1],
  ['fat', 'fat', 1],
  ['saturated-fat', 'satFat', 1],
  ['monounsaturated-fat', 'monoFat', 1],
  ['polyunsaturated-fat', 'polyFat', 1],
  ['trans-fat', 'transFat', 1],
  ['fiber', 'fiber', 1],
  ['sugars', 'sugars', 1],
  ['added-sugars', 'addedSugars', 1],
  ['cholesterol', 'cholesterol', 1000],
  ['potassium', 'potassium', 1000],
  ['calcium', 'calcium', 1000],
  ['iron', 'iron', 1000],
  ['magnesium', 'magnesium', 1000],
  ['phosphorus', 'phosphorus', 1000],
  ['zinc', 'zinc', 1000],
  ['vitamin-a', 'vitA', 1e6],
  ['vitamin-d', 'vitD', 1e6],
  ['vitamin-b12', 'vitB12', 1e6],
  ['vitamin-c', 'vitC', 1000],
  ['vitamin-e', 'vitE', 1000],
]

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}
const r2 = (n: number) => Math.round(n * 100) / 100

function isLiquid(p: OffProduct): boolean {
  if (p.nutrition_data_per === '100ml') return true
  const u = String(p.product_quantity_unit ?? '').trim().toLowerCase()
  if (u) return ['ml', 'l', 'cl', 'dl'].includes(u)
  return /\b\d+(?:[.,]\d+)?\s*(ml|cl|dl|l|lt|lts|litros?|cc)\b/i.test(String(p.quantity ?? ''))
}

function normalizedUnit(v: unknown): 'g' | 'ml' | null {
  const u = String(v ?? '').trim().toLowerCase()
  return u === 'g' || u === 'ml' ? u : null
}

type Measure = { amount: number; unit: 'g' | 'ml' }
const MEASURE_RE = /\b(\d+(?:[.,]\d+)?)\s*(kg|mg|g|gr|grs|gramos|ml|cl|dl|l|lt|lts|litro|litros|cc)\b/gi
const MEASURE_FACTOR: Record<string, number> = { kg: 1000, mg: 0.001, g: 1, gr: 1, grs: 1, gramos: 1, ml: 1, cl: 10, dl: 100, l: 1000, lt: 1000, lts: 1000, litro: 1000, litros: 1000, cc: 1 }

function textMeasure(value: unknown): Measure | null {
  const text = String(value ?? '')
  if (/\d\s*[x×]\s*\d/i.test(text)) return null
  const matches = [...text.matchAll(MEASURE_RE)]
  if (matches.length !== 1) return null
  const u = matches[0][2].toLowerCase()
  const amount = Number(matches[0][1].replace(',', '.')) * MEASURE_FACTOR[u]
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { amount, unit: ['kg', 'mg', 'g', 'gr', 'grs', 'gramos'].includes(u) ? 'g' : 'ml' }
}

function agrees(a: Measure, b: Measure): boolean {
  return a.unit === b.unit && Math.abs(a.amount - b.amount) <= 0.02
}

function servingQuantity(p: OffProduct): Measure | null {
  if (/\d\s*[x×]\s*\d/i.test(String(p.serving_size ?? ''))) return null
  const text = textMeasure(p.serving_size)
  const sq = num(p.serving_quantity)
  const unit = normalizedUnit(p.serving_quantity_unit)
  if (sq !== null && sq <= 0) return null
  if (p.serving_quantity_unit != null && (!unit || (text && text.unit !== unit))) return null
  if (sq !== null && sq > 0 && unit) {
    const normalized = { amount: sq, unit }
    return text && !agrees(text, normalized) ? null : normalized
  }
  if (!text) return null
  return sq !== null && Math.abs(sq - text.amount) > 0.02 ? null : text
}

function packageQuantity(p: OffProduct): Measure | null {
  const pq = num(p.product_quantity)
  const text = textMeasure(p.quantity)
  const unit = normalizedUnit(p.product_quantity_unit)
  if (pq !== null && pq <= 0) return null
  if (p.product_quantity_unit != null && (!unit || (text && text.unit !== unit))) return null
  if (pq !== null) {
    if (unit && pq > 0) {
      const normalized = { amount: pq, unit }
      return text && !agrees(text, normalized) ? null : normalized
    }
    if (!text || Math.abs(pq - text.amount) > 0.02) return null
    return text
  }
  return text
}

export type OffResult = { food: RefFood } | { error: string }

export function offImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.origin === 'https://images.openfoodfacts.org' && url.pathname.startsWith('/images/products/')) return url.href
  } catch { /* No usable product image. */ }
  return undefined
}

/** Convert an OFF product to a reference food; refuses products without name or energy. */
export function offToRefFood(p: OffProduct, fetchedAt = new Date().toISOString()): OffResult {
  const code = String(p.code ?? '').trim()
  if (!/^\d{6,14}$/.test(code)) return { error: 'Código de barras no válido' }
  const name = (typeof p.product_name_es === 'string' ? p.product_name_es.trim() : '') ||
    (typeof p.product_name === 'string' ? p.product_name.trim() : '')
  if (!name || /^\d+$/.test(name)) return { error: 'El producto no tiene nombre en Open Food Facts' }
  const nm = (p.nutriments ?? {}) as Nutriments
  const n: NutrientMap = {}
  const flags: string[] = []
  const basis = isLiquid(p) ? '100ml' : '100g'
  const expectedUnit = basis === '100ml' ? 'ml' : 'g'
  const serving = servingQuantity(p)
  const pq = packageQuantity(p)
  const validServing = serving && serving.unit === expectedUnit &&
    !(pq && pq.unit === expectedUnit && serving.amount > pq.amount + 0.02) ? serving : null
  if (!validServing && (p.serving_size || p.serving_quantity != null)) flags.push('off_serving_unverified')
  const servingBasis = p.nutrition_data_per === 'serving'
  const factor = validServing ? 100 / validServing.amount : null
  // For declared per-serving labels, derive the base from the checked measure.
  // A reported serving with no reliable g/ml equivalent remains per serving.
  const outputBasis = servingBasis && factor === null ? 'serving' : basis
  let conflict = false
  function amount(key: string) {
    const per100 = num(nm[`${key}_100g`])
    const perServing = num(nm[`${key}_serving`])
    if (!servingBasis) return per100
    if (perServing === null) return factor !== null ? per100 : null
    if (factor === null) return perServing
    const scaled = perServing * factor
    if (per100 !== null && Math.abs(per100 - scaled) > Math.max(0.00001, Math.abs(scaled) * 0.06)) conflict = true
    return scaled
  }
  let kcal = amount('energy-kcal')
  const kj = amount('energy-kj') ?? amount('energy') // OFF's canonical generic energy is kJ.
  if (kcal === null && kj !== null) {
    kcal = kj / 4.184
    flags.push('kcal_from_kj')
  }
  if (kcal === null) return { error: 'El producto no tiene energía utilizable en Open Food Facts. Regístralo desde la etiqueta.' }
  if (kcal < 0 || (kj !== null && kj < 0) || (outputBasis === '100g' && kcal > 950) || kcal > 10000)
    return { error: 'Energía fuera de rango en Open Food Facts' }
  n.kcal = r2(kcal)
  if (kj !== null) {
    if (Math.abs(kcal * 4.184 - kj) <= Math.max(5, kcal * 4.184 * 0.1)) n.kj = r2(kj)
    else flags.push('kj_inconsistent_nulled')
  }
  for (const [key, c, mult] of MAP) {
    const v = amount(key)
    if (v !== null && (v < 0 || !Number.isFinite(v * mult) || (outputBasis === '100g' && v > 105)))
      return { error: 'Nutriente fuera de rango en Open Food Facts' }
    if (v !== null) n[c] = r2(v * mult)
  }
  const fol = amount('vitamin-b9') ?? amount('folates')
  if (fol !== null) n.folate = r2(fol * 1e6)
  const sod = amount('sodium')
  const salt = amount('salt')
  if (sod !== null) {
    n.sodium = r2(sod * 1000)
    if (salt !== null && Math.abs(sod * 2.5 - salt) > Math.max(0.025, salt * 0.1)) flags.push('off_salt_conflict')
  }
  else if (salt !== null) {
    n.sodium = r2((salt / 2.5) * 1000)
    flags.push('sodium_from_salt')
  }
  if (Object.values(n).some((v) => !Number.isFinite(v) || v < 0)) return { error: 'Valores inválidos en Open Food Facts' }
  const macros = (n.protein ?? 0) + (n.carbs ?? 0) + (n.fat ?? 0)
  if (outputBasis === '100g' && macros > 105) return { error: 'Datos inconsistentes en Open Food Facts (macros > 100 g)' }
  // Shared energy formula (available carbohydrate + fibre at 2 kcal/g, see atwaterKcal). OFF gives alcohol in
  // % vol; it is turned into grams only on a per-100 ml basis and used for this check, never stored (the
  // catalogue has no alcohol field).
  const alcoholG = outputBasis === '100ml' ? alcoholGramsPer100ml(num(nm.alcohol_100g)) : undefined
  if (n.protein !== undefined && n.carbs !== undefined && n.fat !== undefined) {
    const est = atwaterKcal(n, { alcoholG })
    if (est !== undefined && Math.abs(kcal - est) > 0.25 * Math.max(est, kcal)) flags.push('atwater_mismatch')
  }
  const portions: [string, number][] = []
  if (validServing && r2(validServing.amount) > 0)
    portions.push([p.serving_size ? `1 porción (${p.serving_size})`.slice(0, 80) : '1 porción', r2(validServing.amount)])
  if (outputBasis !== 'serving' && pq && pq.unit === expectedUnit && r2(pq.amount) > 0)
    portions.push(['Envase completo', r2(pq.amount)])
  if (portions.length) flags.push('portion_units_checked')
  if (conflict) flags.push('off_basis_conflict')
  const brands = Array.isArray(p.brands) ? p.brands.join(',') : (typeof p.brands === 'string' ? p.brands : '')
  const brand =
    brands
      .split(',')
      .map((b) => b.trim())
      .find(Boolean) ?? null
  const cat =
    (Array.isArray(p.categories_tags) ? p.categories_tags.filter((t) => typeof t === 'string') : [])
      .map((t) => t.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim())
      .find(Boolean) ?? null
  return {
    food: {
      id: `off:${code}`,
      source: 'off',
      name,
      nameEs: name,
      brand,
      imageUrl: offImageUrl(p.image_front_small_url),
      packageLabel: typeof p.quantity === 'string' ? p.quantity.trim().slice(0, 80) : undefined,
      soldInColombia: Array.isArray(p.countries_tags) && p.countries_tags.includes('en:colombia'),
      barcode: code,
      category: cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : null,
      kind: 'packaged',
      basis: outputBasis,
      nutrients: n,
      portions,
      synonyms: brands || null,
      flags,
      datasetVersion: `Open Food Facts API (${Number.isInteger(p.rev) ? `rev. ${p.rev}, ` : ''}consulta ${fetchedAt.slice(0, 10)})`,
      fetchedAt,
    },
  }
}
