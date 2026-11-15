/**
 * Phase 0 history importer (file `15_personal_health_os_import.json`, read on the device only).
 * Keeps only real observations: no duplicates, no invalid rows, nothing planned/placeholder/prefilled,
 * only exact dates up to today. Chart-read approximations are imported as approximate and excluded
 * from statistics. Ids are deterministic per target profile, so re-importing is idempotent.
 */
import type { ActivityLog, BodyMeasurement, CircumferenceKey, ImportedDaily, Profile, SleepLog, TrainingSession } from '../../db/types'
import { computeBodyComp, type ProtocolId, type SkinfoldSite } from '../../domain/bodycomp'
import { ageFromBirthDate } from '../../domain/energy'

export interface P0Record {
  record_id: string
  profile_id: string
  measurement_date: string | null
  date_precision: string
  record_kind: string
  metric: string
  value: number | null
  unit: string | null
  value_text: string | null
  value_type: string
  measurement_method: string | null
  data_quality: string
  exclude_from_stats: boolean
  duplicate_of: string | null
  flags: string[]
  source_ref: string
}

export interface P0Profile {
  profile_id: string
  display_name: string
  sex: 'male' | 'female'
  height_cm: number | null
  birth_date: string | null
}

export interface P0File {
  schema_version: string
  generated_at: string
  profiles: P0Profile[]
  body_measurements: P0Record[]
  food_entries: P0Record[]
  training_sessions: P0Record[]
  exercise_sets: P0Record[]
  activity_records: P0Record[]
  sleep_records: P0Record[]
  habits: P0Record[]
}

const TABLES = ['body_measurements', 'food_entries', 'training_sessions', 'exercise_sets', 'activity_records', 'sleep_records', 'habits'] as const

export function parsePhase0(text: string): P0File {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }
  const f = raw as Partial<P0File>
  if (!f || typeof f.schema_version !== 'string' || !f.schema_version.startsWith('phase0')) {
    throw new Error('No es el archivo de importación de la fase 0 (se esperaba schema_version "phase0-…").')
  }
  if (!Array.isArray(f.profiles) || !f.profiles.length) throw new Error('El archivo no tiene perfiles.')
  for (const t of TABLES) if (!Array.isArray(f[t])) (f as Record<string, unknown>)[t] = []
  return f as P0File
}

const EXACT = new Set(['exact', 'exact_inferred', 'exact_inferred_year'])
const EXCLUDED_TYPES = new Set(['planned', 'placeholder', 'prefilled'])

/** The documented Phase 0 filter. */
export function keepRecord(r: P0Record, today: string): boolean {
  return (
    r.duplicate_of === null &&
    r.data_quality !== 'invalid' &&
    !EXCLUDED_TYPES.has(r.value_type) &&
    EXACT.has(r.date_precision) &&
    !!r.measurement_date &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.measurement_date) &&
    r.measurement_date <= today
  )
}

const approxOf = (r: P0Record) => r.data_quality === 'chart_read_approx' || r.data_quality === 'questionable'

const CIRC: Record<string, CircumferenceKey> = {
  waist_circumference: 'waist',
  neck_circumference: 'neck',
  hip_circumference: 'hip',
  chest_circumference: 'chest',
  arm_circumference_relaxed: 'armRelaxed',
  arm_circumference_contracted: 'armContracted',
  forearm_circumference: 'forearm',
  thigh_circumference: 'thigh',
  calf_circumference: 'calf',
}
const SKIN: Record<string, SkinfoldSite> = {
  skinfold_chest: 'chest',
  skinfold_midaxillary: 'midaxillary',
  skinfold_triceps: 'triceps',
  skinfold_subscapular: 'subscapular',
  skinfold_abdominal: 'abdominal',
  skinfold_suprailiac: 'suprailiac',
  skinfold_supraspinale: 'supraspinale',
  skinfold_thigh: 'thigh',
  skinfold_biceps: 'biceps',
  skinfold_calf: 'calf',
}

const NOT_TRAINING = new Set(['descanso', 'recuperacion', 'recuperación', 'viaje / actividad libre'])

function hhmm(minFromMidnight: number): string {
  const m = (((Math.round(minFromMidnight) % 1440) + 1440) % 1440) as number
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function guessProtocol(sites: SkinfoldSite[]): ProtocolId {
  const s = new Set(sites)
  const isak6 = ['triceps', 'subscapular', 'biceps', 'suprailiac', 'supraspinale', 'abdominal'].every((k) => s.has(k as SkinfoldSite))
  if (isak6 && s.has('calf') && s.has('thigh')) return 'isak8'
  if (isak6 && s.has('calf')) return 'isak7_calf'
  if (isak6 && s.has('thigh')) return 'isak7_thigh'
  return 'sum_custom'
}

type New<T> = Omit<T, 'createdAt' | 'updatedAt'> & { id: string; profileId: string }

export interface Phase0Rows {
  bodyMeasurements: New<BodyMeasurement>[]
  trainingSessions: New<TrainingSession>[]
  activityLogs: New<ActivityLog>[]
  sleepLogs: New<SleepLog>[]
  importedDaily: New<ImportedDaily>[]
  summary: { kept: number; dropped: number; byKind: Record<string, number> }
}

/** Builds app rows for one Phase 0 profile letter → one app profile. Pure; no DB access. */
export function mapPhase0(file: P0File, letter: string, target: Pick<Profile, 'id' | 'sex' | 'birthDate' | 'heightCm'>, today: string): Phase0Rows {
  const pid = target.id
  const id = (kind: string, date: string, extra = '') => `phase0:${pid}:${kind}:${date}${extra ? ':' + extra : ''}`
  const all = TABLES.flatMap((t) => file[t].filter((r) => r.profile_id === letter))
  const kept = all.filter((r) => keepRecord(r, today))
  const by = (pred: (r: P0Record) => boolean) => kept.filter(pred)
  const out: Phase0Rows = { bodyMeasurements: [], trainingSessions: [], activityLogs: [], sleepLogs: [], importedDaily: [], summary: { kept: 0, dropped: 0, byKind: {} } }
  const used = new Set<string>()
  const markUsed = (r: P0Record) => used.add(r.record_id)

  // ── Body: one measurement row per date.
  const bodyRecs = file.body_measurements.filter((r) => r.profile_id === letter && keepRecord(r, today))
  const bodyDates = [...new Set(bodyRecs.map((r) => r.measurement_date as string))].sort()
  for (const date of bodyDates) {
    const recs = bodyRecs.filter((r) => r.measurement_date === date)
    const weights = recs.filter((r) => r.metric === 'body_weight' && r.value !== null)
    const rank = (r: P0Record) => (/ayunas|fasting/i.test(r.measurement_method ?? '') ? 0 : r.record_kind === 'raw_measurement' ? 1 : 2)
    const w = weights.sort((a, b) => rank(a) - rank(b))[0]
    const circumferences: Partial<Record<CircumferenceKey, number>> = {}
    const skinfolds: Partial<Record<SkinfoldSite, number>> = {}
    const refs: string[] = []
    if (w) {
      refs.push(w.record_id)
      markUsed(w)
    }
    for (const r of recs) {
      if (r.value === null) continue
      if (CIRC[r.metric]) {
        circumferences[CIRC[r.metric]!] = r.value
        refs.push(r.record_id)
        markUsed(r)
      } else if (SKIN[r.metric]) {
        skinfolds[SKIN[r.metric]!] = r.value
        refs.push(r.record_id)
        markUsed(r)
      }
    }
    if (!w && !Object.keys(circumferences).length && !Object.keys(skinfolds).length) continue
    const sites = Object.keys(skinfolds) as SkinfoldSite[]
    const protocol = sites.length ? guessProtocol(sites) : null
    let derived: BodyMeasurement['derived'] = null
    if (protocol && target.birthDate) {
      const age = ageFromBirthDate(target.birthDate, date)
      const res = computeBodyComp({ protocol, sex: target.sex, ageYears: age, skinfolds, weightKg: w?.value ?? null, heightCm: target.heightCm })
      if (res.sum !== null) {
        derived = {
          estimated: true,
          protocol,
          equation: res.equation,
          method: res.method,
          sum: res.sum,
          ...(res.bodyFatPct !== undefined ? { bodyFatPct: res.bodyFatPct, density: res.density, fatMassKg: res.fatMassKg, leanMassKg: res.leanMassKg } : {}),
          inputs: { sex: target.sex, ageYears: age, weightKg: w?.value ?? null, heightCm: target.heightCm },
          computedAt: new Date().toISOString(),
        }
      }
    }
    out.bodyMeasurements.push({
      id: id('body', date),
      profileId: pid,
      date,
      time: null,
      weightKg: w?.value ?? null,
      circumferences,
      skinfolds,
      protocol,
      derived,
      origin: 'phase0',
      sourceRef: refs.join(','),
      approx: w ? approxOf(w) : false,
      excludeFromStats: w ? w.exclude_from_stats : false,
      notes: w?.measurement_method ? `Fase 0: ${w.measurement_method}` : undefined,
    })
  }

  // ── Daily intake totals (no food-level detail exists for those days).
  for (const r of by((r) => r.metric === 'energy_intake' && r.value !== null)) {
    markUsed(r)
    out.importedDaily.push({
      id: id('daily', r.measurement_date!, 'kcal_intake'),
      profileId: pid,
      date: r.measurement_date!,
      metric: 'kcal_intake',
      value: r.value,
      valueText: null,
      unit: 'kcal',
      label: 'Kcal ingeridas (registro previo)',
      origin: 'phase0',
      sourceRef: r.record_id,
      approx: approxOf(r),
      excludeFromStats: r.exclude_from_stats,
    })
  }

  // ── Training: session type done per day. Rest/recovery days are kept as daily notes only.
  for (const r of by((r) => r.metric === 'session_type_done' && !!r.value_text)) {
    markUsed(r)
    const text = r.value_text!.trim()
    out.importedDaily.push({
      id: id('daily', r.measurement_date!, 'training_done'),
      profileId: pid,
      date: r.measurement_date!,
      metric: 'training_done',
      value: null,
      valueText: text,
      unit: null,
      label: 'Entrenamiento realizado (registro previo)',
      origin: 'phase0',
      sourceRef: r.record_id,
      approx: false,
      excludeFromStats: r.exclude_from_stats,
    })
    if (NOT_TRAINING.has(text.toLowerCase())) continue
    out.trainingSessions.push({
      id: id('session', r.measurement_date!),
      profileId: pid,
      date: r.measurement_date!,
      name: text,
      routineId: null,
      status: 'done',
      startedAt: null,
      endedAt: null,
      restEndsAt: null,
      exerciseOrder: [],
      notes: 'Importada del registro previo (sin series).',
      origin: 'phase0',
      sourceRef: r.record_id,
      excludeFromStats: r.exclude_from_stats,
    })
  }
  for (const r of by((r) => r.metric === 'hiit_duration' && r.value !== null)) {
    markUsed(r)
    out.activityLogs.push({
      id: id('activity', r.measurement_date!, 'hiit'),
      profileId: pid,
      date: r.measurement_date!,
      type: 'HIIT',
      steps: null,
      activeKcal: null,
      minutes: r.value,
      distanceKm: null,
      origin: 'phase0',
      sourceRef: r.record_id,
      approx: false,
      excludeFromStats: r.exclude_from_stats,
    })
  }

  // ── Wearable: active kcal + steps per day. Exact device values win over chart readings.
  const actDates = new Set(by((r) => r.metric === 'active_energy_band' || r.metric === 'steps').map((r) => r.measurement_date!))
  for (const date of [...actDates].sort()) {
    const kcalRecs = by((r) => r.measurement_date === date && r.metric === 'active_energy_band' && r.value !== null)
    const exact = kcalRecs.filter((r) => r.data_quality === 'ok')
    const kcal = exact[0] ?? kcalRecs[0]
    const steps = by((r) => r.measurement_date === date && r.metric === 'steps' && r.value !== null)[0]
    if (!kcal && !steps) continue
    if (kcal) markUsed(kcal)
    if (steps) markUsed(steps)
    const approx = kcal ? approxOf(kcal) : false
    out.activityLogs.push({
      id: id('activity', date, 'band'),
      profileId: pid,
      date,
      type: 'Pulsera / reloj',
      steps: steps?.value ?? null,
      activeKcal: kcal?.value ?? null,
      minutes: null,
      distanceKm: null,
      notes: approx ? 'Kcal leídas de una gráfica (aproximadas).' : 'Kcal de actividad de la pulsera, sin corregir.',
      origin: 'phase0',
      sourceRef: [kcal?.record_id, steps?.record_id].filter(Boolean).join(','),
      approx,
      excludeFromStats: approx || !!kcal?.exclude_from_stats,
    })
  }
  for (const r of by((r) => (r.metric === 'hr_daily_range_low' || r.metric === 'hr_daily_range_high') && r.value !== null)) {
    markUsed(r)
    out.importedDaily.push({
      id: id('daily', r.measurement_date!, r.metric),
      profileId: pid,
      date: r.measurement_date!,
      metric: r.metric,
      value: r.value,
      valueText: null,
      unit: 'lpm',
      label: r.metric === 'hr_daily_range_low' ? 'FC mínima del día (gráfica, aprox.)' : 'FC máxima del día (gráfica, aprox.)',
      origin: 'phase0',
      sourceRef: r.record_id,
      approx: true,
      excludeFromStats: true,
    })
  }

  // ── Sleep: hours (self-reported) + chart-read bedtime / wake time.
  const sleepDates = new Set(by((r) => ['sleep_duration', 'sleep_onset_time', 'wake_time'].includes(r.metric)).map((r) => r.measurement_date!))
  for (const date of [...sleepDates].sort()) {
    const hours = by((r) => r.measurement_date === date && r.metric === 'sleep_duration' && r.value !== null)[0]
    const onset = by((r) => r.measurement_date === date && r.metric === 'sleep_onset_time' && r.value !== null)[0]
    const wake = by((r) => r.measurement_date === date && r.metric === 'wake_time' && r.value !== null)[0]
    for (const r of [hours, onset, wake]) if (r) markUsed(r)
    const chartTimes = !!(onset || wake)
    out.sleepLogs.push({
      id: id('sleep', date),
      profileId: pid,
      date,
      hours: hours?.value ?? null,
      bedtime: onset ? hhmm(onset.value!) : null,
      waketime: wake ? hhmm(wake.value!) : null,
      quality: null,
      notes: chartTimes ? 'Horas de acostarse/levantarse leídas de una gráfica (aproximadas).' : undefined,
      origin: 'phase0',
      sourceRef: [hours, onset, wake].filter(Boolean).map((r) => r!.record_id).join(','),
      approx: !hours,
      excludeFromStats: !hours || !!hours.exclude_from_stats,
    })
  }

  out.summary.kept = used.size
  out.summary.dropped = all.length - used.size
  out.summary.byKind = {
    Mediciones: out.bodyMeasurements.length,
    'Sesiones de entreno': out.trainingSessions.length,
    'Días de actividad': out.activityLogs.length,
    'Noches de sueño': out.sleepLogs.length,
    'Valores diarios': out.importedDaily.length,
  }
  return out
}
