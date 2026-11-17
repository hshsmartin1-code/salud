import { dateRange } from '../../domain/dates'
import type { HealthMetric, HealthRecord } from '../../db/types'

export interface DailyHealth {
  date: string
  steps: number | null
  /** Active kcal only (never total expenditure; never includes exercise-session kcal). */
  activeKcal: number | null
  distanceM: number | null
  restingHr: number | null
  /** Sum of the sleep sessions that ended on this date. */
  sleepMinutes: number | null
  /** Last weigh-in of the day. */
  weightKg: number | null
}

const DAILY: Partial<Record<HealthMetric, keyof DailyHealth>> = {
  steps: 'steps',
  activeKcal: 'activeKcal',
  distanceM: 'distanceM',
  restingHr: 'restingHr',
}

/** Per-date imported values for [from, to], skipping rows the person excluded. One entry per date. */
export function dailyHealthSummary(rows: readonly HealthRecord[], from: string, to: string): DailyHealth[] {
  const days = new Map<string, DailyHealth>()
  for (const d of dateRange(from, to)) {
    days.set(d, { date: d, steps: null, activeKcal: null, distanceM: null, restingHr: null, sleepMinutes: null, weightKg: null })
  }
  const weightAt = new Map<string, string>()
  for (const row of rows) {
    if (row.excluded || row.value === null || row.value === undefined) continue
    const day = days.get(row.date)
    if (!day) continue
    const key = DAILY[row.metric]
    if (key && row.kind === 'daily') (day[key] as number | null) = row.value
    else if (row.metric === 'sleep') day.sleepMinutes = (day.sleepMinutes ?? 0) + row.value
    else if (row.metric === 'weight') {
      const at = row.start ?? row.importedAt
      if (!weightAt.has(row.date) || at >= (weightAt.get(row.date) as string)) {
        weightAt.set(row.date, at)
        day.weightKg = row.value
      }
    }
  }
  return [...days.values()]
}

/** Most recent non-excluded imported weight (any date). */
export function latestHealthWeight(rows: readonly HealthRecord[]): { date: string; kg: number } | null {
  let best: HealthRecord | null = null
  for (const row of rows) {
    if (row.excluded || row.metric !== 'weight' || row.value === null) continue
    if (!best || `${row.date}${row.start ?? ''}` >= `${best.date}${best.start ?? ''}`) best = row
  }
  return best && best.value !== null ? { date: best.date, kg: best.value } : null
}
