/**
 * Training history import from the CSV that Hevy and Strong let the user export from their own account.
 *
 * Formats (as documented by the apps and third-party guides; see docs in the UI):
 *  - Hevy "Export workouts" (Profile → Settings → Export & Import Data): comma separated,
 *    `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,
 *    weight_kg,reps,distance_km,duration_seconds,rpe`. Dates read like "16 Nov 2026, 18:30" (English months).
 *    The weight/distance columns carry their unit in the name (weight_kg / weight_lbs, distance_km / distance_miles).
 *    set_type: normal, warmup, failure, dropset.
 *  - Strong "Export Strong Data": `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,
 *    Notes,Workout Notes,RPE` (comma or semicolon). Date "2026-05-11 18:30:00", Duration "1h 2m" / "62m" / "01:02:00".
 *    Set Order is a number, or W (warm-up), D (drop set), F (failure); "Rest Timer" rows are ignored.
 *    Some versions label the weight column "Weight (kg)" / "Weight (lbs)"; when it is not labelled, the person picks.
 *
 * Assumptions: timestamps carry no time zone, so they are read as America/Bogota local time (UTC-5, no DST);
 * Strong distance is read as metres; Hevy distance_km is converted to metres.
 *
 * Idempotency: ids are derived from profile + source + start instant (+ exercise + set order), so importing
 * the same file twice never duplicates. Everything here is pure except `applyTrainingImport` / `undoTrainingImport`.
 */
import type { TrackingType } from '../../../db/catalogTypes'
import { stableId } from '../../../db/stableId'
import type { NewRow, Repo } from '../../../db/repo'
import type { CustomExercise, ExerciseSet, SessionExercise, TrainingSession } from '../../../db/types'
import { APP_TZ } from '../../../domain/dates'
import { withSetKind, type SetKind } from '../../../domain/setKind'
import { parseCsv, parseLooseNumber, toRecords } from './csv'
import { nameKey } from './matchExercise'

export type TrainingSource = 'hevy' | 'strong'
export type WeightUnit = 'kg' | 'lb'
export const SOURCE_LABEL: Record<TrainingSource, string> = { hevy: 'Hevy', strong: 'Strong' }

export interface ParsedSet {
  kind: SetKind
  weightKg: number | null
  reps: number | null
  durationSec: number | null
  distanceM: number | null
  rpe: number | null
}
export interface ParsedExercise {
  name: string
  key: string
  notes: string
  sets: ParsedSet[]
}
export interface ParsedWorkout {
  source: TrainingSource
  /** ISO instant of the start (local time read as America/Bogota). */
  startedAt: string
  date: string
  name: string
  notes: string
  durationMin: number | null
  exercises: ParsedExercise[]
}
export interface ParseOk {
  ok: true
  source: TrainingSource
  workouts: ParsedWorkout[]
  /** Weight unit used, and whether the file said so itself. */
  unit: WeightUnit
  unitFromFile: boolean
  rows: number
  skippedRows: number
  warnings: string[]
}
export type ParseResult = ParseOk | { ok: false; error: string }

// ───────────── dates ─────────────

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
}
const monthOf = (s: string): number | null => MONTHS[s.toLowerCase().replace(/\./g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 4)] ?? MONTHS[s.toLowerCase().slice(0, 3)] ?? null

export interface LocalStamp {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

/** Reads "2026-05-11 18:30[:00]", "16 Nov 2026, 18:30", "Nov 16, 2026, 6:30 PM" (and Spanish month names). */
export function parseLocalDateTime(input: string): LocalStamp | null {
  const t = input.trim()
  let m: RegExpExecArray | null
  let y: number, mo: number | null, d: number, h: number, mi: number, s: number, ap: string | undefined
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t))) {
    ;[y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]
  } else if ((m = /^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(t))) {
    ;[d, mo, y, h, mi, s, ap] = [+m[1]!, monthOf(m[2]!), +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0), m[7]]
  } else if ((m = /^([A-Za-zÀ-ÿ.]+)\s+(\d{1,2}),?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(t))) {
    ;[mo, d, y, h, mi, s, ap] = [monthOf(m[1]!), +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0), m[7]]
  } else return null
  if (mo === null || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (ap) {
    const pm = ap.toLowerCase().startsWith('p')
    if (h < 1 || h > 12) return null
    h = (h % 12) + (pm ? 12 : 0)
  }
  if (h > 23 || mi > 59 || s > 59) return null
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCMonth() !== mo - 1) return null
  return { y, mo, d, h, mi, s }
}

const BOGOTA_OFFSET_H = 5
const pad = (n: number) => String(n).padStart(2, '0')
export const stampDate = (t: LocalStamp): string => `${t.y}-${pad(t.mo)}-${pad(t.d)}`
/** Local America/Bogota wall time → UTC ISO instant (Bogota has no DST). */
export const stampToIso = (t: LocalStamp): string => new Date(Date.UTC(t.y, t.mo - 1, t.d, t.h + BOGOTA_OFFSET_H, t.mi, t.s)).toISOString()
void APP_TZ

/** "1h 2m", "62m", "45s", "01:02:00", "1:02" (h:mm), "3720" (seconds) → minutes, or null. */
export function parseDurationMin(input: string | undefined): number | null {
  const t = (input ?? '').trim().toLowerCase()
  if (!t) return null
  let m: RegExpExecArray | null
  let sec: number | null = null
  if ((m = /^(\d+):(\d{2}):(\d{2})$/.exec(t))) sec = +m[1]! * 3600 + +m[2]! * 60 + +m[3]!
  else if ((m = /^(\d+):(\d{2})$/.exec(t))) sec = +m[1]! * 3600 + +m[2]! * 60
  else if ((m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/.exec(t)) && (m[1] || m[2] || m[3])) sec = +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0)
  else if (/^\d+$/.test(t)) sec = +t
  return sec !== null && sec > 0 ? Math.max(1, Math.round(sec / 60)) : null
}

// ───────────── parsing ─────────────

const LB_KG = 0.45359237
const round2 = (n: number) => Math.round(n * 100) / 100
const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null)

export function detectSource(headers: readonly string[]): TrainingSource | null {
  const h = new Set(headers.map((x) => x.toLowerCase()))
  if (h.has('exercise_title') && h.has('start_time')) return 'hevy'
  if (h.has('exercise name') && h.has('set order') && h.has('date')) return 'strong'
  return null
}

const HEVY_KIND: Record<string, SetKind> = { normal: 'normal', warmup: 'warmup', warm_up: 'warmup', failure: 'failure', dropset: 'drop', drop_set: 'drop', drop: 'drop' }
const STRONG_KIND: Record<string, SetKind> = { w: 'warmup', d: 'drop', f: 'failure' }

interface Collector {
  workouts: Map<string, ParsedWorkout>
  exIndex: Map<string, ParsedExercise>
}
function addSet(c: Collector, wkey: string, w: () => ParsedWorkout, exName: string, exNotes: string, set: ParsedSet) {
  let wk = c.workouts.get(wkey)
  if (!wk) {
    wk = w()
    c.workouts.set(wkey, wk)
  }
  const key = nameKey(exName)
  const ek = `${wkey}\u0000${key}`
  let ex = c.exIndex.get(ek)
  if (!ex) {
    ex = { name: exName.trim(), key, notes: '', sets: [] }
    c.exIndex.set(ek, ex)
    wk.exercises.push(ex)
  }
  if (exNotes && !ex.notes) ex.notes = exNotes
  ex.sets.push(set)
}

export function parseTrainingCsv(text: string, opts: { unit?: WeightUnit } = {}): ParseResult {
  const rows = parseCsv(text)
  if (rows.length < 2) return { ok: false, error: 'El archivo está vacío o no tiene filas de series.' }
  const { headers, records } = toRecords(rows)
  const source = detectSource(headers)
  if (!source) return { ok: false, error: 'No reconozco este CSV. Usa el archivo que exporta Hevy («Exportar entrenamientos») o Strong («Exportar datos de Strong»).' }
  const col = (r: Record<string, string>, name: string): string => {
    const k = Object.keys(r).find((x) => x.toLowerCase() === name)
    return k ? (r[k] ?? '') : ''
  }
  const lower = headers.map((h) => h.toLowerCase())
  const warnings: string[] = []
  let skipped = 0
  let badDates = 0
  const c: Collector = { workouts: new Map(), exIndex: new Map() }

  // Weight unit: from the header when it says so, otherwise the person's choice (default kg).
  let fileUnit: WeightUnit | null = null
  let weightCol = ''
  let distCol = ''
  if (source === 'hevy') {
    weightCol = lower.find((h) => /^weight_(kg|lbs?)$/.test(h)) ?? 'weight_kg'
    fileUnit = /lb/.test(weightCol) ? 'lb' : 'kg'
    distCol = lower.find((h) => /^distance_(km|miles?|mi)$/.test(h)) ?? 'distance_km'
  } else {
    weightCol = lower.find((h) => /^weight(\s*\((kg|lbs?)\))?$/.test(h)) ?? 'weight'
    const m = /\((kg|lbs?)\)/.exec(weightCol)
    fileUnit = m ? (m[1] === 'kg' ? 'kg' : 'lb') : null
    distCol = lower.find((h) => /^distance/.test(h)) ?? 'distance'
  }
  const unit: WeightUnit = fileUnit ?? opts.unit ?? 'kg'
  const toKg = (n: number | null): number | null => (n === null ? null : round2(unit === 'lb' ? n * LB_KG : n))

  for (const r of records) {
    const exName = source === 'hevy' ? col(r, 'exercise_title') : col(r, 'exercise name')
    if (!exName) {
      skipped++
      continue
    }
    let startedAt: ParsedWorkout['startedAt']
    let date: string
    let wname: string
    let wnotes: string
    let durationMin: number | null
    let set: ParsedSet
    let exNotes = ''
    let wkey: string
    if (source === 'hevy') {
      const st = parseLocalDateTime(col(r, 'start_time'))
      if (!st) {
        badDates++
        continue
      }
      const en = parseLocalDateTime(col(r, 'end_time'))
      startedAt = stampToIso(st)
      date = stampDate(st)
      wname = col(r, 'title') || 'Entrenamiento'
      wnotes = col(r, 'description')
      durationMin = en ? positive(Math.round((Date.parse(stampToIso(en)) - Date.parse(startedAt)) / 60000)) : null
      exNotes = col(r, 'exercise_notes')
      const kind = HEVY_KIND[col(r, 'set_type').toLowerCase()] ?? 'normal'
      const dist = parseLooseNumber(col(r, distCol))
      set = {
        kind,
        weightKg: toKg(positive(parseLooseNumber(col(r, weightCol)))),
        reps: positive(parseLooseNumber(col(r, 'reps'))),
        durationSec: positive(parseLooseNumber(col(r, 'duration_seconds'))),
        distanceM: dist && dist > 0 ? Math.round(dist * (/mi/.test(distCol) ? 1609.344 : 1000)) : null,
        rpe: positive(parseLooseNumber(col(r, 'rpe'))),
      }
      wkey = `${col(r, 'start_time')}|${wname}`
    } else {
      const order = col(r, 'set order').trim()
      if (/rest/i.test(order)) {
        skipped++
        continue
      }
      const st = parseLocalDateTime(col(r, 'date'))
      if (!st) {
        badDates++
        continue
      }
      startedAt = stampToIso(st)
      date = stampDate(st)
      wname = col(r, 'workout name') || 'Entrenamiento'
      wnotes = col(r, 'workout notes')
      durationMin = parseDurationMin(col(r, 'duration'))
      exNotes = ''
      const dist = parseLooseNumber(col(r, distCol))
      set = {
        kind: STRONG_KIND[order.toLowerCase()] ?? 'normal',
        weightKg: toKg(positive(parseLooseNumber(col(r, weightCol)))),
        reps: positive(parseLooseNumber(col(r, 'reps'))),
        durationSec: positive(parseLooseNumber(col(r, 'seconds'))),
        distanceM: dist && dist > 0 ? Math.round(dist) : null,
        rpe: positive(parseLooseNumber(col(r, 'rpe'))),
      }
      const setNote = col(r, 'notes')
      if (setNote) exNotes = setNote
      wkey = `${col(r, 'date')}|${wname}`
    }
    if (set.weightKg === null && set.reps === null && set.durationSec === null && set.distanceM === null) {
      skipped++
      continue
    }
    addSet(c, wkey, () => ({ source, startedAt, date, name: wname, notes: wnotes, durationMin, exercises: [] }), exName, exNotes, set)
  }
  if (badDates) warnings.push(`${badDates} filas con fecha no reconocida se omitieron.`)
  const workouts = [...c.workouts.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  // Two workouts at the very same minute would share an id: keep the first and say so.
  const seen = new Set<string>()
  const unique = workouts.filter((w) => {
    if (seen.has(w.startedAt)) {
      warnings.push(`Dos entrenamientos empiezan a la misma hora (${w.date}); se omitió el segundo.`)
      return false
    }
    seen.add(w.startedAt)
    return true
  })
  if (!unique.length) return { ok: false, error: 'No encontré series válidas en el archivo.' }
  return { ok: true, source, workouts: unique, unit, unitFromFile: fileUnit !== null, rows: records.length, skippedRows: skipped, warnings }
}

// ───────────── plan ─────────────

export type ExerciseChoice =
  | { kind: 'library'; exerciseId: string; name: string; trackingType: TrackingType }
  | { kind: 'create' }
  | { kind: 'skip' }

export interface ImportPlan {
  sessions: NewRow<TrainingSession>[]
  sets: NewRow<ExerciseSet>[]
  customs: NewRow<CustomExercise>[]
  newSessions: number
  knownSessions: number
  /** Sessions with nothing left after skipping exercises. */
  emptySessions: number
  newSets: number
  skippedSets: number
}

const REST: Record<TrackingType, number> = { weight_reps: 120, bodyweight_reps: 90, time: 60, distance: 0 }

function guessTracking(ex: ParsedExercise): TrackingType {
  const any = (f: (s: ParsedSet) => boolean) => ex.sets.some(f)
  if (any((s) => s.distanceM !== null)) return 'distance'
  if (any((s) => s.reps !== null)) return any((s) => s.weightKg !== null) ? 'weight_reps' : 'bodyweight_reps'
  return any((s) => s.durationSec !== null) ? 'time' : 'weight_reps'
}

export const sessionIdFor = (profileId: string, source: TrainingSource, startedAt: string): string => stableId(`csv|${source}|${profileId}|${startedAt}`)

export function planTrainingImport(
  workouts: readonly ParsedWorkout[],
  profileId: string,
  choices: Readonly<Record<string, ExerciseChoice>>,
  existingSessionIds: ReadonlySet<string>,
  existingCustomIds: ReadonlySet<string> = new Set(),
): ImportPlan {
  const plan: ImportPlan = { sessions: [], sets: [], customs: [], newSessions: 0, knownSessions: 0, emptySessions: 0, newSets: 0, skippedSets: 0 }
  const customSeen = new Map<string, { exerciseId: string; trackingType: TrackingType }>()
  for (const w of workouts) {
    const sid = sessionIdFor(profileId, w.source, w.startedAt)
    if (existingSessionIds.has(sid)) {
      plan.knownSessions++
      continue
    }
    const order: SessionExercise[] = []
    const sets: NewRow<ExerciseSet>[] = []
    for (const ex of w.exercises) {
      const ch = choices[ex.key] ?? { kind: 'create' as const }
      if (ch.kind === 'skip') {
        plan.skippedSets += ex.sets.length
        continue
      }
      let exerciseId: string
      let name: string
      let tracking: TrackingType
      if (ch.kind === 'library') {
        ;({ exerciseId, name, trackingType: tracking } = ch)
      } else {
        const prev = customSeen.get(ex.key)
        const cid = stableId(`csv|custom|${profileId}|${ex.key}`)
        tracking = prev?.trackingType ?? guessTracking(ex)
        exerciseId = `custom:${cid}`
        name = ex.name
        if (!prev) {
          customSeen.set(ex.key, { exerciseId, trackingType: tracking })
          if (!existingCustomIds.has(cid))
            plan.customs.push({
              id: cid,
              nameEs: ex.name,
              aliases: [],
              primaryMuscles: [],
              secondaryMuscles: [],
              equipment: null,
              category: tracking === 'time' || tracking === 'distance' ? 'cardio' : 'strength',
              trackingType: tracking,
              instructionsEs: [],
            })
        }
      }
      if (order.some((o) => o.exerciseId === exerciseId)) {
        // Two source exercises mapped to the same library exercise: sets are appended after the existing ones.
        const base = sets.filter((s) => s.exerciseId === exerciseId).length
        ex.sets.forEach((s, i) => sets.push(setRow(sid, w, exerciseId, name, base + i, s)))
        continue
      }
      order.push({ exerciseId, name, trackingType: tracking, restSec: REST[tracking], ...(ex.notes ? { notes: ex.notes } : {}) })
      ex.sets.forEach((s, i) => sets.push(setRow(sid, w, exerciseId, name, i, s)))
    }
    if (!sets.length) {
      plan.emptySessions++
      continue
    }
    const endedAt = w.durationMin ? new Date(Date.parse(w.startedAt) + w.durationMin * 60000).toISOString() : null
    plan.sessions.push({
      id: sid,
      date: w.date,
      name: w.name,
      routineId: null,
      status: 'done',
      startedAt: w.startedAt,
      endedAt,
      restEndsAt: null,
      exerciseOrder: order,
      notes: [w.notes, `Importado de ${SOURCE_LABEL[w.source]} (CSV)`].filter(Boolean).join('\n'),
      durationMin: w.durationMin,
      origin: 'app',
      sourceRef: `csv:${w.source}`,
    })
    plan.sets.push(...sets)
    plan.newSessions++
    plan.newSets += sets.length
  }
  return plan
}

function setRow(sid: string, w: ParsedWorkout, exerciseId: string, exerciseName: string, setIndex: number, s: ParsedSet): NewRow<ExerciseSet> {
  const row: NewRow<ExerciseSet> = {
    id: stableId(`${sid}|${exerciseId}|${setIndex}`),
    sessionId: sid,
    date: w.date,
    exerciseId,
    exerciseName,
    setIndex,
    weight: s.weightKg,
    reps: s.reps,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    rpe: s.rpe,
    isWarmup: false,
    done: true,
    origin: 'app',
    sourceRef: `csv:${w.source}`,
  }
  return withSetKind(row, s.kind)
}

// ───────────── apply / undo ─────────────

export interface ImportReceipt {
  source: TrainingSource
  sessionIds: string[]
  setIds: string[]
  customIds: string[]
}

/** Writes the plan in ONE transaction. Rows that already exist (same ids) are never touched. */
export async function applyTrainingImport(r: Repo, plan: ImportPlan, source: TrainingSource): Promise<ImportReceipt> {
  const db = r.db
  return db.transaction('rw', [db.trainingSessions, db.exerciseSets, db.customExercises], async () => {
    const have = new Set((await db.trainingSessions.bulkGet(plan.sessions.map((s) => s.id!))).filter(Boolean).map((s) => s!.id))
    const sessions = plan.sessions.filter((s) => !have.has(s.id!))
    const ids = new Set(sessions.map((s) => s.id))
    const sets = plan.sets.filter((s) => ids.has(s.sessionId))
    const haveC = new Set((await db.customExercises.bulkGet(plan.customs.map((c) => c.id!))).filter(Boolean).map((c) => c!.id))
    const customs = plan.customs.filter((c) => !haveC.has(c.id!))
    await r.bulkPut('customExercises', customs)
    await r.bulkPut('trainingSessions', sessions)
    await r.bulkPut('exerciseSets', sets)
    return { source, sessionIds: sessions.map((s) => s.id!), setIds: sets.map((s) => s.id!), customIds: customs.map((c) => c.id!) }
  })
}

/** Removes exactly what a receipt created (sets, sessions and the custom exercises it added). */
export async function undoTrainingImport(r: Repo, receipt: ImportReceipt): Promise<void> {
  const db = r.db
  await db.transaction('rw', [db.trainingSessions, db.exerciseSets, db.customExercises], async () => {
    await r.removeMany('exerciseSets', receipt.setIds)
    await r.removeMany('trainingSessions', receipt.sessionIds)
    await r.removeMany('customExercises', receipt.customIds)
  })
}
