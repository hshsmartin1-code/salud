/**
 * "Para hoy": deterministic, factual observations drawn from the person's own records.
 * Pure functions (tested). Every rule has a minimum-data threshold and states its basis; nothing here is
 * a score, a diagnosis or an invented number. The caller passes series that already follow the dashboard's
 * source precedence (controlCenter.ts), so manual and Health Connect data are never counted twice.
 */
import { addDays, daysBetween, isoWeekStart } from '../../domain/dates'
import { formatNumber } from '../../domain/units'

export type InsightTone = 'info' | 'good' | 'attention'

export interface Insight {
  id: string
  tone: InsightTone
  text: string
  /** The same observation for one line on a phone (the full sentence stays in `text`). */
  short: string
  /** What the statement rests on, e.g. "Basado en 6 de 7 días con registro.". */
  basis: string
  href: string
}

// ───────────── thresholds ─────────────
/** Minimum days (or nights) with a record before an average is stated. */
export const MIN_DAYS = 4
/** Protein: average below this share of the target. */
export const PROTEIN_LOW_RATIO = 0.85
/** Energy: average further than this share from the target, in either direction. */
export const ENERGY_TOLERANCE = 0.15
/** Sleep: average below this many hours. */
export const SLEEP_MIN_HOURS = 7
/** Steps: average below this share of the step goal. */
export const STEPS_LOW_RATIO = 0.8
/** Training: last week must have had at least this many sessions. */
export const TRAINING_MIN_LAST_WEEK = 2
/** Hydration: below this share of the goal... */
export const HYDRATION_LOW_RATIO = 0.6
/** ...after this local hour. */
export const HYDRATION_FROM_HOUR = 16
/** Weight: days without a weigh-in that count as a gap... */
export const WEIGH_GAP_DAYS = 7
/** ...when there were at least this many weigh-ins... */
export const WEIGH_MIN_PRIOR = 3
/** ...in the 30 days before the gap began. */
export const WEIGH_PRIOR_WINDOW_DAYS = 30
export const MAX_INSIGHTS = 3

export interface InsightInput {
  today: string
  /** Local hour of day, 0-23. */
  hour: number
  /** The last 7 complete days (ending yesterday), oldest first; null = no record. */
  kcal7: (number | null)[]
  protein7: (number | null)[]
  steps7: (number | null)[]
  /** The 7 nights ending today (wake-up date), oldest first. */
  sleep7: (number | null)[]
  kcalTarget: number | null
  proteinTarget: number | null
  stepGoal: number | null
  /** Dates of finished sessions that count in statistics. */
  sessionDates: string[]
  waterTodayMl: number
  waterGoalMl: number | null
  /** One date per day with a weigh-in (any source, already de-duplicated). */
  weightDates: string[]
}

const present = (xs: (number | null)[]): number[] => xs.filter((v): v is number => v !== null && Number.isFinite(v))
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const n0 = (v: number) => formatNumber(v, 0)
const days = (k: number, total: number, noun: string) => `Basado en ${k} de ${total} ${noun} con registro.`

function protein(i: InsightInput): Insight | null {
  const xs = present(i.protein7)
  if (!i.proteinTarget || xs.length < MIN_DAYS) return null
  const avg = mean(xs)
  if (avg >= i.proteinTarget * PROTEIN_LOW_RATIO) return null
  return {
    id: 'protein-low',
    tone: 'attention',
    text: `Tu proteína media de 7 días es ${n0(avg)} g, ${n0((avg / i.proteinTarget) * 100)} % del objetivo.`,
    short: `Proteína media ${n0(avg)} g, ${n0((avg / i.proteinTarget) * 100)} % del objetivo`,
    basis: days(xs.length, i.protein7.length, 'días'),
    href: '/comida',
  }
}

function energy(i: InsightInput): Insight | null {
  const xs = present(i.kcal7)
  if (!i.kcalTarget || xs.length < MIN_DAYS) return null
  const avg = mean(xs)
  const diff = (avg - i.kcalTarget) / i.kcalTarget
  if (Math.abs(diff) <= ENERGY_TOLERANCE) return null
  return {
    id: 'energy-off',
    tone: 'attention',
    text: `Tu energía media de 7 días es ${n0(avg)} kcal, ${n0(Math.abs(diff) * 100)} % ${diff > 0 ? 'por encima' : 'por debajo'} del objetivo.`,
    short: `Energía media ${n0(avg)} kcal (${diff > 0 ? '+' : '−'}${n0(Math.abs(diff) * 100)} %)`,
    basis: days(xs.length, i.kcal7.length, 'días'),
    href: '/comida',
  }
}

function sleep(i: InsightInput): Insight | null {
  const xs = present(i.sleep7)
  if (xs.length < MIN_DAYS) return null
  const avg = mean(xs)
  if (avg >= SLEEP_MIN_HOURS) return null
  return {
    id: 'sleep-short',
    tone: 'attention',
    text: `Tu sueño medio de 7 noches es ${formatNumber(avg, 1)} h, por debajo de ${SLEEP_MIN_HOURS} h.`,
    short: `Sueño medio ${formatNumber(avg, 1)} h, bajo ${SLEEP_MIN_HOURS} h`,
    basis: days(xs.length, i.sleep7.length, 'noches'),
    href: '/sueno',
  }
}

function steps(i: InsightInput): Insight | null {
  const xs = present(i.steps7)
  if (!i.stepGoal || xs.length < MIN_DAYS) return null
  const avg = mean(xs)
  if (avg >= i.stepGoal * STEPS_LOW_RATIO) return null
  return {
    id: 'steps-low',
    tone: 'info',
    text: `Tu media de pasos de 7 días es ${n0(avg)}, ${n0((avg / i.stepGoal) * 100)} % de tu meta de ${n0(i.stepGoal)}.`,
    short: `Pasos medios ${n0(avg)}, ${n0((avg / i.stepGoal) * 100)} % de tu meta`,
    basis: days(xs.length, i.steps7.length, 'días'),
    href: '/actividad',
  }
}

function training(i: InsightInput): Insight | null {
  const weekStart = isoWeekStart(i.today)
  const lastStart = addDays(weekStart, -7)
  const lastToDate = addDays(lastStart, daysBetween(weekStart, i.today))
  const lastEnd = addDays(weekStart, -1)
  const inRange = (from: string, to: string) => i.sessionDates.filter((d) => d >= from && d <= to).length
  const lastWeek = inRange(lastStart, lastEnd)
  if (lastWeek < TRAINING_MIN_LAST_WEEK) return null
  const now = inRange(weekStart, i.today)
  const then = inRange(lastStart, lastToDate)
  if (now >= then) return null
  const s = (k: number) => `${k} ${k === 1 ? 'sesión' : 'sesiones'}`
  return {
    id: 'training-behind',
    tone: 'info',
    text: `Llevas ${s(now)} esta semana; en este punto de la semana pasada eran ${then}.`,
    short: `${s(now)} esta semana (${then} la pasada)`,
    basis: `La semana pasada hiciste ${s(lastWeek)} en total.`,
    href: '/entreno',
  }
}

function hydration(i: InsightInput): Insight | null {
  if (!i.waterGoalMl || i.hour < HYDRATION_FROM_HOUR) return null
  if (i.waterTodayMl >= i.waterGoalMl * HYDRATION_LOW_RATIO) return null
  return {
    id: 'water-low',
    tone: 'info',
    text: `Llevas ${formatNumber(i.waterTodayMl / 1000, 2)} L de agua hoy, ${n0((i.waterTodayMl / i.waterGoalMl) * 100)} % de tu meta.`,
    short: `Agua hoy ${formatNumber(i.waterTodayMl / 1000, 2)} L, ${n0((i.waterTodayMl / i.waterGoalMl) * 100)} % de tu meta`,
    basis: `Meta de ${formatNumber(i.waterGoalMl / 1000, 1)} L; pasadas las ${HYDRATION_FROM_HOUR}:00.`,
    href: '/agua',
  }
}

function weight(i: InsightInput): Insight | null {
  const dates = [...new Set(i.weightDates)].filter((d) => d <= i.today).sort()
  const last = dates[dates.length - 1]
  if (!last) return null
  const gap = daysBetween(last, i.today)
  if (gap < WEIGH_GAP_DAYS) return null
  const prior = dates.filter((d) => daysBetween(d, last) < WEIGH_PRIOR_WINDOW_DAYS).length
  if (prior < WEIGH_MIN_PRIOR) return null
  return {
    id: 'weight-gap',
    tone: 'info',
    text: `Llevas ${gap} días sin registrar tu peso.`,
    short: `${gap} días sin registrar tu peso`,
    basis: `Tenías ${prior} registros en los 30 días anteriores.`,
    href: '/cuerpo/nueva?tipo=peso',
  }
}

/** Fixed priority, then at most {@link MAX_INSIGHTS}. Empty when no rule fires. */
export function buildInsights(i: InsightInput): Insight[] {
  const rules = [protein, energy, sleep, steps, training, hydration, weight]
  const out: Insight[] = []
  for (const rule of rules) {
    const r = rule(i)
    if (r) out.push(r)
    if (out.length === MAX_INSIGHTS) break
  }
  return out
}
