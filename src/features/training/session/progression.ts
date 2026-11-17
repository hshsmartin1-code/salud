/**
 * Deterministic load progression ("doble progresión"), shown as a hint, never applied on its own.
 *
 * Rule (all must hold, otherwise no hint):
 * - The exercise is tracked as weight × reps (bodyweight, time and distance exercises are excluded).
 * - The routine target is a strict rep RANGE "a-b" (also "a–b"), integers, 0 < a < b ≤ 100. A single
 *   number ("8"), text or no target gives no hint.
 * - The comparable previous session has at least one completed WORK set of the exercise (warm-ups are
 *   ignored), every one of them reached the top of the range (reps ≥ b), and all were done with the
 *   same weight (> 0). Mixed weights or any set below the top give no hint.
 * - Step: 2 kg for dumbbells and kettlebells (catalog equipment "dumbbell" / "kettlebells"),
 *   2,5 kg for everything else (barbell, machine, cable, unknown).
 * Suggested weight = that weight + step.
 */
import type { TrackingType } from '../../../db/catalogTypes'
import type { ExerciseSet } from '../../../db/types'
import { isWorkSet } from '../../../domain/setKind'
import { formatNumber } from '../../../domain/units'

export interface ProgressionHint {
  /** Completed work sets last time. */
  sets: number
  /** The fewest reps among them (≥ the top of the range). */
  reps: number
  /** Weight used last time (kg). */
  weight: number
  step: number
  suggested: number
}

/** "8-12" → [8, 12]; anything else (single number, text, reversed, seconds) → null. */
export function parseRepRange(target: string | undefined | null): [number, number] | null {
  const m = /^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/.exec(target ?? '')
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  return a > 0 && a < b && b <= 100 ? [a, b] : null
}

export function progressionStep(equipment: string | null | undefined): number {
  return equipment === 'dumbbell' || equipment === 'kettlebells' ? 2 : 2.5
}

export function progressionHint(o: { tracking: TrackingType; targetReps: string | undefined; equipment: string | null | undefined; previous: readonly ExerciseSet[] | undefined }): ProgressionHint | null {
  if (o.tracking !== 'weight_reps') return null
  const range = parseRepRange(o.targetReps)
  if (!range) return null
  const work = (o.previous ?? []).filter((s) => s.done && isWorkSet(s))
  if (!work.length) return null
  const weight = work[0]!.weight
  if (weight == null || weight <= 0) return null
  if (work.some((s) => s.weight !== weight || s.reps == null || s.reps < range[1])) return null
  const step = progressionStep(o.equipment)
  return { sets: work.length, reps: Math.min(...work.map((s) => s.reps!)), weight, step, suggested: Math.round((weight + step) * 100) / 100 }
}

export function progressionText(h: ProgressionHint): string {
  return `La vez anterior completaste ${h.sets} × ${h.reps}: prueba +${formatNumber(h.step, 2)} kg`
}
