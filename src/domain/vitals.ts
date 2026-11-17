import type { VitalKind, VitalSign } from '../db/types'

/** Orientative classifications. Informational only: never a diagnosis. */
export type Tone = 'good' | 'warn' | 'bad' | 'muted'

export interface Classification {
  key: string
  label: string
  tone: Tone
  /** Extra sentence shown below the label. */
  note?: string
  /** Source named in the UI. */
  source: string
}

export const BP_SOURCE = 'ACC/AHA 2017'
export const GLUCOSE_SOURCE = 'ADA'
export const DISCLAIMER = 'No reemplaza una valoración médica.'

export type GlucoseContext = 'ayunas' | 'posprandial' | 'aleatoria'
export const GLUCOSE_CONTEXTS: readonly { value: GlucoseContext; label: string }[] = [
  { value: 'ayunas', label: 'En ayunas' },
  { value: 'posprandial', label: 'Posprandial' },
  { value: 'aleatoria', label: 'Aleatoria' },
]

export const VITAL_LABEL: Record<VitalKind, string> = {
  bloodPressure: 'Presión arterial',
  restingHr: 'Pulso en reposo',
  spo2: 'Saturación de oxígeno',
  glucose: 'Glucosa',
  temperature: 'Temperatura',
}
export const VITAL_UNIT: Record<VitalKind, string> = {
  bloodPressure: 'mmHg',
  restingHr: 'lpm',
  spo2: '%',
  glucose: 'mg/dL',
  temperature: '°C',
}
export const VITAL_KINDS: readonly VitalKind[] = ['bloodPressure', 'restingHr', 'spo2', 'glucose', 'temperature']

/** Plausible ranges to catch typos (not clinical limits). */
export const RANGES = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 30, max: 160 },
  restingHr: { min: 25, max: 230 },
  spo2: { min: 50, max: 100 },
  glucose: { min: 20, max: 600 },
  temperature: { min: 33, max: 43 },
} as const

/** Returns a Spanish error, or null when the blood pressure pair is plausible. */
export function validateBloodPressure(sys: number | null, dia: number | null): string | null {
  if (sys === null || dia === null) return 'Ingresa la presión sistólica y la diastólica.'
  const { systolic: s, diastolic: d } = RANGES
  if (sys < s.min || sys > s.max) return `La sistólica debe estar entre ${s.min} y ${s.max} mmHg.`
  if (dia < d.min || dia > d.max) return `La diastólica debe estar entre ${d.min} y ${d.max} mmHg.`
  if (sys <= dia) return 'La sistólica (la cifra mayor) debe ser mayor que la diastólica.'
  return null
}

export function validateSingle(kind: Exclude<VitalKind, 'bloodPressure'>, value: number | null): string | null {
  if (value === null) return 'Ingresa un valor numérico.'
  const r = RANGES[kind]
  const unit = VITAL_UNIT[kind]
  if (value < r.min || value > r.max) return `El valor debe estar entre ${r.min} y ${r.max} ${unit}.`
  return null
}

/** ACC/AHA 2017 adult categories. Crisis note for >180 and/or >120. */
export function bpCategory(sys: number, dia: number): Classification {
  const source = BP_SOURCE
  if (sys > 180 || dia > 120)
    return {
      key: 'crisis',
      label: 'Etapa 2 · valores muy altos',
      tone: 'bad',
      note: 'Consulta de inmediato si se confirma con una segunda toma o hay síntomas.',
      source,
    }
  if (sys >= 140 || dia >= 90) return { key: 'stage2', label: 'Hipertensión etapa 2', tone: 'bad', source }
  if (sys >= 130 || dia >= 80) return { key: 'stage1', label: 'Hipertensión etapa 1', tone: 'warn', source }
  if (sys >= 120) return { key: 'elevated', label: 'Elevada', tone: 'warn', source }
  return { key: 'normal', label: 'Normal', tone: 'good', source }
}

/** ADA fasting ranges. Only meaningful when context = ayunas; otherwise null. */
export function glucoseCategory(value: number, context: string | null | undefined): Classification | null {
  if (context !== 'ayunas') return null
  const source = `${GLUCOSE_SOURCE} (ayunas)`
  if (value >= 126) return { key: 'diabetes-range', label: 'Rango de diabetes (≥126)', tone: 'bad', source }
  if (value >= 100) return { key: 'prediabetes-range', label: 'Rango de prediabetes (100–125)', tone: 'warn', source }
  return { key: 'normal', label: 'Normal (<100)', tone: 'good', source }
}

export function spo2Note(value: number): Classification | null {
  if (value < 92)
    return { key: 'low', label: 'Saturación baja (<92 %)', tone: 'warn', note: 'Repite la medición en reposo; si persiste, consulta.', source: 'Referencia general' }
  return null
}

/** Classification for any stored vital (null when nothing orientative applies). */
export function classifyVital(v: Pick<VitalSign, 'kind' | 'systolic' | 'diastolic' | 'value' | 'context'>): Classification | null {
  if (v.kind === 'bloodPressure') {
    return v.systolic != null && v.diastolic != null ? bpCategory(v.systolic, v.diastolic) : null
  }
  if (v.value == null) return null
  if (v.kind === 'glucose') return glucoseCategory(v.value, v.context)
  if (v.kind === 'spo2') return spo2Note(v.value)
  return null
}

const stamp = (v: VitalSign) => `${v.date} ${v.time ?? '00:00'} ${v.createdAt ?? ''}`

/** Newest first (date, time, creation). */
export function sortVitalsDesc(vitals: readonly VitalSign[]): VitalSign[] {
  return vitals.slice().sort((a, b) => stamp(b).localeCompare(stamp(a)))
}

/** Latest reading for each kind present. */
export function latestByKind(vitals: readonly VitalSign[]): Partial<Record<VitalKind, VitalSign>> {
  const out: Partial<Record<VitalKind, VitalSign>> = {}
  for (const v of sortVitalsDesc(vitals)) if (!out[v.kind]) out[v.kind] = v
  return out
}

/** One number per day (mean of that day's readings; systolic for blood pressure); null = no reading. */
export function dailySeries(vitals: readonly VitalSign[], kind: VitalKind, dates: readonly string[]): (number | null)[] {
  const sums = new Map<string, { s: number; n: number }>()
  for (const v of vitals) {
    if (v.kind !== kind) continue
    const x = kind === 'bloodPressure' ? v.systolic : v.value
    if (x == null) continue
    const e = sums.get(v.date) ?? { s: 0, n: 0 }
    e.s += x
    e.n += 1
    sums.set(v.date, e)
  }
  return dates.map((d) => {
    const e = sums.get(d)
    return e ? e.s / e.n : null
  })
}
