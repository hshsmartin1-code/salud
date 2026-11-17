import type { FoodLog, MealKey } from '../../db/types'
import { addDays } from '../../domain/dates'
import { newestFirst } from './suggestions'

/** A habit counts when the food was logged in that slot on at least this many distinct days of the window. */
export const HABIT_MIN_DAYS = 3
export const HABIT_WINDOW_DAYS = 30
export const HABIT_CAP = 2

export interface SlotHabit {
  foodRef: string
  name: string
  /** Distinct days this food was logged in the slot inside the window. */
  days: number
  lastDate: string
  /** The newest log of this food in the slot: what a one-tap add copies (the amount last used there). */
  snapshot: FoodLog
}

/**
 * The few foods the person usually has in `slot`, for the line under the slot of the hour on today's diary.
 * Only foods logged in that same slot on at least 3 distinct days of the 30 days before `today`, not yet logged
 * today in that slot; most days first, then most recent; at most 2. Other days, other slots and an empty
 * history give nothing, and nothing ever comes from the catalog.
 */
export function habitsForSlot(logs: readonly FoodLog[], o: { slot: MealKey; today: string; viewed: string }): SlotHabit[] {
  if (o.viewed !== o.today) return []
  const from = addDays(o.today, -HABIT_WINDOW_DAYS)
  const to = addDays(o.today, -1)
  const loggedToday = new Set(logs.filter((l) => l.meal === o.slot && l.date === o.today).map((l) => l.foodRef))
  const groups = new Map<string, FoodLog[]>()
  for (const l of logs) {
    if (l.meal !== o.slot || l.date < from || l.date > to || loggedToday.has(l.foodRef)) continue
    const g = groups.get(l.foodRef)
    if (g) g.push(l)
    else groups.set(l.foodRef, [l])
  }
  const out: SlotHabit[] = []
  for (const [foodRef, g] of groups) {
    const days = new Set(g.map((l) => l.date)).size
    if (days < HABIT_MIN_DAYS) continue
    const newest = [...g].sort(newestFirst)[0]!
    out.push({ foodRef, name: newest.name, days, lastDate: newest.date, snapshot: newest })
  }
  out.sort((a, b) => b.days - a.days || newestFirst(a.snapshot, b.snapshot))
  return out.slice(0, HABIT_CAP)
}
