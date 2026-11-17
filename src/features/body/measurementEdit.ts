import type { Repo } from '../../db/repo'
import type { BodyMeasurement, Profile } from '../../db/types'
import { computeBodyComp } from '../../domain/bodycomp'
import { ageFromBirthDate } from '../../domain/energy'
import { parseDecimal } from '../../domain/units'
import { numStr } from '../../ui/fields'

type TextMap<K extends string> = Partial<Record<K, string>>
export interface MeasurementDraft {
  date: string
  time: string
  weight: string
  circ: TextMap<keyof BodyMeasurement['circumferences']>
  sf: TextMap<keyof BodyMeasurement['skinfolds']>
  protocol: NonNullable<BodyMeasurement['protocol']> | ''
  notes: string
}
export interface MeasurementEdit {
  loaded: boolean
  baseline: BodyMeasurement | null
  draft: MeasurementDraft
}
type BodyProfile = Pick<Profile, 'sex' | 'birthDate' | 'heightCm'>

export function measurementDraft(row: BodyMeasurement): MeasurementDraft {
  const texts = <K extends string>(values: Partial<Record<K, number>>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, numStr(v as number, 1)])) as TextMap<K>
  return {
    date: row.date, time: row.time ?? '', weight: numStr(row.weightKg, 2),
    circ: texts(row.circumferences), sf: texts(row.skinfolds), protocol: row.protocol ?? '', notes: row.notes ?? '',
  }
}

export function reloadMeasurement(row: BodyMeasurement): MeasurementEdit {
  return { loaded: true, baseline: row, draft: measurementDraft(row) }
}

export function receiveMeasurement(state: MeasurementEdit, row: BodyMeasurement): MeasurementEdit {
  return state.loaded ? state : reloadMeasurement(row)
}

function mapChanged(a: TextMap<string>, b: TextMap<string>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((key) => (a[key] ?? '') !== (b[key] ?? ''))
}

export function measurementDirty(initial: MeasurementDraft, edited: MeasurementDraft): boolean {
  return (['date', 'time', 'weight', 'protocol', 'notes'] as const).some((key) => initial[key] !== edited[key]) ||
    mapChanged(initial.circ, edited.circ) || mapChanged(initial.sf, edited.sf)
}

export function measurementValues(draft: MeasurementDraft) {
  const numbers = <K extends string>(values: TextMap<K>) => Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      const n = parseDecimal(value as string)
      return n !== null && n > 0 ? [[key, n]] : []
    }),
  ) as Partial<Record<K, number>>
  const skinfolds = numbers(draft.sf)
  return {
    date: draft.date, time: draft.time || null, weightKg: parseDecimal(draft.weight),
    circumferences: numbers(draft.circ), skinfolds,
    protocol: Object.keys(skinfolds).length ? (draft.protocol || null) : null,
    notes: draft.notes.trim() || undefined,
  }
}

export function measurementDerived(
  row: Pick<BodyMeasurement, 'date' | 'weightKg' | 'skinfolds' | 'protocol'>, profile: BodyProfile, computedAt: string,
): BodyMeasurement['derived'] {
  const age = profile.birthDate ? ageFromBirthDate(profile.birthDate, row.date) : null
  if (!row.protocol || !Object.keys(row.skinfolds).length || age === null) return null
  const result = computeBodyComp({
    protocol: row.protocol, sex: profile.sex, ageYears: age, skinfolds: row.skinfolds,
    weightKg: row.weightKg, heightCm: profile.heightCm,
  })
  if (result.sum === null) return null
  return {
    estimated: true, protocol: row.protocol, equation: result.equation, method: result.method, sum: result.sum,
    ...(result.density !== undefined ? { density: result.density } : {}),
    ...(result.bodyFatPct !== undefined ? { bodyFatPct: result.bodyFatPct } : {}),
    ...(result.fatMassKg !== undefined ? { fatMassKg: result.fatMassKg } : {}),
    ...(result.leanMassKg !== undefined ? { leanMassKg: result.leanMassKg } : {}),
    inputs: { sex: profile.sex, ageYears: age, weightKg: row.weightKg, heightCm: profile.heightCm }, computedAt,
  }
}

export function mergeMeasurement(
  current: BodyMeasurement, initial: MeasurementDraft, edited: MeasurementDraft, profile: BodyProfile, computedAt: string,
): BodyMeasurement {
  const values = measurementValues(edited)
  const next = { ...current }
  if (initial.date !== edited.date) next.date = values.date
  if (initial.time !== edited.time) next.time = values.time
  if (initial.weight !== edited.weight) next.weightKg = values.weightKg
  if (initial.notes !== edited.notes) next.notes = values.notes
  if (initial.protocol !== edited.protocol) next.protocol = edited.protocol || null
  const mergeSites = <K extends string>(stored: Partial<Record<K, number>>, before: TextMap<K>, after: TextMap<K>) => {
    const merged = { ...stored }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<K>) {
      if ((before[key] ?? '') === (after[key] ?? '')) continue
      const n = parseDecimal(after[key] ?? '')
      if (n === null) delete merged[key]
      else merged[key] = n
    }
    return merged
  }
  next.circumferences = mergeSites(current.circumferences, initial.circ, edited.circ)
  next.skinfolds = mergeSites(current.skinfolds, initial.sf, edited.sf)
  const skinfoldChanged = mapChanged(initial.sf, edited.sf)
  if ((skinfoldChanged || initial.protocol !== edited.protocol) && !Object.keys(next.skinfolds).length) next.protocol = null
  if (initial.date !== edited.date || initial.weight !== edited.weight || initial.protocol !== edited.protocol || skinfoldChanged) {
    next.derived = measurementDerived(next, profile, computedAt)
  }
  return next
}

export async function saveMeasurementEdit(r: Repo, id: string, initial: MeasurementDraft, edited: MeasurementDraft, profile: BodyProfile) {
  return r.db.transaction('rw', r.db.bodyMeasurements, async () => {
    const current = await r.get('bodyMeasurements', id)
    if (!current) throw new Error('La medición ya no existe en este perfil')
    return r.put('bodyMeasurements', mergeMeasurement(current, initial, edited, profile, new Date().toISOString()))
  })
}
