import type { TrackingType } from '../../../db/catalogTypes'
import type { TrainingSettings } from '../../../db/types'
import type { SetDraftField } from '../draft'
import { SET_FIELDS } from '../draft'

export type Effort = NonNullable<TrainingSettings['effort']>

/** Column header and input label of each field (the labels the e2e tests use: "kg", "Reps"…). */
export const FIELD_LABEL: Record<TrackingType, Partial<Record<SetDraftField, string>>> = {
  weight_reps: { weight: 'kg', reps: 'Reps' },
  bodyweight_reps: { weight: '+kg', reps: 'Reps' },
  time: { durationSec: 'Tiempo' },
  distance: { distanceM: 'km', durationSec: 'Tiempo' },
}
export const EFFORT_LABEL: Record<'rpe' | 'rir', string> = { rpe: 'RPE', rir: 'RIR' }

/** Inputs of a row: the tracking type's measure, plus the effort column when the profile shows one. */
export function rowFields(t: TrackingType, effort: Effort): SetDraftField[] {
  return effort === 'none' ? [...SET_FIELDS[t]] : [...SET_FIELDS[t], effort]
}

// Fixed (viewport-scaled) widths, not minmax(): grid grows minmax tracks to their maximum before the
// 1fr column gets anything, which starved "Anterior" at 360 px once the effort column was on.
const WIDTH: Partial<Record<SetDraftField, string>> = {
  weight: 'clamp(3.25rem,15vw,4.25rem)',
  reps: 'clamp(2.75rem,13vw,3.5rem)',
  durationSec: 'clamp(4.25rem,19vw,5.5rem)',
  distanceM: 'clamp(3.25rem,15vw,4.25rem)',
  rpe: 'clamp(2.5rem,11vw,2.75rem)',
  rir: 'clamp(2.5rem,11vw,2.75rem)',
}

/**
 * One grid template for the header and every row of a table, so the columns always line up:
 * type/number · Anterior (takes the rest) · inputs · done.
 */
export function gridTemplate(t: TrackingType, effort: Effort): string {
  const lead = effort === 'none' ? '2.5rem' : '2.25rem'
  return [lead, 'minmax(0,1fr)', ...rowFields(t, effort).map((f) => WIDTH[f] ?? '4rem'), '2.75rem'].join(' ')
}

export function inputModeFor(f: SetDraftField): 'decimal' | 'numeric' | 'text' {
  if (f === 'reps' || f === 'rir') return 'numeric'
  if (f === 'durationSec') return 'text' // "1:30" needs the colon
  return 'decimal'
}
