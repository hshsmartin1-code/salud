import type { VitalKind, VitalSign } from '../db/types'
import { addDays } from './dates'

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

/** ACC/AHA 2017 adult categories; the 2025 AHA/ACC guideline kept them and renamed > 180/> 120 "severe hypertension". */
export const BP_SOURCE = 'ACC/AHA 2017 (categorías vigentes en la guía AHA/ACC 2025)'
export const BP_HOME_SOURCE = 'ACC/AHA 2017, valores domiciliarios equivalentes; ESH 2023'
export const SPO2_SOURCE = 'Orientativo; MinSalud (oximetría de pulso) y Rojas-Camayo y cols. 2018'
/** One reading cannot classify blood pressure: ACC/AHA ask for ≥ 2 readings on ≥ 2 occasions; ESH 2023 a home series. */
export const BP_SINGLE_NOTE =
  'Una sola lectura no basta para clasificar la presión arterial: se necesita el promedio de varias tomas en días distintos. En casa, la ESH 2023 recomienda 7 días (mínimo 3) con 2 tomas por la mañana y 2 por la noche.'
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

/**
 * ACC/AHA 2017 adult category of ONE reading, always labelled «lectura aislada» (a single reading is not a
 * classification, see BP_SINGLE_NOTE). > 180 and/or > 120: «hipertensión severa» range (AHA/ACC 2025 name).
 */
export function bpCategory(sys: number, dia: number): Classification {
  const source = BP_SOURCE
  if (sys > 180 || dia > 120)
    return {
      key: 'severe',
      label: 'Rango de hipertensión severa (lectura aislada)',
      tone: 'bad',
      note: `Repite la toma tras 5 minutos de reposo. Si sigue por encima de 180/120 o hay síntomas (dolor en el pecho, falta de aire, cambios en la visión o el habla, debilidad), busca atención médica de inmediato. ${BP_SINGLE_NOTE}`,
      source,
    }
  const note = BP_SINGLE_NOTE
  if (sys >= 140 || dia >= 90) return { key: 'stage2', label: 'Rango etapa 2 (lectura aislada)', tone: 'bad', note, source }
  if (sys >= 130 || dia >= 80) return { key: 'stage1', label: 'Rango etapa 1 (lectura aislada)', tone: 'warn', note, source }
  if (sys >= 120) return { key: 'elevated', label: 'Elevada (lectura aislada)', tone: 'warn', note, source }
  return { key: 'normal', label: 'Normal (lectura aislada)', tone: 'good', note, source }
}

/**
 * Category of a HOME average with the ACC/AHA 2017 home-monitoring equivalents (Table 11: office 130/80 ↔
 * home 130/80; office 140/90 ↔ home 135/85), so a home mean ≥ 135/85 is the stage 2 range (ESH 2023: home
 * hypertension ≥ 135/85). Orientative; a professional confirms it.
 */
export function bpAverageCategory(sys: number, dia: number): Classification {
  const source = BP_HOME_SOURCE
  if (sys > 180 || dia > 120) return { key: 'severe', label: 'Promedio en rango de hipertensión severa', tone: 'bad', source }
  if (sys >= 135 || dia >= 85) return { key: 'stage2', label: 'Promedio en rango etapa 2 (≥ 135/85 en casa)', tone: 'bad', source }
  if (sys >= 130 || dia >= 80) return { key: 'stage1', label: 'Promedio en rango etapa 1', tone: 'warn', source }
  if (sys >= 120) return { key: 'elevated', label: 'Promedio en rango elevado', tone: 'warn', source }
  return { key: 'normal', label: 'Promedio en rango normal', tone: 'good', source }
}

export interface BpAverage {
  systolic: number
  diastolic: number
  /** Readings averaged. */
  readings: number
  /** Distinct days with readings. */
  days: number
  from: string
  to: string
  classification: Classification
}

/**
 * Mean of every blood-pressure reading of the last `days` days ending `to` (inclusive). Needs readings on at
 * least `minDays` distinct days (ESH 2023: at least 3, ideally 7); null otherwise. Simplification: the ESH
 * protocol also discards the first day; this mean keeps every reading.
 */
export function bpAverage(vitals: readonly VitalSign[], to: string, days = 7, minDays = 3): BpAverage | null {
  const from = addDays(to, -(days - 1))
  const rows = vitals.filter((v) => v.kind === 'bloodPressure' && v.systolic != null && v.diastolic != null && v.date >= from && v.date <= to && !v.excludeFromStats)
  const distinct = new Set(rows.map((v) => v.date)).size
  if (distinct < minDays) return null
  const sys = rows.reduce((a, v) => a + (v.systolic as number), 0) / rows.length
  const dia = rows.reduce((a, v) => a + (v.diastolic as number), 0) / rows.length
  return { systolic: sys, diastolic: dia, readings: rows.length, days: distinct, from, to, classification: bpAverageCategory(Math.round(sys), Math.round(dia)) }
}

/** ADA fasting ranges. Only meaningful when context = ayunas; otherwise null. */
export function glucoseCategory(value: number, context: string | null | undefined): Classification | null {
  if (context !== 'ayunas') return null
  const source = `${GLUCOSE_SOURCE} (ayunas)`
  if (value >= 126) return { key: 'diabetes-range', label: 'Rango de diabetes (≥126)', tone: 'bad', source }
  if (value >= 100) return { key: 'prediabetes-range', label: 'Rango de prediabetes (100–125)', tone: 'warn', source }
  return { key: 'normal', label: 'Normal (<100)', tone: 'good', source }
}

/**
 * SpO₂ without altitude context. At sea level < 94 % is low, but at altitude lower values are normal:
 * MinSalud (Uso e interpretación de la oximetría de pulso) estimates ≈ 94 % (under 30 y) to 92 % (over 70 y)
 * for Bogotá (2600 m); Rojas-Camayo et al. 2018 (Thorax 73:776) show SpO₂ falling clearly above 2500 m.
 * So 90–93 % is only an informative note and < 90 % the warning.
 */
export function spo2Note(value: number): Classification | null {
  if (value < 90)
    return {
      key: 'low',
      label: 'Saturación baja (< 90 %)',
      tone: 'warn',
      note: 'Repite la medición en reposo, con la mano tibia y sin esmalte. Si se mantiene por debajo de 90 % o tienes síntomas (falta de aire, confusión, labios morados), consulta pronto.',
      source: SPO2_SOURCE,
    }
  if (value < 94)
    return {
      key: 'altitude-range',
      label: 'Por debajo de 94 %',
      tone: 'muted',
      note: 'A nivel del mar sería un valor bajo, pero en altitud es frecuente: en Bogotá (2600 m) se esperan valores cercanos a 92–94 % en adultos sanos, algo menores con la edad. Repite en reposo y consulta si baja de 90 % o tienes síntomas.',
      source: SPO2_SOURCE,
    }
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
