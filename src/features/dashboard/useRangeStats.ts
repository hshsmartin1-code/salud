import { useLiveQuery } from 'dexie-react-hooks'
import { useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { BodyMeasurement, FoodLog, Goal, ImportedDaily } from '../../db/types'
import { addDays, dateRange } from '../../domain/dates'
import { sumNutrients } from '../../domain/nutrients'
import { sessionVolume } from '../../domain/training'

export interface DayIntake {
  date: string
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  partial: boolean
  /** 'app' = logged foods; 'imported' = Phase 0 daily total only (no macros). */
  source: 'app' | 'imported'
  target: number | null
  proteinTarget: number | null
}

export function dailyIntake(logs: FoodLog[], imported: ImportedDaily[], goals: Goal[], from: string, to: string): DayIntake[] {
  const byDay = new Map<string, FoodLog[]>()
  for (const l of logs) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l])
  const imp = new Map(imported.filter((d) => d.metric === 'kcal_intake' && d.value !== null && !d.excludeFromStats).map((d) => [d.date, d.value as number]))
  const out: DayIntake[] = []
  for (const date of dateRange(from, to)) {
    const goal = pickGoalForDate(goals, date)
    const ls = byDay.get(date)
    if (ls && ls.length) {
      const { totals, partial } = sumNutrients(ls)
      out.push({ date, kcal: totals.kcal ?? null, protein: totals.protein ?? null, carbs: totals.carbs ?? null, fat: totals.fat ?? null, partial: partial.includes('kcal'), source: 'app', target: goal?.kcal ?? null, proteinTarget: goal?.protein ?? null })
    } else if (imp.has(date)) {
      out.push({ date, kcal: imp.get(date)!, protein: null, carbs: null, fat: null, partial: false, source: 'imported', target: goal?.kcal ?? null, proteinTarget: goal?.protein ?? null })
    }
  }
  return out
}

export function weightSeries(rows: BodyMeasurement[]): { date: string; value: number }[] {
  const byDay = new Map<string, BodyMeasurement>()
  for (const m of rows.filter((m) => m.weightKg !== null && !m.excludeFromStats && !m.approx).sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))) byDay.set(m.date, m)
  return [...byDay.values()].map((m) => ({ date: m.date, value: m.weightKg as number })).sort((a, b) => (a.date < b.date ? -1 : 1))
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export interface RangeStats {
  from: string
  to: string
  days: number
  intake: DayIntake[]
  kcalMean: number | null
  kcalDays: number
  importedDays: number
  proteinMean: number | null
  proteinDays: number
  onTargetDays: number
  targetDays: number
  sessions: number
  volume: number
  weightStart: { date: string; value: number } | null
  weightEnd: { date: string; value: number } | null
  sleepMean: number | null
  sleepDays: number
  stepsMean: number | null
  stepsDays: number
}

/** Aggregates for the last `days` days ending `to` (inclusive). Real stored data only. */
export function useRangeStats(days: number, to: string): RangeStats | undefined {
  const r = useRepo()
  return useLiveQuery(async () => {
    const from = addDays(to, -(days - 1))
    const [logs, imported, goals, sessions, sets, body, sleep, acts] = await Promise.all([
      r.range('foodLogs', from, to),
      r.range('importedDaily', from, to),
      r.all('goals'),
      r.range('trainingSessions', from, to),
      r.range('exerciseSets', from, to),
      r.range('bodyMeasurements', from, to),
      r.range('sleepLogs', from, to),
      r.range('activityLogs', from, to),
    ])
    const intake = dailyIntake(logs, imported, goals, from, to)
    const kcalDays = intake.filter((d) => d.kcal !== null)
    const protDays = intake.filter((d) => d.protein !== null)
    const targetDays = kcalDays.filter((d) => d.target !== null)
    const onTarget = targetDays.filter((d) => Math.abs((d.kcal as number) - (d.target as number)) <= (d.target as number) * 0.1)
    const ws = weightSeries(body)
    const sleepVals = sleep.filter((s) => !s.excludeFromStats && s.hours !== null).map((s) => s.hours as number)
    const stepsByDay = new Map<string, number>()
    for (const a of acts) if (!a.excludeFromStats && a.steps !== null) stepsByDay.set(a.date, (stepsByDay.get(a.date) ?? 0) + a.steps)
    return {
      from,
      to,
      days,
      intake,
      kcalMean: mean(kcalDays.map((d) => d.kcal as number)),
      kcalDays: kcalDays.length,
      importedDays: kcalDays.filter((d) => d.source === 'imported').length,
      proteinMean: mean(protDays.map((d) => d.protein as number)),
      proteinDays: protDays.length,
      onTargetDays: onTarget.length,
      targetDays: targetDays.length,
      sessions: sessions.filter((s) => s.status === 'done' && !s.excludeFromStats).length,
      volume: sessionVolume(sets.filter((s) => s.done)),
      weightStart: ws[0] ?? null,
      weightEnd: ws.length > 1 ? ws[ws.length - 1]! : null,
      sleepMean: mean(sleepVals),
      sleepDays: sleepVals.length,
      stepsMean: mean([...stepsByDay.values()]),
      stepsDays: stepsByDay.size,
    }
  }, [r, days, to])
}
