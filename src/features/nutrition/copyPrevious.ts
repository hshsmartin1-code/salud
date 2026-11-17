import type { FoodLog, MealKey } from '../../db/types'
import { resizeSnapshot } from '../../domain/foodSnapshot'
import { amountError } from './amountRange'
import { parseAmount } from './amountParse'
import { measureText } from './food'
import type { LogEntry } from './quickAdd'

/** "Copiar comida anterior": pure selection and quantity rules. Writing goes through `logSnapshots`. */

const inOrder = (a: FoodLog, b: FoodLog) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt)
const quantityFormat = new Intl.NumberFormat('es-CO', { useGrouping: false, maximumSignificantDigits: 21 })

/** Dates before `target` with entries in `slot`, newest first. */
export function datesWithSlot(logs: readonly FoodLog[], slot: MealKey, target: string): string[] {
  return [...new Set(logs.filter((l) => l.meal === slot && l.date < target).map((l) => l.date))].sort().reverse()
}

/** The foods of `slot` on `date`, in the order they were eaten. */
export function rowsOf(logs: readonly FoodLog[], slot: MealKey, date: string): FoodLog[] {
  return logs.filter((l) => l.meal === slot && l.date === date).sort(inOrder)
}

/** What the amount is counted in: "g", "ml", "L", "porción" or the name of the measure ("tajada"). */
export function unitText(row: Pick<FoodLog, 'unit' | 'qty' | 'portionLabel' | 'portionVerification' | 'portionEquivalentAmount' | 'grams' | 'ml' | 'source'>): string {
  switch (row.unit) {
    case 'portion':
      return measureText(row).name
    case 'serving':
      return 'porción'
    case 'l':
      return 'L'
    default:
      return row.unit
  }
}

export interface CopyDraft {
  checked: Record<string, boolean>
  qty: Record<string, string>
}

/** Everything ticked, each quantity as it was eaten. */
export function initialDraft(rows: readonly FoodLog[]): CopyDraft {
  return {
    checked: Object.fromEntries(rows.map((r) => [r.id, true])),
    qty: Object.fromEntries(rows.map((r) => [r.id, Number.isFinite(r.qty) ? quantityFormat.format(r.qty) : ''])),
  }
}

export interface CopyPlan {
  entries: LogEntry[]
  count: number
  /** Message per ticked row whose quantity cannot be used. */
  errors: Record<string, string>
  /** Energy of each ticked, valid row at its edited quantity (undefined = unknown, never 0). */
  kcal: Record<string, number | undefined>
  ok: boolean
}

/**
 * The entries to write for the ticked rows. An unchanged quantity copies the stored snapshot as it is; a changed one
 * goes through `resizeSnapshot` (the same function the editor uses on a stored log), so unknown nutrients stay unknown.
 */
export function planCopy(rows: readonly FoodLog[], draft: CopyDraft): CopyPlan {
  const entries: LogEntry[] = []
  const errors: Record<string, string> = {}
  const kcal: Record<string, number | undefined> = {}
  for (const row of rows) {
    if (!draft.checked[row.id]) continue
    const q = parseAmount(draft.qty[row.id] ?? '')
    if (q === null) {
      errors[row.id] = 'Cantidad no válida'
      continue
    }
    const range = amountError(q, row.unit)
    if (range) {
      errors[row.id] = range
      continue
    }
    if (q === row.qty) {
      entries.push({ snapshot: row, time: row.time ?? null, ...(row.note ? { note: row.note } : {}) })
      kcal[row.id] = row.nutrients.kcal
      continue
    }
    const resized = resizeSnapshot(row, q)
    if ('error' in resized) {
      errors[row.id] = resized.error
      continue
    }
    entries.push({
      snapshot: { ...resized, ...(row.approx !== undefined ? { approx: row.approx } : {}) },
      time: row.time ?? null,
      ...(row.note ? { note: row.note } : {}),
    })
    kcal[row.id] = resized.nutrients.kcal
  }
  const count = entries.length
  return { entries, count, errors, kcal, ok: count > 0 && Object.keys(errors).length === 0 }
}
