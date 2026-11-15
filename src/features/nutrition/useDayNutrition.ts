import { useLiveQuery } from 'dexie-react-hooks'
import { useProfile, useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { FoodLog, Goal, ImportedDaily } from '../../db/types'
import type { NutrientCode, NutrientMap } from '../../db/catalogTypes'
import { sumNutrients } from '../../domain/nutrients'

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
    const [logs, goals, acts, imported] = await Promise.all([
      r.onDate('foodLogs', date),
      r.all('goals'),
      r.onDate('activityLogs', date),
      r.onDate('importedDaily', date),
    ])
    logs.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
    const { totals, partial } = sumNutrients(logs)
    const goal = pickGoalForDate(goals, date)
    const kcalActs = acts.filter((a) => !a.excludeFromStats && a.activeKcal !== null).map((a) => a.activeKcal as number)
    const activityKcal = kcalActs.length ? kcalActs.reduce((a, b) => a + b, 0) : null
    const kcalBudget = goal ? goal.kcal + (profile.settings.addActivityKcal && activityKcal ? activityKcal : 0) : null
    return { logs, totals, partial, goal, activityKcal, kcalBudget, imported }
  }, [r, date, profile.settings.addActivityKcal])
}
