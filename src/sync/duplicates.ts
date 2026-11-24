import { stableStringify } from './codec'

/**
 * Probable duplicates between this device and the account before "Unir" (merge by id).
 *
 * The merge joins rows by id, so the same real-world record entered separately on two devices (two
 * different ids) would end up twice on both sides, e.g. a meal counted twice in the day's calories.
 * This module only DETECTS such pairs; it never changes data. Matching is one-to-one and strict:
 *   - food logs: same date, meal, food, grams (and ml; quantity and unit when neither is known);
 *   - body weight: same date and weight (and the same circumferences and skinfolds, usually none);
 *   - training sessions: start times at most 2 minutes apart;
 *   - water: same date, time and amount.
 * Rows that already share an id are the same row, not duplicates.
 */

export const DUPLICATE_TABLES = ['foodLogs', 'bodyMeasurements', 'trainingSessions', 'hydrationLogs'] as const
export type DuplicateTable = (typeof DUPLICATE_TABLES)[number]

/**
 * Tables whose duplicates "Omitir duplicados probables" can leave out of the merge: standalone records.
 * A training session carries its sets (other rows that point to it), so a session pair is only reported.
 */
export const SKIPPABLE_DUPLICATE_TABLES: ReadonlySet<string> = new Set<DuplicateTable>(['foodLogs', 'bodyMeasurements', 'hydrationLogs'])

export const SESSION_START_TOLERANCE_MS = 2 * 60_000

type Row = Record<string, unknown> & { id: string }

export interface DuplicateMatch {
  localId: string
  remoteId: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Matching key of a row, or null when the row cannot be matched safely. */
export function duplicateKey(table: DuplicateTable, r: Row): string | null {
  switch (table) {
    case 'foodLogs': {
      const date = str(r.date)
      const meal = str(r.meal)
      const food = str(r.foodRef)
      if (!date || !meal || !food) return null
      const grams = num(r.grams)
      const ml = num(r.ml)
      const amount = grams === null && ml === null ? [num(r.qty), str(r.unit)] : null
      if (amount && amount[0] === null) return null
      return JSON.stringify([date, meal, food, grams, ml, amount])
    }
    case 'bodyMeasurements': {
      const date = str(r.date)
      const kg = num(r.weightKg)
      if (!date || kg === null) return null
      return JSON.stringify([date, round2(kg), stableStringify(r.circumferences ?? {}), stableStringify(r.skinfolds ?? {})])
    }
    case 'hydrationLogs': {
      const date = str(r.date)
      const ml = num(r.ml)
      if (!date || ml === null) return null
      return JSON.stringify([date, str(r.time), ml])
    }
    case 'trainingSessions':
      return null // matched by start time, see below
  }
}

const startMs = (r: Row): number | null => {
  const s = str(r.startedAt)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/** One-to-one pairs of probable duplicates between local rows and cloud rows of one table. */
export function findProbableDuplicates(table: DuplicateTable, local: readonly Row[], remote: readonly Row[]): DuplicateMatch[] {
  const remoteIds = new Set(remote.map((r) => r.id))
  const localIds = new Set(local.map((r) => r.id))
  const mine = local.filter((r) => !remoteIds.has(r.id))
  const theirs = remote.filter((r) => !localIds.has(r.id))
  const out: DuplicateMatch[] = []

  if (table === 'trainingSessions') {
    // Closest start first, so a session is never paired with a farther one while its twin is free.
    const cands: { l: Row; r: Row; gap: number }[] = []
    for (const l of mine) {
      const lt = startMs(l)
      if (lt === null) continue
      for (const r of theirs) {
        const rt = startMs(r)
        if (rt !== null && Math.abs(lt - rt) <= SESSION_START_TOLERANCE_MS) cands.push({ l, r, gap: Math.abs(lt - rt) })
      }
    }
    cands.sort((a, b) => a.gap - b.gap || a.l.id.localeCompare(b.l.id) || a.r.id.localeCompare(b.r.id))
    const usedL = new Set<string>()
    const usedR = new Set<string>()
    for (const c of cands) {
      if (usedL.has(c.l.id) || usedR.has(c.r.id)) continue
      usedL.add(c.l.id)
      usedR.add(c.r.id)
      out.push({ localId: c.l.id, remoteId: c.r.id })
    }
    return out
  }

  const byKey = new Map<string, string[]>()
  for (const r of [...theirs].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = duplicateKey(table, r)
    if (k === null) continue
    const q = byKey.get(k)
    if (q) q.push(r.id)
    else byKey.set(k, [r.id])
  }
  for (const l of [...mine].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = duplicateKey(table, l)
    const remoteId = k === null ? undefined : byKey.get(k)?.shift()
    if (remoteId !== undefined) out.push({ localId: l.id, remoteId })
  }
  return out
}
