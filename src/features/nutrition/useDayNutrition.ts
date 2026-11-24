import { useLiveQuery } from 'dexie-react-hooks'
import { useProfile, useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { FoodLog, Goal, ImportedDaily } from '../../db/types'
import type { NutrientCode, NutrientMap } from '../../db/catalogTypes'
import { sumNutrients } from '../../domain/nutrients'
import { calorieTarget, dayActivityKcal } from './calorieTarget'

export interface DayNutrition {
  logs: FoodLog[]
  totals: NutrientMap
  partial: NutrientCode[]
  goal: Goal | null
  activityKcal: number | null
  /** kcal target, plus logged activity kcal only when the profile enabled it. */
  kcalBudget: number | null
  imported: ImportedDaily[]
}

export function useDayNutrition(date: string): DayNutrition | undefined {
  const r = useRepo()
  const profile = useProfile()
  return useLiveQuery(async () => {
    const [logs, goals, acts, health, imported] = await Promise.all([
      r.onDate('foodLogs', date),
      r.all('goals'),
      r.onDate('activityLogs', date),
      r.onDate('healthRecords', date),
      r.onDate('importedDaily', date),
    ])
    logs.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
    const { totals, partial } = sumNutrients(logs)
    const goal = pickGoalForDate(goals, date)
    // Same activity series and same rule as Hoy (see calorieTarget.ts).
    const activityKcal = dayActivityKcal(acts, health, date)
    const kcalBudget = calorieTarget(goal?.kcal, profile.settings.addActivityKcal, activityKcal).target
    return { logs, totals, partial, goal, activityKcal, kcalBudget, imported }
  }, [r, date, profile.settings.addActivityKcal])
}
