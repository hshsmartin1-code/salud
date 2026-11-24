/**
 * Pure helpers of the live session screen: what the state strip counts, which exercise is open, how
 * the "Anterior" column and the exercise context line read. No React, no Dexie (unit-tested).
 */
import type { TrackingType } from '../../../db/catalogTypes'
import type { ExerciseSet, SessionExercise } from '../../../db/types'
import { formatDateEs } from '../../../domain/dates'
import { isWorkSet } from '../../../domain/setKind'
import { bestSet, E1RM_MAX_REPS, e1rm, sessionVolume } from '../../../domain/training'
import { formatNumber } from '../../../domain/units'
import { formatDuration } from '../sets'

export interface SessionStats {
  /** Completed work sets (warm-ups never count). */
  workDone: number
  /** All work-set rows, done or not. */
  workTotal: number
  /** kg · reps of completed work sets. */
  volume: number
  /** Rows not marked done: finishing discards them. */
  pending: number
}

export function sessionStats(sets: readonly ExerciseSet[]): SessionStats {
  let workDone = 0
  let workTotal = 0
  let pending = 0
  for (const s of sets) {
    if (!s.done) pending++
    if (!isWorkSet(s)) continue
    workTotal++
    if (s.done) workDone++
  }
  return { workDone, workTotal, volume: sessionVolume(sets.filter((s) => s.done)), pending }
}

/** Work sets done / total of one exercise ("2 / 3"). */
export function exerciseProgress(sets: readonly ExerciseSet[]): { done: number; total: number } {
  const work = sets.filter(isWorkSet)
  return { done: work.filter((s) => s.done).length, total: work.length }
}

/**
 * The exercise in progress: the first one (in session order) with a set still to do, or with no rows
 * yet (just added). null when everything is done.
 */
export function currentExerciseId(order: readonly Pick<SessionExercise, 'exerciseId'>[], setsByExercise: ReadonlyMap<string, readonly ExerciseSet[]>): string | null {
  for (const o of order) {
    const rows = setsByExercise.get(o.exerciseId) ?? []
    if (!rows.length || rows.some((s) => !s.done)) return o.exerciseId
  }
  return null
}

/** A manual toggle wins; otherwise only the exercise in progress is open. */
export function isExerciseOpen(exerciseId: string, current: string | null, manual: Readonly<Record<string, boolean>>): boolean {
  return manual[exerciseId] ?? exerciseId === current
}

/** Drops the manual toggles of these exercises (same object when there is nothing to drop). */
export function forgetToggles(manual: Readonly<Record<string, boolean>>, ids: readonly (string | null)[]): Record<string, boolean> {
  if (!ids.some((id) => id !== null && id in manual)) return manual as Record<string, boolean>
  const next = { ...manual }
  for (const id of ids) if (id !== null) delete next[id]
  return next
}

/** Number shown in the type cell: the ordinal among work sets (warm-ups show their letter instead). */
export function workOrdinals(sets: readonly ExerciseSet[]): number[] {
  let n = 0
  return sets.map((s) => (isWorkSet(s) ? ++n : 0))
}

const kg = (n: number) => formatNumber(n, 2)

/** "Anterior" column: "70 × 12", "+5 × 12", "12", "1:24", "2,5 · 14:30". Dash when absent. */
export function formatPrevious(s: Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'> | null | undefined, t: TrackingType): string {
  if (!s) return '—'
  switch (t) {
    case 'weight_reps':
      if (s.weight === null && s.reps === null) return '—'
      return `${s.weight !== null ? kg(s.weight) : '—'} × ${s.reps ?? '—'}`
    case 'bodyweight_reps':
      if (s.reps === null) return '—'
      return s.weight ? `+${kg(s.weight)} × ${s.reps}` : String(s.reps)
    case 'time':
      return s.durationSec !== null ? formatDuration(s.durationSec) : '—'
    case 'distance': {
      const d = s.distanceM !== null ? formatNumber(s.distanceM / 1000, 2) : null
      const tm = s.durationSec !== null ? formatDuration(s.durationSec) : null
      return [d, tm].filter(Boolean).join(' · ') || '—'
    }
  }
}

/** Spoken form of the previous value (for the copy button's label). */
export function spokenPrevious(s: Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'>, t: TrackingType): string {
  switch (t) {
    case 'weight_reps':
      return `${s.weight !== null ? kg(s.weight) : 'sin peso'} kilos por ${s.reps ?? 'sin'} repeticiones`
    case 'bodyweight_reps':
      return `${s.reps ?? 'sin'} repeticiones${s.weight ? ` con ${kg(s.weight)} kilos extra` : ''}`
    case 'time':
      return formatDuration(s.durationSec)
    case 'distance':
      return formatPrevious(s, t)
  }
}

/** "3 × 8–10" from the routine targets; "3 series" without reps; null without targets. */
export function targetLabel(item: Pick<SessionExercise, 'targetSets' | 'targetReps'>): string | null {
  const reps = item.targetReps?.trim().replace(/(\d)\s*-\s*(\d)/g, '$1–$2')
  if (typeof item.targetSets === 'number' && item.targetSets > 0) return reps ? `${item.targetSets} × ${reps}` : `${item.targetSets} ${item.targetSets === 1 ? 'serie' : 'series'}`
  return reps ? `Objetivo ${reps}` : null
}

/** "12 nov" (the weekday is dropped). */
export function shortDate(date: string): string {
  return formatDateEs(date, 'weekday').replace(/^\S+\s/, '')
}

/** "Última vez 12 nov · mejor 85 kg × 9" from the comparable previous session; null without one. */
export function lastTimeLine(prev: readonly ExerciseSet[] | undefined, t: TrackingType): string | null {
  if (!prev || !prev.length) return null
  const best = bestSet([...prev])
  const date = prev[0]!.date
  const bestText = best ? (t === 'weight_reps' && best.weight != null && best.reps != null ? `${kg(best.weight)} kg × ${best.reps}` : formatPrevious(best as ExerciseSet, t)) : null
  return `Última vez ${shortDate(date)}${bestText && bestText !== '—' ? ` · mejor ${bestText}` : ''}`
}

/** Stable signature of what a set row renders (memo comparator; live queries give new objects). */
export function setSignature(s: ExerciseSet | null | undefined): string {
  if (!s) return ''
  return `${s.id}|${s.setIndex}|${s.weight}|${s.reps}|${s.durationSec}|${s.distanceM}|${s.rpe}|${s.rir ?? ''}|${s.done ? 1 : 0}|${s.isWarmup ? 1 : 0}|${s.kind ?? ''}|${s.notes ?? ''}`
}

/** Rest presets offered next to the stepper (seconds). */
export const REST_PRESETS = [60, 90, 120, 180, 240] as const

/** Best estimated 1RM among the done work sets of one exercise; only 1 to 12 reps give an estimate (null: none). */
export function sessionE1rm(sets: readonly ExerciseSet[]): number | null {
  let best: number | null = null
  for (const s of sets) {
    if (!s.done || !isWorkSet(s) || s.weight === null || s.reps === null || s.reps > E1RM_MAX_REPS) continue
    const v = e1rm(s.weight, s.reps)
    if (v !== null && (best === null || v > best)) best = v
  }
  return best
}
