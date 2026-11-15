/**
 * Open Food Facts runtime lookups (barcode / text). Mirrors data-pipeline/off_foods.py conversions.
 * Data: Open Food Facts contributors, ODbL 1.0. Results are cached locally as reference foods.
 */
import type { NutrientCode, NutrientMap } from '../../db/catalogTypes'
import type { RefFood } from '../../db/types'

const FIELDS =
  'code,product_name,product_name_es,brands,quantity,serving_size,serving_quantity,nutriments,categories_tags,product_quantity,product_quantity_unit'
const OFF = 'https://world.openfoodfacts.org'

type Nutriments = Record<string, unknown>
export interface OffProduct {
  code?: string
  product_name?: string
  product_name_es?: string
  brands?: string | string[]
  quantity?: string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Nutriments
  categories_tags?: string[]
  product_quantity?: number | string
  product_quantity_unit?: string
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
  const u = String(p.product_quantity_unit ?? '').trim().toLowerCase()
  if (u) return ['ml', 'l', 'cl', 'dl'].includes(u)
  return /\b\d+(?:[.,]\d+)?\s*(ml|cl|dl|l|lt|lts|litros?|cc)\b/i.test(String(p.quantity ?? ''))
}

export type OffResult = { food: RefFood } | { error: string }

/** Convert an OFF product to a reference food; refuses products without name or energy. */
export function offToRefFood(p: OffProduct, fetchedAt = new Date().toISOString()): OffResult {
  const code = String(p.code ?? '').trim()
  if (!/^\d{6,14}$/.test(code)) return { error: 'Código de barras no válido' }
  const name = (p.product_name_es ?? '').trim() || (p.product_name ?? '').trim()
  if (!name) return { error: 'El producto no tiene nombre en Open Food Facts' }
  const nm = (p.nutriments ?? {}) as Nutriments
  const n: NutrientMap = {}
  const flags: string[] = []
  let kcal = num(nm['energy-kcal_100g'])
  const kj = num(nm['energy-kj_100g'])
  if (kcal === null && kj !== null) {
    kcal = kj / 4.184
    flags.push('kcal_from_kj')
  }
  if (kcal === null) return { error: 'El producto no tiene energía por 100 g/ml en Open Food Facts. Regístralo desde la etiqueta.' }
  n.kcal = r2(kcal)
  if (kj !== null) n.kj = r2(kj)
  for (const [key, c, mult] of MAP) {
    const v = num(nm[`${key}_100g`])
    if (v !== null) n[c] = r2(v * mult)
  }
  const fol = num(nm['vitamin-b9_100g']) ?? num(nm['folates_100g'])
  if (fol !== null) n.folate = r2(fol * 1e6)
  const sod = num(nm['sodium_100g'])
  const salt = num(nm['salt_100g'])
  if (sod !== null) n.sodium = r2(sod * 1000)
  else if (salt !== null) {
    n.sodium = r2((salt / 2.5) * 1000)
    flags.push('sodium_from_salt')
  }
  if (Object.values(n).some((v) => (v as number) < 0)) return { error: 'Valores negativos en Open Food Facts' }
  const macros = (n.protein ?? 0) + (n.carbs ?? 0) + (n.fat ?? 0)
  if (macros > 105) return { error: 'Datos inconsistentes en Open Food Facts (macros > 100 g)' }
  if (n.protein !== undefined && n.carbs !== undefined && n.fat !== undefined) {
    const est = 4 * n.protein + 4 * n.carbs + 9 * n.fat
    if (Math.abs(kcal - est) > 0.25 * Math.max(est, kcal)) flags.push('atwater_mismatch')
  }
  const portions: [string, number][] = []
  const sq = num(p.serving_quantity)
  if (sq !== null && sq > 0) portions.push([p.serving_size ? `1 porción (${p.serving_size})`.slice(0, 80) : '1 porción', r2(sq)])
  const pq = num(p.product_quantity)
  if (pq !== null && pq > 0) portions.push(['Envase completo', r2(pq)])
  const brands = Array.isArray(p.brands) ? p.brands.join(',') : (p.brands ?? '')
  const brand =
    brands
      .split(',')
      .map((b) => b.trim())
      .find(Boolean) ?? null
  const cat =
    (p.categories_tags ?? [])
      .map((t) => t.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim())
      .find(Boolean) ?? null
  return {
    food: {
      id: `off:${code}`,
      source: 'off',
      name,
      nameEs: name,
      brand,
      barcode: code,
      category: cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : null,
      kind: 'packaged',
      basis: isLiquid(p) ? '100ml' : '100g',
      nutrients: n,
      portions,
      synonyms: null,
      flags,
      datasetVersion: `Open Food Facts API (consulta ${fetchedAt.slice(0, 10)})`,
      fetchedAt,
    },
  }
}

export async function fetchOffBarcode(code: string, signal?: AbortSignal): Promise<OffResult> {
  if (!navigator.onLine) return { error: 'Sin conexión: no se puede consultar Open Food Facts.' }
  const res = await fetch(`${OFF}/api/v3/product/${encodeURIComponent(code)}?fields=${FIELDS}`, { signal })
  if (res.status === 404) return { error: 'Producto no encontrado en Open Food Facts.' }
  if (res.status === 429) return { error: 'Open Food Facts limitó las consultas. Intenta en un minuto.' }
  if (!res.ok) return { error: `Error de Open Food Facts (${res.status})` }
  const body = (await res.json()) as { status?: string; product?: OffProduct }
  if (!body.product) return { error: 'Producto no encontrado en Open Food Facts.' }
  return offToRefFood({ code, ...body.product })
}

export async function searchOff(
  query: string,
  signal?: AbortSignal,
): Promise<{ foods: RefFood[]; skipped: number } | { error: string }> {
  if (!navigator.onLine) return { error: 'Sin conexión: no se puede consultar Open Food Facts.' }
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=30&fields=${FIELDS}`
  const res = await fetch(url, { signal })
  if (res.status === 429) return { error: 'Open Food Facts limitó las búsquedas (máx. ~10 por minuto). Intenta en un momento.' }
  if (!res.ok) return { error: `Error de Open Food Facts (${res.status})` }
  const body = (await res.json()) as { products?: OffProduct[] }
  const foods: RefFood[] = []
  let skipped = 0
  for (const p of body.products ?? []) {
    const r = offToRefFood(p)
    if ('food' in r) foods.push(r.food)
    else skipped++
  }
  return { foods, skipped }
}
