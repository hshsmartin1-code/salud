/**
 * CSV builders for the three exports (pure). They take plain rows and return rows of cells; `toCsv`
 * turns them into text. Dates are the local calendar dates the app stores (YYYY-MM-DD, America/Bogota).
 * Unknown values are EMPTY, never 0.
 */
import type { BodyMeasurement, CircumferenceKey, ExerciseSet, FoodLog, TrainingSession } from '../../../db/types'
import { APP_TZ } from '../../../domain/dates'
import { SET_KIND_LABEL, setKind } from '../../../domain/setKind'
import { MEAL_LABEL, SOURCE_LABEL } from '../../nutrition/food'
import { toCsv, type Cell, type CsvFormat } from './csv'

const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** HH:mm in the app's time zone for an ISO instant, '' when missing or invalid. */
export function localTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : TIME.format(d)
}

const num = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

export const TRAINING_HEADER = ['fecha', 'hora_inicio', 'sesion', 'ejercicio', 'id_ejercicio', 'orden_serie', 'tipo_serie', 'peso_kg', 'reps', 'rir', 'rpe', 'duracion_s', 'distancia_m', 'notas']

/** One row per DONE set, oldest first (date, session start, exercise order, set index). */
export function trainingRows(sessions: readonly TrainingSession[], sets: readonly ExerciseSet[]): Cell[][] {
  const bySession = new Map(sessions.map((s) => [s.id, s]))
  const rank = (s: TrainingSession, id: string) => {
    const i = s.exerciseOrder.findIndex((e) => e.exerciseId === id)
    return i < 0 ? 999 : i
  }
  const rows = sets
    .filter((x) => x.done && bySession.has(x.sessionId))
    .map((x) => ({ x, s: bySession.get(x.sessionId)! }))
    .sort(
      (a, b) =>
        a.s.date.localeCompare(b.s.date) ||
        (a.s.startedAt ?? '').localeCompare(b.s.startedAt ?? '') ||
        a.s.id.localeCompare(b.s.id) ||
        rank(a.s, a.x.exerciseId) - rank(b.s, b.x.exerciseId) ||
        a.x.setIndex - b.x.setIndex,
    )
  return [
    TRAINING_HEADER,
    ...rows.map(({ x, s }) => [
      s.date,
      localTime(s.startedAt),
      s.name,
      x.exerciseName,
      x.exerciseId,
      x.setIndex + 1,
      SET_KIND_LABEL[setKind(x)],
      num(x.weight),
      num(x.reps),
      num(x.rir),
      num(x.rpe),
      num(x.durationSec),
      num(x.distanceM),
      x.notes ?? '',
    ]),
  ]
}

export const FOOD_HEADER = ['fecha', 'hora', 'comida', 'alimento', 'marca', 'cantidad', 'unidad', 'gramos', 'kcal', 'proteina_g', 'carbohidratos_g', 'grasa_g', 'fibra_g', 'sodio_mg', 'fuente', 'nota']

export function foodRows(logs: readonly FoodLog[]): Cell[][] {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
  return [
    FOOD_HEADER,
    ...sorted.map((l) => {
      const n = l.nutrients ?? {}
      return [l.date, l.time ?? '', MEAL_LABEL[l.meal] ?? l.meal, l.name, l.brand ?? '', num(l.qty), l.unit, num(l.grams), num(n.kcal), num(n.protein), num(n.carbs), num(n.fat), num(n.fiber), num(n.sodium), SOURCE_LABEL[l.source] ?? l.source, l.note ?? '']
    }),
  ]
}

const CIRC: [CircumferenceKey, string][] = [
  ['waist', 'cintura_cm'],
  ['hip', 'cadera_cm'],
  ['neck', 'cuello_cm'],
  ['chest', 'pecho_cm'],
  ['armRelaxed', 'brazo_relajado_cm'],
  ['armContracted', 'brazo_contraido_cm'],
  ['forearm', 'antebrazo_cm'],
  ['thigh', 'muslo_cm'],
  ['calf', 'pantorrilla_cm'],
]
export const BODY_HEADER = ['fecha', 'hora', 'peso_kg', 'grasa_pct', ...CIRC.map(([, h]) => h), 'notas']

export function bodyRows(rows: readonly BodyMeasurement[]): Cell[][] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt))
  return [BODY_HEADER, ...sorted.map((m) => [m.date, m.time ?? '', num(m.weightKg), num(m.derived?.bodyFatPct), ...CIRC.map(([k]) => num(m.circumferences?.[k])), m.notes ?? ''])]
}

export const buildTrainingCsv = (sessions: readonly TrainingSession[], sets: readonly ExerciseSet[], f?: CsvFormat) => toCsv(trainingRows(sessions, sets), f)
export const buildFoodCsv = (logs: readonly FoodLog[], f?: CsvFormat) => toCsv(foodRows(logs), f)
export const buildBodyCsv = (rows: readonly BodyMeasurement[], f?: CsvFormat) => toCsv(bodyRows(rows), f)

export type CsvKind = 'entrenamientos' | 'comida' | 'peso-medidas'
export const csvFileName = (kind: CsvKind, profileName: string, date: string): string => {
  const slug = profileName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil'
  return `salud-${kind}-${slug}-${date}.csv`
}
