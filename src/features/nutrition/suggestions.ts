import type { FoodLog, MealKey } from '../../db/types'
import { addDays } from '../../domain/dates'
import { sumNutrients } from '../../domain/nutrients'

/** Pure suggestion logic for one-tap logging. Nothing here recomputes nutrients: a suggestion carries a frozen log. */
export const SUGGESTION_WINDOW_DAYS = 60
export const SUGGESTION_CAP = 6

export interface Suggestion {
  foodRef: string
  name: string
  /** How many times the food was logged in this meal inside the window. */
  count: number
  lastDate: string
  /** The most recent log of this food in this meal; it is what a one-tap add copies. */
  snapshot: FoodLog
}

/** Newest first: date, then time of day, then creation time. */
export function newestFirst(a: FoodLog, b: FoodLog): number {
  return b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt)
}

export interface SuggestOptions {
  days?: number
  cap?: number
  /** Drop foods already logged in that meal on that date (default true). */
  excludeLogged?: boolean
}

/**
 * Foods most often logged in `meal` during the `days` before `date` (and on it), ties broken by recency.
 * Each carries the snapshot of its most recent log in that meal. Foods already logged in that meal on
 * `date` are excluded so a suggestion never offers what is already there.
 */
export function suggestForMeal(logs: readonly FoodLog[], meal: MealKey, date: string, opts: SuggestOptions = {}): Suggestion[] {
  const { days = SUGGESTION_WINDOW_DAYS, cap = SUGGESTION_CAP, excludeLogged = true } = opts
  const from = addDays(date, -days)
  const inMeal = logs.filter((l) => l.meal === meal && l.date >= from && l.date <= date)
  const logged = new Set(inMeal.filter((l) => l.date === date).map((l) => l.foodRef))
  const groups = new Map<string, FoodLog[]>()
  for (const l of inMeal) {
    if (excludeLogged && logged.has(l.foodRef)) continue
    const g = groups.get(l.foodRef)
    if (g) g.push(l)
    else groups.set(l.foodRef, [l])
  }
  const out: Suggestion[] = []
  for (const [foodRef, g] of groups) {
    const newest = [...g].sort(newestFirst)[0]!
    out.push({ foodRef, name: newest.name, count: g.length, lastDate: newest.date, snapshot: newest })
  }
  out.sort((a, b) => b.count - a.count || newestFirst(a.snapshot, b.snapshot))
  return out.slice(0, cap)
}

export interface EarlierMeal {
  date: string
  items: FoodLog[]
  count: number
  kcal: number | undefined
  /** Some item has no energy value, so `kcal` is a lower bound. */
  kcalPartial: boolean
}

/** What was eaten in `meal` on the most recent day before `date` that has it (within `days`). */
export function lastMealBefore(logs: readonly FoodLog[], meal: MealKey, date: string, days = SUGGESTION_WINDOW_DAYS): EarlierMeal | null {
  const from = addDays(date, -days)
  let best: string | null = null
  for (const l of logs) if (l.meal === meal && l.date < date && l.date >= from && (best === null || l.date > best)) best = l.date
  if (best === null) return null
  const items = logs
    .filter((l) => l.meal === meal && l.date === best)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
  const { totals, partial } = sumNutrients(items)
  return { date: best, items, count: items.length, kcal: totals.kcal, kcalPartial: partial.includes('kcal') }
}

/**
 * The previous quantity of each food, as the log to copy: the newest log in `meal` if there is one,
 * otherwise the newest log anywhere. A food with no log has no entry: a quantity is never guessed.
 */
export function lastLogByFood(logs: readonly FoodLog[], meal: MealKey): Map<string, FoodLog> {
  const best = new Map<string, FoodLog>()
  for (const l of logs) {
    const cur = best.get(l.foodRef)
    if (!cur) {
      best.set(l.foodRef, l)
      continue
    }
    const curMeal = cur.meal === meal
    const nextMeal = l.meal === meal
    if (nextMeal !== curMeal ? nextMeal : newestFirst(l, cur) < 0) best.set(l.foodRef, l)
  }
  return best
}
