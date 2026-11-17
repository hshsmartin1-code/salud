/**
 * Muscle recovery guide (pure, no React, no I/O). Sources and reasoning: docs/V3_MUSCLE_RECOVERY.md.
 *
 * This is a general guide computed from the person's own log and population-level research. It does not
 * measure their actual recovery, soreness, sleep or nutrition. No score, no percentage.
 *
 * Inputs are the `Prepared` stats of trainingStats.ts, so the same rules apply as everywhere else:
 * finished sessions only, sessions and sets flagged `excludeFromStats` ignored, warm-ups excluded
 * (setKind), undone sets ignored.
 */
import type { TrainingSession } from '../../../db/types'
import { MUSCLE_IDS, MUSCLE_TO_GROUP, type MuscleGroupId } from '../muscles'
import type { CatalogMuscles, Prepared } from '../trainingStats'

const HOUR_MS = 3_600_000

/** A set counts 1 for each primary muscle of its exercise and this much for each secondary one. */
export const SECONDARY_WEIGHT = 0.5
/** Effective sets a session must reach on a muscle to count as a stimulus for it. */
export const MIN_STIMULUS_SETS = 1
/** Under this many hours since the stimulus the muscle is "recent". */
export const RECENT_HOURS = 24
/**
 * Default window. Myofibrillar/mixed protein synthesis stays raised ~24–48 h (MacDougall 1995: near
 * baseline by ~36 h; Phillips 1997: still +34 % at 48 h) and non-failure protocols recovered force
 * between 24 and 48 h (Morán-Navarro 2017).
 */
export const BASE_WINDOW_HOURS = 48
/**
 * Extended window after a high-volume session for that muscle. Protocols of 8–10 sets for one muscle
 * still showed strength deficits at 72 h or later (Bartolomei 2017: 8×10; Ferreira 2017: 8 sets to
 * failure, 96 h; Ferreira-Júnior 2021: 10×10RM). No study gives a set cut-off: 8 is the smallest set
 * count among those protocols, used as a heuristic, not a demonstrated threshold.
 */
export const EXTENDED_WINDOW_HOURS = 72
export const HIGH_SESSION_SETS = 8
/** After this long without a stimulus the muscle is shown as "rested" (neutral, never a warning). */
export const RESTED_AFTER_HOURS = 7 * 24
/** Weekly range from Baz-Valle et al. 2022 (12–20 sets per muscle per week; trained young men). */
export const WEEKLY_RANGE = { low: 12, high: 20 } as const

export type RecoveryState = 'recent' | 'recovering' | 'ready' | 'rested' | 'none'
/** Legend order (strongest first); 'rested' and 'none' share the neutral look. */
export const RECOVERY_LEGEND: readonly RecoveryState[] = ['recent', 'recovering', 'ready', 'rested']
export type WeeklyNote = 'below' | 'within' | 'above'

export interface ExerciseHit {
  exerciseId: string
  name: string
  role: 'primary' | 'secondary'
  /** Work sets of this exercise in the session. */
  sets: number
}

export interface MuscleRecovery {
  muscle: string
  state: RecoveryState
  /** Hours since the end of the last session that stimulated the muscle (null: none in the log). */
  hoursSince: number | null
  lastSession: { id: string; name: string; date: string; at: string } | null
  /** Effective sets of that session for this muscle. */
  lastSessionSets: number
  /** Exercises of that session that hit the muscle. */
  exercises: ExerciseHit[]
  /** Window applied to the last session (48 or 72 h), 0 when there is none. */
  windowHours: number
  /** Effective sets in the last 7 days (rolling, up to `now`). */
  weekSets: number
  weekNote: WeeklyNote | null
}

/** Moment a session ended (or started; or noon of its date when it has neither). */
export function sessionInstant(s: Pick<TrainingSession, 'endedAt' | 'startedAt' | 'date'>): number {
  const t = Date.parse(s.endedAt ?? s.startedAt ?? `${s.date}T12:00:00`)
  return Number.isFinite(t) ? t : Date.parse(`${s.date}T12:00:00`)
}

export const windowFor = (sets: number): number => (sets >= HIGH_SESSION_SETS ? EXTENDED_WINDOW_HOURS : BASE_WINDOW_HOURS)

export function stateFor(hours: number | null, windowHours: number): RecoveryState {
  if (hours === null) return 'none'
  if (hours < RECENT_HOURS) return 'recent'
  if (hours < windowHours) return 'recovering'
  if (hours <= RESTED_AFTER_HOURS) return 'ready'
  return 'rested'
}

export function weeklyNote(sets: number): WeeklyNote | null {
  if (sets <= 0) return null
  return sets < WEEKLY_RANGE.low ? 'below' : sets <= WEEKLY_RANGE.high ? 'within' : 'above'
}

interface SessionLoad {
  session: TrainingSession
  at: number
  sets: Map<string, number>
  hits: Map<string, ExerciseHit[]>
}

function loadOf(p: Prepared, s: TrainingSession, catalog: CatalogMuscles): SessionLoad {
  const sets = new Map<string, number>()
  const perExercise = new Map<string, { name: string; n: number }>()
  for (const x of p.setsBySession.get(s.id) ?? []) {
    const e = catalog.get(x.exerciseId)
    if (!e) continue
    const prim = new Set(e.primaryMuscles)
    for (const m of prim) sets.set(m, (sets.get(m) ?? 0) + 1)
    for (const m of new Set(e.secondaryMuscles)) if (!prim.has(m)) sets.set(m, (sets.get(m) ?? 0) + SECONDARY_WEIGHT)
    const ex = perExercise.get(x.exerciseId)
    if (ex) ex.n++
    else perExercise.set(x.exerciseId, { name: x.exerciseName, n: 1 })
  }
  const hits = new Map<string, ExerciseHit[]>()
  for (const [exerciseId, { name, n }] of perExercise) {
    const e = catalog.get(exerciseId)!
    const add = (m: string, role: ExerciseHit['role']) => hits.set(m, [...(hits.get(m) ?? []), { exerciseId, name, role, sets: n }])
    for (const m of new Set(e.primaryMuscles)) add(m, 'primary')
    for (const m of new Set(e.secondaryMuscles)) if (!e.primaryMuscles.includes(m)) add(m, 'secondary')
  }
  return { session: s, at: sessionInstant(s), sets, hits }
}

/**
 * Recovery guide for every catalog muscle id. Sessions after `now` are ignored. Sets of exercises missing
 * from the catalog contribute nothing (their muscles are unknown).
 */
export function computeRecovery(p: Prepared, catalog: CatalogMuscles, now: number): Map<string, MuscleRecovery> {
  const loads = p.sessions
    .map((s) => loadOf(p, s, catalog))
    .filter((l) => l.at <= now)
    .sort((a, b) => b.at - a.at)
  const weekFrom = now - 7 * 24 * HOUR_MS
  const out = new Map<string, MuscleRecovery>()
  for (const muscle of MUSCLE_IDS) {
    const last = loads.find((l) => (l.sets.get(muscle) ?? 0) >= MIN_STIMULUS_SETS) ?? null
    const weekSets = loads.filter((l) => l.at > weekFrom).reduce((a, l) => a + (l.sets.get(muscle) ?? 0), 0)
    const hoursSince = last ? (now - last.at) / HOUR_MS : null
    const lastSessionSets = last?.sets.get(muscle) ?? 0
    const windowHours = last ? windowFor(lastSessionSets) : 0
    out.set(muscle, {
      muscle,
      state: stateFor(hoursSince, windowHours),
      hoursSince,
      lastSession: last ? { id: last.session.id, name: last.session.name, date: last.session.date, at: new Date(last.at).toISOString() } : null,
      lastSessionSets,
      exercises: last?.hits.get(muscle) ?? [],
      windowHours,
      weekSets,
      weekNote: weeklyNote(weekSets),
    })
  }
  return out
}

// ───────────── Spanish text ─────────────

export const STATE_LABEL: Record<RecoveryState, string> = {
  recent: 'Menos de 24 h',
  recovering: 'En ventana',
  ready: 'Ventana cumplida',
  rested: 'Más de 7 días',
  none: 'Sin registros',
}

/** "6", "6,5". */
export const formatSets = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

/** "hace 26 h" under 48 h, "hace 3 d" after. */
export function agoText(hours: number): string {
  if (hours < 1) return 'hace menos de 1 h'
  if (hours < 48) return `hace ${Math.floor(hours)} h`
  return `hace ${Math.floor(hours / 24)} d`
}

/** The rule applied, in plain words: "Ventana orientativa de 48 h tras 6 series". */
export function ruleText(r: MuscleRecovery): string {
  if (!r.lastSession) return 'Sin sesiones registradas que trabajen este músculo.'
  const sets = formatSets(r.lastSessionSets)
  const base = `Ventana orientativa de ${r.windowHours} h tras ${sets} ${r.lastSessionSets === 1 ? 'serie' : 'series'}`
  return r.windowHours === EXTENDED_WINDOW_HOURS ? `${base} (${HIGH_SESSION_SETS} o más en la sesión amplían la ventana)` : base
}

export function weeklyText(r: Pick<MuscleRecovery, 'weekSets' | 'weekNote'>): string {
  const n = `${formatSets(r.weekSets)} ${r.weekSets === 1 ? 'serie' : 'series'} en 7 días`
  switch (r.weekNote) {
    case 'below':
      return `${n} · por debajo del rango de ${WEEKLY_RANGE.low}–${WEEKLY_RANGE.high} de la revisión de referencia`
    case 'within':
      return `${n} · dentro del rango de ${WEEKLY_RANGE.low}–${WEEKLY_RANGE.high} de la revisión de referencia`
    case 'above':
      return `${n} · por encima del rango de ${WEEKLY_RANGE.low}–${WEEKLY_RANGE.high} de la revisión de referencia`
    default:
      return n
  }
}

/** Lower-case state for spoken names: "Cuádriceps, ventana cumplida, hace 2 días". */
export const STATE_SPOKEN: Record<RecoveryState, string> = {
  recent: 'menos de 24 horas',
  recovering: 'en ventana',
  ready: 'ventana cumplida',
  rested: 'más de 7 días',
  none: 'sin registros',
}

/** "hace 26 horas" under 48 h, "hace 3 días" after (for accessible names). */
export function agoSpoken(hours: number): string {
  if (hours < 1) return 'hace menos de 1 hora'
  if (hours < 48) return `hace ${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hora' : 'horas'}`
  return `hace ${Math.floor(hours / 24)} días`
}

export function spokenName(label: string, r: Pick<MuscleRecovery, 'state' | 'hoursSince'>): string {
  return r.hoursSince === null ? `${label}, ${STATE_SPOKEN.none}` : `${label}, ${STATE_SPOKEN[r.state]}, ${agoSpoken(r.hoursSince)}`
}

/** Compact summary rows: the app's groups, with legs and glutes together. */
export const SUMMARY_GROUPS: readonly { id: string; label: string; groups: readonly MuscleGroupId[] }[] = [
  { id: 'chest', label: 'Pecho', groups: ['chest'] },
  { id: 'back', label: 'Espalda', groups: ['back'] },
  { id: 'shoulders', label: 'Hombros', groups: ['shoulders'] },
  { id: 'arms', label: 'Brazos', groups: ['arms'] },
  { id: 'core', label: 'Core', groups: ['core'] },
  { id: 'legs', label: 'Piernas y glúteos', groups: ['legs', 'glutes'] },
]

const STATE_RANK: Record<RecoveryState, number> = { recent: 0, recovering: 1, ready: 2, rested: 3, none: 4 }

export interface GroupSummary {
  id: string
  label: string
  muscles: MuscleRecovery[]
  /** Strongest (most recent) state among the muscles. */
  state: RecoveryState
  /** Hours since the most recent stimulus of any muscle of the group (null: none). */
  hoursSince: number | null
}

export function summarizeGroups(rec: ReadonlyMap<string, MuscleRecovery>): GroupSummary[] {
  return SUMMARY_GROUPS.map((g) => {
    const muscles = [...rec.values()].filter((r) => g.groups.includes(MUSCLE_TO_GROUP[r.muscle]!))
    const state = muscles.reduce<RecoveryState>((best, r) => (STATE_RANK[r.state] < STATE_RANK[best] ? r.state : best), 'none')
    const hours = muscles.map((r) => r.hoursSince).filter((h): h is number => h !== null)
    return { id: g.id, label: g.label, muscles, state, hoursSince: hours.length ? Math.min(...hours) : null }
  })
}
