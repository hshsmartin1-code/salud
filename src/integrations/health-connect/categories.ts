import type { HealthCategory, HealthMetric } from '../../db/types'
import type { HcDailyMetric, HcRawType } from './types'

const P = (name: string) => `android.permission.health.READ_${name}`

export interface CategoryInfo {
  id: HealthCategory
  label: string
  /** What turning it on imports, in plain words. */
  description: string
  icon: 'activity' | 'heart' | 'dumbbell' | 'bed' | 'scale'
  permissions: string[]
  dailyMetrics: HcDailyMetric[]
  rawTypes: HcRawType[]
  metrics: HealthMetric[]
}

/** Read-only. Never total calories, history older than 30 days or background reads. */
export const CATEGORIES: readonly CategoryInfo[] = [
  {
    id: 'activity',
    label: 'Actividad',
    description: 'Pasos, calorías activas (sin metabolismo basal) y distancia, un total por día.',
    icon: 'activity',
    permissions: [P('STEPS'), P('ACTIVE_CALORIES_BURNED'), P('DISTANCE')],
    dailyMetrics: ['steps', 'activeKcal', 'distanceM'],
    rawTypes: [],
    metrics: ['steps', 'activeKcal', 'distanceM'],
  },
  {
    id: 'heart',
    label: 'Corazón',
    description: 'Frecuencia cardiaca en reposo y frecuencia media diaria.',
    icon: 'heart',
    permissions: [P('HEART_RATE'), P('RESTING_HEART_RATE')],
    dailyMetrics: ['restingHr', 'heartRateAvg'],
    rawTypes: [],
    metrics: ['restingHr', 'heartRateAvg'],
  },
  {
    id: 'exercise',
    label: 'Ejercicio',
    description: 'Sesiones de entrenamiento (tipo y duración; kcal y distancia solo para mostrar, si también activas Actividad).',
    icon: 'dumbbell',
    permissions: [P('EXERCISE')],
    dailyMetrics: [],
    rawTypes: ['ExerciseSession'],
    metrics: ['exercise'],
  },
  {
    id: 'sleep',
    label: 'Sueño',
    description: 'Sesiones de sueño con sus fases.',
    icon: 'bed',
    permissions: [P('SLEEP')],
    dailyMetrics: [],
    rawTypes: ['SleepSession'],
    metrics: ['sleep'],
  },
  {
    id: 'body',
    label: 'Cuerpo',
    description: 'Peso, grasa corporal y masa magra.',
    icon: 'scale',
    permissions: [P('WEIGHT'), P('BODY_FAT'), P('LEAN_BODY_MASS')],
    dailyMetrics: [],
    rawTypes: ['Weight', 'BodyFat', 'LeanBodyMass'],
    metrics: ['weight', 'bodyFat', 'leanMassKg'],
  },
]

export const ALL_PERMISSIONS: readonly string[] = CATEGORIES.flatMap((c) => c.permissions)

export function categoryInfo(id: HealthCategory): CategoryInfo {
  const c = CATEGORIES.find((x) => x.id === id)
  if (!c) throw new Error(`Categoría desconocida: ${id}`)
  return c
}

/** Union of the permissions of the given categories (deduplicated, stable order). */
export function permissionsFor(categories: readonly HealthCategory[]): string[] {
  return [...new Set(categories.flatMap((c) => categoryInfo(c).permissions))]
}

/** A category counts as granted only when ALL of its permissions are granted. */
export function grantedCategories(granted: readonly string[]): HealthCategory[] {
  const set = new Set(granted)
  return CATEGORIES.filter((c) => c.permissions.every((p) => set.has(p))).map((c) => c.id)
}

/** Categories the person enabled that are still fully granted (revoked in Health Connect → drops out). */
export function activeCategories(enabled: Partial<Record<HealthCategory, boolean>>, granted: readonly string[]): HealthCategory[] {
  const ok = new Set(grantedCategories(granted))
  return CATEGORIES.filter((c) => enabled[c.id] && ok.has(c.id)).map((c) => c.id)
}

export function dailyMetricsFor(categories: readonly HealthCategory[]): HcDailyMetric[] {
  return [...new Set(categories.flatMap((c) => categoryInfo(c).dailyMetrics))]
}
export function rawTypesFor(categories: readonly HealthCategory[]): HcRawType[] {
  return [...new Set(categories.flatMap((c) => categoryInfo(c).rawTypes))]
}
export function metricsFor(categories: readonly HealthCategory[]): HealthMetric[] {
  return [...new Set(categories.flatMap((c) => categoryInfo(c).metrics))]
}
