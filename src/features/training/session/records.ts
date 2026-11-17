/**
 * How a record reads in the session ("Peso máximo: 76 kg"). Which sets are records is decided by the
 * shared logic (domain/training detectPRs through sets.ts prsBySet), never here.
 */
import type { TrackingType } from '../../../db/catalogTypes'
import type { ExerciseSet } from '../../../db/types'
import { e1rm, type PRType } from '../../../domain/training'
import { formatNumber } from '../../../domain/units'
import { formatSet, PR_LABEL } from '../sets'

export interface RecordLine {
  key: string
  exercise: string
  text: string
}

/** Separator between several records of one set (decimal commas make "," ambiguous). */
export const RECORD_SEPARATOR = '; '

type Values = Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'>

export function recordText(t: PRType, s: Values, tracking: TrackingType): string {
  switch (t) {
    case 'max_weight':
      return s.weight != null ? `${PR_LABEL[t]}: ${formatNumber(s.weight, 2)} kg` : PR_LABEL[t]
    case 'max_e1rm': {
      const v = s.weight != null && s.reps != null ? e1rm(s.weight, s.reps) : null
      return v != null ? `${PR_LABEL[t]}: ${formatNumber(v, 1)} kg` : PR_LABEL[t]
    }
    default:
      return `${PR_LABEL[t]}: ${formatSet(s, tracking)}`
  }
}

/** Every record of one set, most important first (the order detectPRs returns). */
export function recordTexts(types: readonly PRType[], s: Values, tracking: TrackingType): string {
  return types.map((t) => recordText(t, s, tracking)).join(RECORD_SEPARATOR)
}
