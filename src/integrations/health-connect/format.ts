import type { HealthMetric, HealthRecord } from '../../db/types'
import { formatNumber } from '../../domain/units'
import { exerciseLabel, sourceLabels } from './sources'

export const METRIC_LABELS: Record<HealthMetric, string> = {
  steps: 'Pasos',
  activeKcal: 'Calorías activas',
  totalKcal: 'Calorías totales',
  distanceM: 'Distancia',
  restingHr: 'FC en reposo',
  heartRateAvg: 'FC media',
  exercise: 'Ejercicio',
  sleep: 'Sueño',
  weight: 'Peso',
  bodyFat: 'Grasa corporal',
  leanMassKg: 'Masa magra',
}

/** Order used by the review filters. */
export const METRIC_ORDER: readonly HealthMetric[] = ['steps', 'activeKcal', 'distanceM', 'restingHr', 'heartRateAvg', 'exercise', 'sleep', 'weight', 'bodyFat', 'leanMassKg', 'totalKcal']

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/** Value with its unit, as a person reads it. */
export function formatValue(row: Pick<HealthRecord, 'metric' | 'value'>): string {
  const v = row.value
  if (v === null || v === undefined) return '—'
  switch (row.metric) {
    case 'steps':
      return `${formatNumber(v, 0)} pasos`
    case 'activeKcal':
    case 'totalKcal':
      return `${formatNumber(v, 0)} kcal`
    case 'distanceM':
      return `${formatNumber(v / 1000, 2)} km`
    case 'restingHr':
    case 'heartRateAvg':
      return `${formatNumber(v, 0)} lpm`
    case 'exercise':
      return formatMinutes(v)
    case 'sleep':
      return formatMinutes(v)
    case 'weight':
    case 'leanMassKg':
      return `${formatNumber(v, 1)} kg`
    case 'bodyFat':
      return `${formatNumber(v, 1)} %`
  }
}

export function rowTitle(row: HealthRecord): string {
  if (row.metric === 'exercise') return `${exerciseLabel(String(row.detail?.exerciseKey ?? ''), row.title)} · ${formatValue(row)}`
  return `${METRIC_LABELS[row.metric]} · ${formatValue(row)}`
}

const METHODS: Record<string, string> = { manual: 'manual', automatic: 'automático', active: 'registro activo' }

/** Date, source app(s), device and how it was recorded; exercise kcal/distance are labelled informative. */
export function rowSubtitle(row: HealthRecord, dateLabel: (d: string) => string): string {
  const parts: string[] = [dateLabel(row.date)]
  const src = sourceLabels(row.sources)
  if (src.length) parts.push(src.join(', '))
  if (row.device) parts.push(row.device)
  const method = row.detail?.recordingMethod
  if (typeof method === 'string' && METHODS[method]) parts.push(METHODS[method])
  if (row.metric === 'exercise' && row.detail) {
    const extra: string[] = []
    if (typeof row.detail.activeKcal === 'number') extra.push(`${formatNumber(row.detail.activeKcal, 0)} kcal`)
    if (typeof row.detail.distanceM === 'number') extra.push(`${formatNumber(row.detail.distanceM / 1000, 2)} km`)
    if (extra.length) parts.push(`${extra.join(' · ')} (solo informativo)`)
  }
  if (row.kind === 'daily') parts.push('total del día')
  return parts.filter(Boolean).join(' · ')
}
