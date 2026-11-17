import type { Repo } from '../../db/repo'
import type { MealKey } from '../../db/types'
import { isCalendarDate } from '../../domain/dates'
import { logSnapshots, type LoggedBatch } from './quickAdd'

/**
 * Copy frozen snapshots, never recalculate an old meal from today's catalog or custom portions.
 * One transaction: the rows and `recents` change together. Returns the batch so the caller can offer "Deshacer".
 */
export async function copyMeal(r: Repo, from: string, to: string, sourceMeal: MealKey, targetMeal = sourceMeal): Promise<LoggedBatch> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error('Elige una fecha válida.')
  if (from === to && sourceMeal === targetMeal) throw new Error('Elige otra fecha o comida para evitar duplicarla sobre sí misma.')
  const rows = (await r.onDate('foodLogs', from))
    .filter((row) => row.meal === sourceMeal)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
  return logSnapshots(r, rows.map((row) => ({ snapshot: row, time: row.time ?? null, note: row.note })), to, targetMeal)
}

/** Same as `copyMeal`, returning only how many rows were created. */
export async function repeatMeal(r: Repo, from: string, to: string, sourceMeal: MealKey, targetMeal = sourceMeal): Promise<number> {
  return (await copyMeal(r, from, to, sourceMeal, targetMeal)).ids.length
}
