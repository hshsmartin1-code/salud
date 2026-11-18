import { normalize } from '../../domain/search'
import { foodRank, type Food } from './food'

// Unambiguous regional spellings and commercial names. Brand ownership is indexed
// independently of the product name so Ramito never becomes a synonym for Chocoramo.
const spellings: [RegExp, string][] = [
  [/\bchoco\s*r{1,2}amo\b/g, 'chocoramo'],
  [/\bcoca\s*cola\b/g, 'cocacola'],
  [/\bcocacola cero\b/g, 'cocacola zero'],
  [/\bcacahuates?\b/g, 'mani'],
  [/\bpaltas?\b/g, 'aguacate'],
  [/\bfrijoles\b/g, 'frijol'],
  [/\barepas\b/g, 'arepa'],
]

const commonIntent: Record<string, string> = { pechuga: 'pechuga de pollo' }

function terms(text: string) {
  return spellings.reduce((s, [pattern, value]) => s.replace(pattern, value), normalize(text))
}

export function foodQuery(text: string) {
  const q = terms(text.slice(0, 120)).replace(/\s+(?:calorias|kcal|informacion nutricional|valor nutricional)$/, '')
  return { local: q, remote: q.replace(/\bcocacola\b/g, 'coca cola') }
}

export function foodBarcode(raw: string): string | null {
  const code = raw.trim().replace(/[\s-]/g, '')
  return /^\d{6,14}$/.test(code) ? code : null
}

// Ignore GTIN padding for identity, but keep the original code and food reference for selection.
export function barcodeKey(code: string) {
  return code.replace(/^0+(?=\d)/, '')
}

export function sameBrandedFood(a: Food, b: Food): boolean {
  if (!a.barcode || !b.barcode || barcodeKey(a.barcode) !== barcodeKey(b.barcode)) return false
  if (a.source === 'off' && b.source === 'off') return true
  if (a.basis !== b.basis || terms(a.name) !== terms(b.name) || terms(a.brand ?? '') !== terms(b.brand ?? '')) return false
  const keys = Object.keys(a.nutrients) as (keyof Food['nutrients'])[]
  return keys.length === Object.keys(b.nutrients).length && keys.every((key) => a.nutrients[key] === b.nutrients[key]) &&
    a.portions.length === b.portions.length && a.portions.every(([label, amount], i) => b.portions[i]?.[0] === label && b.portions[i]?.[1] === amount)
}

type Entry = { food: Food; name: string; brand: string; original: string; visible: Set<string>; rank: number }
type TokenMatch = { exact: number[]; prefix: number[]; partial: number[]; typo: number[] }

export interface FoodSearchIndex {
  entries: Entry[]
  words: Map<string, number[]>
  barcodes: Map<string, number[]>
  matches: Map<string, TokenMatch>
}

export function indexFoods(foods: Food[]): FoodSearchIndex {
  const words = new Map<string, number[]>()
  const barcodes = new Map<string, number[]>()
  function add(map: Map<string, number[]>, key: string, i: number) {
    const ids = map.get(key)
    if (ids) ids.push(i)
    else map.set(key, [i])
  }
  const entries = foods.map((food, i) => {
    const name = terms(food.name)
    const original = terms(food.nameOrig)
    const brand = terms(food.brand ?? '')
    const owner = food.source === 'off' && /\b(?:chocoramo|ramito)\b/.test(name) ? 'ramo' : ''
    const visible = new Set(`${name} ${brand} ${owner}`.split(' ').filter(Boolean))
    const alternatives = new Set(`${original} ${terms(food.synonyms)}`.split(' ').filter(Boolean))
    // USDA's English parenthetical for purple passion fruit is not the Colombian granadilla (P. ligularis).
    if (food.ref === 'usda_sr:169108') alternatives.delete('granadilla')
    for (const word of new Set([...visible, ...alternatives])) add(words, word, i)
    if (food.barcode) add(barcodes, barcodeKey(food.barcode), i)
    return { food, name, brand: brand || owner, original, visible, rank: foodRank(food) }
  })
  return { entries, words, barcodes, matches: new Map() }
}

/** One insertion, deletion, substitution or adjacent transposition. */
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length > b.length) [a, b] = [b, a]
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1)
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
}

function tokenMatches(index: FoodSearchIndex, token: string): TokenMatch {
  const cached = index.matches.get(token)
  if (cached) return cached
  const match: TokenMatch = { exact: index.words.get(token) ?? [], prefix: [], partial: [], typo: [] }
  for (const [word, ids] of index.words) {
    if (word === token) continue
    const target = word.startsWith(token) ? match.prefix
      : token.length >= 4 && word.includes(token) ? match.partial
      : token.length >= 4 && word.length >= 3 && !/\d/.test(token) && oneEdit(token, word) ? match.typo
      : null
    if (target) for (const id of ids) target.push(id)
  }
  if (index.matches.size >= 96) index.matches.delete(index.matches.keys().next().value!)
  index.matches.set(token, match)
  return match
}

export interface FoodUsage { count: number; lastUsedAt: string }
export interface FoodMatch { food: Food; tier: number }

export function findFoods(
  indexes: readonly FoodSearchIndex[], raw: string,
  opts: { limit?: number; filter?: (f: Food) => boolean; usage?: ReadonlyMap<string, FoodUsage>; favorites?: ReadonlySet<string> } = {},
): FoodMatch[] {
  const q = foodQuery(raw).local
  if (!q) return []
  const queryTokens = [...new Set(q.split(' ').filter((t) => !['de', 'del', 'la', 'el'].includes(t)))]
  const code = foodBarcode(raw)
  const rows: (FoodMatch & { rank: number; nameLength: number; preferred: boolean })[] = []
  const seen = new Set<string>()
  const intent = commonIntent[q]
  for (const index of indexes) {
    const matches = code ? [] : queryTokens.map((t) => tokenMatches(index, t))
    const candidates = new Map<number, number>()
    if (code) {
      for (const id of index.barcodes.get(barcodeKey(code)) ?? []) candidates.set(id, 0)
    } else for (const [i, match] of matches.entries()) {
      const next = new Map<number, number>()
      const add = (ids: number[], strength: number) => {
        for (const id of ids) {
          const previous = i === 0 ? 0 : candidates.get(id)
          if (previous !== undefined && !next.has(id)) next.set(id, Math.max(strength, previous))
        }
      }
      add(match.exact, 0)
      add(match.prefix, 1)
      add(match.partial, 2)
      add(match.typo, 3)
      candidates.clear()
      for (const [id, score] of next) candidates.set(id, score)
      if (!candidates.size) break
    }
    for (const [id, strength] of candidates) {
      const { food, name, original, visible, brand, rank } = index.entries[id]!
      if (seen.has(food.ref) || (opts.filter && !opts.filter(food))) continue
      seen.add(food.ref)
      const bareUnverifiedName = food.source === 'off' && queryTokens.length === 1 &&
        (food.nutrients.kcal ?? 0) < 1 && food.nutrients.protein === undefined &&
        food.nutrients.carbs === undefined && food.nutrients.fat === undefined
      const tier = code || (name === q && !bareUnverifiedName) ? 0
        : brand === q || (original !== name && original === q) ? 1
        : name.startsWith(q) ? 2
        : strength === 0 && queryTokens.every((t) => visible.has(t)) ? 3
        : 4 + strength
      rows.push({ food, tier, rank, nameLength: name.length, preferred: !!intent && name.startsWith(intent) })
    }
  }
  rows.sort((a, b) => {
    const au = opts.usage?.get(a.food.ref)
    const bu = opts.usage?.get(b.food.ref)
    return a.tier - b.tier ||
      Number(!!opts.favorites?.has(b.food.ref)) - Number(!!opts.favorites?.has(a.food.ref)) ||
      (bu?.count ?? 0) - (au?.count ?? 0) ||
      (bu?.lastUsedAt ?? '').localeCompare(au?.lastUsedAt ?? '') ||
      Number(b.preferred) - Number(a.preferred) ||
      Number(!!a.food.englishOnly) - Number(!!b.food.englishOnly) ||
      a.rank - b.rank ||
      Number(!!b.food.soldInColombia) - Number(!!a.food.soldInColombia) ||
      a.nameLength - b.nameLength || a.food.ref.localeCompare(b.food.ref)
  })
  const distinct: FoodMatch[] = []
  const barcodes = new Map<string, Food[]>()
  for (const { food, tier } of rows) {
    if (food.barcode) {
      const key = barcodeKey(food.barcode)
      const previous = barcodes.get(key) ?? []
      if (previous.some((f) => sameBrandedFood(f, food))) continue
      barcodes.set(key, [...previous, food])
    }
    distinct.push({ food, tier })
    if (distinct.length >= (opts.limit ?? 60)) break
  }
  return distinct
}

/** Reuse the text tiers for remote hits. OFF can also match ingredients and categories. */
export function orderOffHits(foods: Food[], query: string) {
  const matches = findFoods([indexFoods(foods)], query, { limit: foods.length })
  const matched = new Set(matches.map(({ food }) => food.ref))
  return { foods: [...matches.map(({ food }) => food), ...foods.filter((f) => !matched.has(f.ref))], tier: matches[0]?.tier }
}
