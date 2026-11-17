import { normalize } from '../../domain/search'
import type { Food } from './food'

/**
 * One row per food id. The same id can come from the online Open Food Facts cache (device store) and from
 * the bundled catalog; keep the one `resolve` would return (the device copy wins), in first-seen order,
 * so a tap opens what logging would use and React keys stay unique.
 */
export function dedupeByRef(foods: readonly Food[], resolve: (ref: string) => Food | undefined): Food[] {
  const seen = new Set<string>()
  const out: Food[] = []
  for (const f of foods) {
    if (seen.has(f.ref)) continue
    seen.add(f.ref)
    out.push(resolve(f.ref) ?? f)
  }
  return out
}

export interface FoodUsage {
  count: number
  /** ISO instant of the last use. */
  lastUsedAt: string
}

export interface OrderedResults {
  /** Shown as is: foods the person used, then Spanish-named catalog matches. */
  main: Food[]
  /** Entries with no Spanish name, folded behind one "Ver N resultados en inglés" row. */
  english: Food[]
}

/**
 * Orders typed-query results without adding or dropping any (the same foods, the same dedupe by ref):
 * (a) foods the person has logged before, by use count then recency; (b) Spanish-named matches, exact
 * name before prefix before any other match; (c) English-only entries last, apart. Ties keep the search
 * order, so the ranking of the search index still decides within each group.
 */
export function orderQueryResults(foods: readonly Food[], query: string, usage: ReadonlyMap<string, FoodUsage>): OrderedResults {
  const q = normalize(query)
  const tier = (f: Food) => {
    const name = normalize(f.name)
    return name === q ? 0 : name.startsWith(q) ? 1 : 2
  }
  const used: { f: Food; i: number; u: FoodUsage }[] = []
  const spanish: { f: Food; i: number; t: number }[] = []
  const english: Food[] = []
  foods.forEach((f, i) => {
    const u = usage.get(f.ref)
    if (u && u.count > 0) used.push({ f, i, u })
    else if (f.englishOnly) english.push(f)
    else spanish.push({ f, i, t: tier(f) })
  })
  used.sort((a, b) => b.u.count - a.u.count || b.u.lastUsedAt.localeCompare(a.u.lastUsedAt) || a.i - b.i)
  spanish.sort((a, b) => a.t - b.t || a.i - b.i)
  return { main: [...used.map((x) => x.f), ...spanish.map((x) => x.f)], english }
}
