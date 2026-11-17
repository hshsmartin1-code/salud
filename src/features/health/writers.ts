/**
 * The single write path of the Salud records: the detail sheets and the quick-log sheets both call these,
 * so validation and row shape live in one place. Every `add*` returns an {@link Undo} that removes exactly
 * the rows it wrote.
 */
import type { Repo } from '../../db/repo'
import type { PersonalTable } from '../../db/tables'
import type { VitalKind, VitalSign } from '../../db/types'
import { nowLocalTime, todayLocal } from '../../domain/dates'
import { VITAL_UNIT, validateBloodPressure, validateSingle } from '../../domain/vitals'

export interface Undo {
  table: PersonalTable
  ids: string[]
}

/** Removes the rows a quick log wrote (ignores rows already gone). */
export async function undoWrite(r: Repo, u: Undo): Promise<void> {
  for (const id of u.ids) await r.remove(u.table, id).catch(() => undefined)
}

// ───────────── Weight ─────────────
export function validateWeightKg(kg: number | null): string | null {
  if (kg === null) return 'Ingresa tu peso en kg.'
  if (kg <= 0 || kg > 400) return 'El peso debe estar entre 0 y 400 kg.'
  return null
}

/** A weigh-in only (the full editor adds circumferences and skinfolds). */
export async function addWeight(r: Repo, kg: number, when: { date?: string; time?: string | null } = {}): Promise<Undo> {
  const err = validateWeightKg(kg)
  if (err) throw new Error(err)
  const row = await r.add('bodyMeasurements', {
    date: when.date ?? todayLocal(),
    time: when.time === undefined ? nowLocalTime() : when.time,
    weightKg: Math.round(kg * 100) / 100,
    circumferences: {},
    skinfolds: {},
    protocol: null,
    derived: null,
    origin: 'app',
  })
  return { table: 'bodyMeasurements', ids: [row.id] }
}

// ───────────── Water ─────────────
export async function addWater(r: Repo, ml: number, drink: string | null = null, date = todayLocal()): Promise<Undo> {
  const row = await r.add('hydrationLogs', { date, time: nowLocalTime(), ml, drink })
  return { table: 'hydrationLogs', ids: [row.id] }
}

// ───────────── Sleep ─────────────
const toMinutes = (s: string): number | null => {
  const x = /^(\d{1,2}):(\d{2})$/.exec(s)
  return x ? Number(x[1]) * 60 + Number(x[2]) : null
}

/** Hours in bed between a bedtime and a wake time (crossing midnight when needed). */
export function hoursBetween(bed: string, wake: string): number | null {
  const b = toMinutes(bed)
  const w = toMinutes(wake)
  if (b === null || w === null) return null
  let d = w - b
  if (d <= 0) d += 1440
  return Math.round((d / 60) * 100) / 100
}

export interface SleepInput {
  date: string
  bedtime: string | null
  waketime: string | null
  /** Typed hours; when empty the bed/wake times give them. */
  hours: number | null
  quality: number | null
  notes?: string
}

/** Hours that will be stored: the typed ones, else the ones between bedtime and wake time. */
export function sleepHours(i: Pick<SleepInput, 'bedtime' | 'waketime' | 'hours'>): number | null {
  return i.hours ?? (i.bedtime && i.waketime ? hoursBetween(i.bedtime, i.waketime) : null)
}

export function validateSleep(i: SleepInput): string | null {
  const h = sleepHours(i)
  if (h !== null && (h <= 0 || h > 24)) return 'Las horas deben estar entre 0 y 24.'
  if (h === null && !i.bedtime && !i.waketime && i.quality === null) return 'Indica las horas o a qué hora te acostaste y te levantaste.'
  return null
}

export async function addSleep(r: Repo, i: SleepInput): Promise<Undo> {
  const err = validateSleep(i)
  if (err) throw new Error(err)
  const row = await r.add('sleepLogs', { date: i.date, bedtime: i.bedtime || null, waketime: i.waketime || null, hours: sleepHours(i), quality: i.quality, notes: i.notes?.trim() || undefined, origin: 'app' })
  return { table: 'sleepLogs', ids: [row.id] }
}

// ───────────── Vitals ─────────────
export interface VitalInput {
  kind: VitalKind
  date: string
  time: string | null
  systolic?: number | null
  diastolic?: number | null
  /** Pulse noted together with a new blood-pressure reading (also stored as a resting-HR reading). */
  pulse?: number | null
  value?: number | null
  context?: string | null
  notes?: string
}

/** Message in Spanish, or null when the reading is valid. */
export function validateVital(i: VitalInput): string | null {
  if (!i.date) return 'Elige una fecha.'
  if (i.kind === 'bloodPressure') {
    const e = validateBloodPressure(i.systolic ?? null, i.diastolic ?? null)
    if (e) return e
    if (i.pulse !== undefined && i.pulse !== null) return validateSingle('restingHr', i.pulse)?.replace('El valor', 'El pulso') ?? null
    return null
  }
  return validateSingle(i.kind, i.value ?? null)
}

/**
 * Saves a vital sign: edits `existing` or adds a new row (a new blood pressure with a pulse also adds the
 * resting-HR row). Returns the undo for a new reading, null for an edit.
 */
export async function saveVital(r: Repo, i: VitalInput, existing?: VitalSign | null): Promise<Undo | null> {
  const err = validateVital(i)
  if (err) throw new Error(err)
  const base = { date: i.date, time: i.time || null, unit: VITAL_UNIT[i.kind], notes: i.notes?.trim() || undefined }
  if (i.kind === 'bloodPressure') {
    const data = { ...base, kind: i.kind, systolic: i.systolic ?? null, diastolic: i.diastolic ?? null, value: null }
    if (existing) {
      await r.put('vitals', { ...existing, ...data, approx: false, excludeFromStats: false })
      return null
    }
    // Pressure and pulse are written together or not at all.
    return r.db.transaction('rw', r.db.vitals, async () => {
      const row = await r.add('vitals', { ...data, origin: 'app' })
      const ids = [row.id]
      if (i.pulse !== undefined && i.pulse !== null) {
        const pulse = await r.add('vitals', { date: i.date, time: i.time || null, kind: 'restingHr', value: i.pulse, unit: 'lpm', context: 'reposo', origin: 'app' })
        ids.push(pulse.id)
      }
      return { table: 'vitals' as const, ids }
    })
  }
  const data = { ...base, kind: i.kind, value: i.value ?? null, context: i.kind === 'glucose' ? (i.context ?? null) : (existing?.context ?? i.context ?? null) }
  if (existing) {
    await r.put('vitals', { ...existing, ...data })
    return null
  }
  const row = await r.add('vitals', { ...data, origin: 'app' })
  return { table: 'vitals', ids: [row.id] }
}
