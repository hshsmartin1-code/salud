import type { ActivityLog, HealthRecord } from '../../db/types'
import { activeKcalByDay } from '../dashboard/controlCenter'

/**
 * The ONE place that decides the day's energy target. Hoy and Comida both use it, so the figure and
 * "te quedan" can never disagree.
 *
 * - Without a goal there is no target (null).
 * - With `addActivityKcal` off the target is the goal's kcal; activity is informational.
 * - With it on, the day's active kcal (the same de-duplicated manual + Health Connect series the rest of
 *   the app uses) are added. Missing, zero or negative activity adds nothing.
 */
export interface CalorieTarget {
  /** kcal available for food today, or null with no goal. */
  target: number | null
  /** kcal of activity actually added to the goal (0 when off or without data). */
  added: number
}

export function calorieTarget(goalKcal: number | null | undefined, addActivityKcal: boolean, activityKcal: number | null | undefined): CalorieTarget {
  if (goalKcal === null || goalKcal === undefined) return { target: null, added: 0 }
  const added = addActivityKcal && activityKcal !== null && activityKcal !== undefined && activityKcal > 0 ? activityKcal : 0
  return { target: goalKcal + added, added }
}

/** Active kcal of one day from manual logs and Health Connect, de-duplicated (null = no data that day). */
export function dayActivityKcal(acts: ActivityLog[], health: HealthRecord[], date: string): number | null {
  return activeKcalByDay(acts, health, [date])[0]?.value ?? null
}
