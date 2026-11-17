/**
 * Which metrics the Salud overview can show as compact panels, their short titles and the screen that
 * records each one. Pure data; the order is the reading order of the grid.
 */
import type { MetricId } from './metrics'
import type { QuickTarget } from './QuickLog'

/** Recovery has four self-reported scales; the overview shows the first one that has data. */
export const RECOVERY_SCALES: readonly MetricId[] = ['energyScale', 'moodScale', 'stressScale', 'sorenessScale']

export const OVERVIEW_ORDER: readonly MetricId[] = [
  'steps',
  'sleep',
  'water',
  'restingHr',
  'bloodPressure',
  'bodyFat',
  'waist',
  'glucose',
  'activeMinutes',
  'activeKcal',
  'habits',
  'energyScale',
  'spo2',
  'temperature',
]

export const SHORT_TITLE: Partial<Record<MetricId, string>> = {
  weight: 'Peso',
  waist: 'Cintura',
  bodyFat: 'Grasa est.',
  steps: 'Pasos',
  activeMinutes: 'Min. activos',
  activeKcal: 'Energía activa',
  sleep: 'Sueño',
  water: 'Agua',
  restingHr: 'FC en reposo',
  bloodPressure: 'Presión',
  glucose: 'Glucosa',
  spo2: 'SpO₂',
  temperature: 'Temperatura',
  habits: 'Hábitos',
  energyScale: 'Energía percibida',
  moodScale: 'Ánimo percibido',
  stressScale: 'Estrés percibido',
  sorenessScale: 'Dolor percibido',
}

/** Where a metric without records can be logged from the overview: a sheet in place, or a route. */
export function logTargetFor(id: MetricId): { target: QuickTarget } | { to: string } {
  switch (id) {
    case 'weight':
      return { target: { kind: 'weight' } }
    case 'water':
      return { target: { kind: 'water' } }
    case 'sleep':
      return { target: { kind: 'sleep' } }
    case 'bloodPressure':
      return { target: { kind: 'bloodPressure' } }
    case 'glucose':
      return { target: { kind: 'glucose' } }
    case 'restingHr':
      return { target: { kind: 'vital', vital: 'restingHr' } }
    case 'spo2':
      return { target: { kind: 'vital', vital: 'spo2' } }
    case 'temperature':
      return { target: { kind: 'vital', vital: 'temperature' } }
    case 'steps':
    case 'activeMinutes':
    case 'activeKcal':
      return { target: { kind: 'activity' } }
    case 'energyScale':
    case 'moodScale':
    case 'stressScale':
    case 'sorenessScale':
      return { target: { kind: 'recovery' } }
    case 'habits':
      return { to: '/habitos' }
    default:
      return { to: '/cuerpo/nueva' }
  }
}
