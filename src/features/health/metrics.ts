/**
 * Registry of the metrics shown by the Salud dashboard: label, unit, colour token, default
 * aggregation and chart kind, detail route and (when one exists) the goal stored in the profile.
 * Pure data; no UI and no database access.
 */
import type { ProfileSettings } from '../../db/types'

export type Aggregation = 'mean' | 'sum' | 'last'
export type ChartKind = 'line' | 'bar' | 'dots' | 'range'
/** Colour token names of the design system (CSS variables `--body`, `--move`, …). */
export type ColorToken = 'body' | 'move' | 'sleep' | 'water' | 'heart' | 'energy'

export type MetricId =
  | 'weight'
  | 'waist'
  | 'bodyFat'
  | 'fatMass'
  | 'leanMass'
  | 'ffmi'
  | 'steps'
  | 'activeMinutes'
  | 'activeKcal'
  | 'sleep'
  | 'bedtime'
  | 'wakeTime'
  | 'water'
  | 'restingHr'
  | 'bloodPressure'
  | 'glucose'
  | 'spo2'
  | 'temperature'
  | 'habits'
  | 'energyScale'
  | 'sorenessScale'
  | 'stressScale'
  | 'moodScale'

export type GoalKey = 'stepGoal' | 'waterGoalMl'

export interface MetricDef {
  id: MetricId
  label: string
  unit: string
  color: ColorToken
  aggregation: Aggregation
  kind: ChartKind
  /** Decimals to show. */
  decimals: number
  /** Existing detail page. */
  route: string
  /** Key of `Profile.settings` holding the daily goal, if the metric has one (same unit as the metric). */
  goal?: GoalKey
  /** The values are calculated estimates (body composition), always labelled with their method. */
  estimated?: boolean
  /** How a change against the previous period is worded. */
  compare: 'percent' | 'absolute'
  /** Longest run of days without data a line may cross (chart default 3). Sparse measures need more. */
  maxGapDays?: number
}

export const METRICS: readonly MetricDef[] = [
  { id: 'weight', label: 'Peso', unit: 'kg', color: 'body', aggregation: 'last', kind: 'dots', decimals: 1, route: '/cuerpo', compare: 'absolute', maxGapDays: 4 },
  { id: 'waist', label: 'Cintura', unit: 'cm', color: 'body', aggregation: 'last', kind: 'line', decimals: 1, route: '/cuerpo', compare: 'absolute', maxGapDays: 14 },
  { id: 'bodyFat', label: 'Grasa corporal (estimada)', unit: '%', color: 'body', aggregation: 'last', kind: 'line', decimals: 1, route: '/cuerpo', estimated: true, compare: 'absolute', maxGapDays: 45 },
  { id: 'fatMass', label: 'Masa grasa (estimada)', unit: 'kg', color: 'body', aggregation: 'last', kind: 'line', decimals: 1, route: '/cuerpo', estimated: true, compare: 'absolute', maxGapDays: 45 },
  { id: 'leanMass', label: 'Masa magra (estimada)', unit: 'kg', color: 'body', aggregation: 'last', kind: 'line', decimals: 1, route: '/cuerpo', estimated: true, compare: 'absolute', maxGapDays: 45 },
  { id: 'ffmi', label: 'FFMI (estimado)', unit: 'kg/m²', color: 'body', aggregation: 'last', kind: 'line', decimals: 1, route: '/cuerpo', estimated: true, compare: 'absolute', maxGapDays: 45 },
  { id: 'steps', label: 'Pasos', unit: 'pasos', color: 'move', aggregation: 'sum', kind: 'bar', decimals: 0, route: '/actividad', goal: 'stepGoal', compare: 'percent' },
  { id: 'activeMinutes', label: 'Minutos activos', unit: 'min', color: 'move', aggregation: 'sum', kind: 'bar', decimals: 0, route: '/actividad', compare: 'percent' },
  { id: 'activeKcal', label: 'Calorías activas', unit: 'kcal', color: 'move', aggregation: 'sum', kind: 'bar', decimals: 0, route: '/actividad', compare: 'percent' },
  { id: 'sleep', label: 'Sueño', unit: 'h', color: 'sleep', aggregation: 'mean', kind: 'bar', decimals: 1, route: '/sueno', compare: 'absolute' },
  { id: 'bedtime', label: 'Hora de acostarse', unit: 'min', color: 'sleep', aggregation: 'mean', kind: 'dots', decimals: 0, route: '/sueno', compare: 'absolute' },
  { id: 'wakeTime', label: 'Hora de despertar', unit: 'min', color: 'sleep', aggregation: 'mean', kind: 'dots', decimals: 0, route: '/sueno', compare: 'absolute' },
  { id: 'water', label: 'Agua', unit: 'ml', color: 'water', aggregation: 'sum', kind: 'bar', decimals: 0, route: '/agua', goal: 'waterGoalMl', compare: 'percent' },
  { id: 'restingHr', label: 'FC en reposo', unit: 'lpm', color: 'heart', aggregation: 'mean', kind: 'line', decimals: 0, route: '/signos', compare: 'absolute', maxGapDays: 4 },
  { id: 'bloodPressure', label: 'Presión arterial', unit: 'mmHg', color: 'heart', aggregation: 'mean', kind: 'range', decimals: 0, route: '/signos', compare: 'absolute' },
  { id: 'glucose', label: 'Glucosa', unit: 'mg/dL', color: 'heart', aggregation: 'mean', kind: 'dots', decimals: 0, route: '/signos', compare: 'absolute' },
  { id: 'spo2', label: 'SpO2', unit: '%', color: 'heart', aggregation: 'mean', kind: 'dots', decimals: 0, route: '/signos', compare: 'absolute' },
  { id: 'temperature', label: 'Temperatura', unit: '°C', color: 'heart', aggregation: 'mean', kind: 'dots', decimals: 1, route: '/signos', compare: 'absolute' },
  { id: 'habits', label: 'Hábitos completados', unit: '%', color: 'energy', aggregation: 'mean', kind: 'bar', decimals: 0, route: '/habitos', compare: 'absolute' },
  { id: 'energyScale', label: 'Energía (1 a 5)', unit: '/5', color: 'energy', aggregation: 'mean', kind: 'dots', decimals: 1, route: '/sueno', compare: 'absolute' },
  { id: 'sorenessScale', label: 'Dolor muscular (1 a 5)', unit: '/5', color: 'energy', aggregation: 'mean', kind: 'dots', decimals: 1, route: '/sueno', compare: 'absolute' },
  { id: 'stressScale', label: 'Estrés (1 a 5)', unit: '/5', color: 'energy', aggregation: 'mean', kind: 'dots', decimals: 1, route: '/sueno', compare: 'absolute' },
  { id: 'moodScale', label: 'Ánimo (1 a 5)', unit: '/5', color: 'energy', aggregation: 'mean', kind: 'dots', decimals: 1, route: '/sueno', compare: 'absolute' },
]

export const METRIC_IDS: readonly MetricId[] = METRICS.map((m) => m.id)

const BY_ID = new Map<MetricId, MetricDef>(METRICS.map((m) => [m.id, m]))

export function metricDef(id: MetricId): MetricDef {
  const d = BY_ID.get(id)
  if (!d) throw new Error(`Métrica desconocida: ${id}`)
  return d
}

/** The daily goal of the metric stored in the profile settings (null when none is set). */
export function goalFor(id: MetricId, settings: Pick<ProfileSettings, 'stepGoal' | 'waterGoalMl'> | null | undefined): number | null {
  const key = metricDef(id).goal
  if (!key || !settings) return null
  const v = settings[key]
  return typeof v === 'number' && v > 0 ? v : null
}
