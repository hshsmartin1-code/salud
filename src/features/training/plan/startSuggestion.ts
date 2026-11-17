/**
 * What a "start" button should offer today (pure, no React, no I/O). Hoy, the Entreno dock and the "+" sheet all
 * read this one function, so they never disagree.
 *
 *  - `planned`: today is a training day of the plan and no counted session is finished today. The offer is the
 *    plan's routine; a days-only day (no routine, or a routine that was deleted or archived) offers the habitual one.
 *  - `habitual`: anything else (no plan, rest day, already done, nothing left this week): today's behaviour,
 *    the most recently used routine. `hasPlan` tells the caller whether a plan exists at all.
 */
import type { ID, Routine, TrainingPlan } from '../../../db/types'
import { habitualRoutine } from '../routines'
import { dayStatus, hasPlan, planFor, resolveRoutine, type DoneDates } from './plan'

type RoutineLike = Pick<Routine, 'id' | 'name' | 'order' | 'archived'>

export interface StartSuggestion<T extends RoutineLike = Routine> {
  kind: 'planned' | 'habitual'
  /** planned: the plan's routine (null for a days-only day); habitual: the habitual routine (null when there are none). */
  routine: T | null
  /** The habitual routine, always: what a days-only planned day falls back to. */
  habitual: T | null
  /** A plan exists (whatever today says). */
  hasPlan: boolean
}

export function startSuggestion<T extends RoutineLike>(input: {
  plan: TrainingPlan | null | undefined
  today: string
  done: DoneDates
  routines: readonly T[]
  lastUsed: ReadonlyMap<ID, string>
}): StartSuggestion<T> {
  const { plan, today, done, routines, lastUsed } = input
  const habitual = habitualRoutine(routines, lastUsed)
  const has = hasPlan(plan)
  if (has && dayStatus(plan, today, done) === 'planned') return { kind: 'planned', routine: resolveRoutine(planFor(plan, today), routines), habitual, hasPlan: true }
  return { kind: 'habitual', routine: habitual, habitual, hasPlan: has }
}

/** The routine a start button runs: the plan's, else the habitual one; null = a free session. */
export const offeredRoutine = <T extends RoutineLike>(s: StartSuggestion<T>): T | null => s.routine ?? s.habitual
