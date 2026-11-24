/**
 * Training-home statistics (pure, no React, no I/O).
 *
 * Everything is derived from FINISHED sessions and their DONE work sets:
 *  - sessions still active, or flagged `excludeFromStats`, never count;
 *  - warm-ups are excluded through `setKind` (drop and failure sets are work sets);
 *  - sets flagged `excludeFromStats`, not done, or whose session is not counted (orphans) are ignored.
 * A set belongs to the week of its SESSION's date.
 */
import type { ExerciseSet, Routine, TrainingSession } from '../../db/types'
import { addDays, daysBetween, isoWeekStart } from '../../domain/dates'
import { isWorkSet } from '../../domain/setKind'
import { bestSet, e1rm, sessionVolume } from '../../domain/training'
import type { PRType } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { groupOfMuscle, setsPerMuscle, type MuscleGroupId, type MuscleSets } from './muscles'
import { formatDuration, PR_LABEL, prsBySet } from './sets'

export type CatalogMuscles = ReadonlyMap<string, { primaryMuscles: readonly string[]; secondaryMuscles: readonly string[] }>

// ───────────── what counts ─────────────

export const isCountedSession = (s: Pick<TrainingSession, 'status' | 'excludeFromStats'>): boolean => s.status === 'done' && !s.excludeFromStats
const isCountedSet = (s: ExerciseSet): boolean => s.done && !s.excludeFromStats && isWorkSet(s)
/** Minutes of a session, only when it has a real duration. */
export const sessionMinutes = (s: Pick<TrainingSession, 'durationMin'>): number | null =>
  typeof s.durationMin === 'number' && Number.isFinite(s.durationMin) && s.durationMin > 0 ? s.durationMin : null

const startKey = (s: Pick<TrainingSession, 'startedAt' | 'createdAt'>) => s.startedAt ?? s.createdAt ?? ''
/** Newest first: date, then start time, then id (stable). */
export const byNewest = (a: TrainingSession, b: TrainingSession): number =>
  a.date !== b.date ? (a.date < b.date ? 1 : -1) : startKey(a) !== startKey(b) ? (startKey(a) < startKey(b) ? 1 : -1) : a.id < b.id ? 1 : -1

export interface Prepared {
  /** Counted sessions, newest first. */
  sessions: TrainingSession[]
  /** Counted work sets of counted sessions, grouped by session. */
  setsBySession: Map<string, ExerciseSet[]>
}

export function prepareStats(sessions: readonly TrainingSession[], sets: readonly ExerciseSet[]): Prepared {
  const counted = sessions.filter(isCountedSession).sort(byNewest)
  const ids = new Set(counted.map((s) => s.id))
  const setsBySession = new Map<string, ExerciseSet[]>()
  for (const s of sets) {
    if (!ids.has(s.sessionId) || !isCountedSet(s)) continue
    const list = setsBySession.get(s.sessionId)
    if (list) list.push(s)
    else setsBySession.set(s.sessionId, [s])
  }
  return { sessions: counted, setsBySession }
}

const workSetsOf = (p: Prepared, s: TrainingSession): ExerciseSet[] => p.setsBySession.get(s.id) ?? []

// ───────────── weeks ─────────────

export interface WeekSummary {
  /** Monday of the ISO week. */
  weekStart: string
  weekEnd: string
  sessions: number
  workSets: number
  /** kg (weight × reps of work sets). */
  volume: number
  /** Minutes, summed over the sessions that have a duration only. */
  durationMin: number
  /** Sessions that contribute to `durationMin`. */
  timedSessions: number
  /** Sessions with no duration (not part of `durationMin`). */
  untimedSessions: number
}

export function weekSummary(p: Prepared, anyDateOfWeek: string, through?: string): WeekSummary {
  const weekStart = isoWeekStart(anyDateOfWeek)
  const weekEnd = addDays(weekStart, 6)
  const out: WeekSummary = { weekStart, weekEnd, sessions: 0, workSets: 0, volume: 0, durationMin: 0, timedSessions: 0, untimedSessions: 0 }
  for (const s of p.sessions) {
    if (s.date < weekStart || s.date > weekEnd || (through !== undefined && s.date > through)) continue
    const sets = workSetsOf(p, s)
    out.sessions++
    out.workSets += sets.length
    out.volume += sessionVolume(sets)
    const m = sessionMinutes(s)
    if (m === null) out.untimedSessions++
    else {
      out.durationMin += m
      out.timedSessions++
    }
  }
  return out
}

/**
 * The week of `today` so far, the previous week up to the SAME weekday (Monday through that weekday, inclusive:
 * the rule of the "training-behind" insight of Hoy) and the previous week in full. A week that has just started
 * is never compared with a whole one: on a Sunday the two comparable halves are both complete weeks.
 */
export function weekToDate(p: Prepared, today: string): { week: WeekSummary; previous: WeekSummary; previousFull: WeekSummary } {
  const week = weekSummary(p, today)
  const lastStart = addDays(week.weekStart, -7)
  return {
    week,
    previous: weekSummary(p, lastStart, addDays(lastStart, daysBetween(week.weekStart, today))),
    previousFull: weekSummary(p, lastStart),
  }
}

/**
 * `count` consecutive weeks ending at the week of `endDate`, oldest first, empty weeks included (a week
 * without training is a real zero). Weeks before the first counted session are dropped: the app has no
 * data there, so they must not be drawn as zero.
 */
export function weeklySeries(p: Prepared, endDate: string, count = 10): WeekSummary[] {
  const end = isoWeekStart(endDate)
  const oldest = p.sessions.length ? isoWeekStart(p.sessions[p.sessions.length - 1]!.date) : null
  if (oldest === null) return []
  const out: WeekSummary[] = []
  for (let i = count - 1; i >= 0; i--) {
    const w = addDays(end, -7 * i)
    if (w < oldest) continue
    out.push(weekSummary(p, w))
  }
  return out
}

/**
 * Mean weekly volume over the COMPLETE weeks of a series. The week of `today` is still in progress (it ends on
 * its Sunday): it is neither averaged nor counted as a zero week, so a Monday with no session yet cannot pull the
 * mean down. `weeks` is a `weeklySeries` result (oldest first).
 */
export function weeklyVolumeMean(weeks: readonly WeekSummary[], today: string): { complete: WeekSummary[]; inProgress: WeekSummary | null; mean: number | null; trained: number } {
  const complete = weeks.filter((w) => w.weekEnd < today)
  const inProgress = weeks.find((w) => w.weekEnd >= today && w.weekStart <= today) ?? null
  return {
    complete,
    inProgress,
    mean: complete.length ? complete.reduce((a, w) => a + w.volume, 0) / complete.length : null,
    trained: complete.filter((w) => w.sessions > 0).length,
  }
}

export interface GroupSets {
  group: MuscleGroupId
  sets: number
}

/**
 * Work sets per muscle group in a week, PRIMARY muscle only. A set counts once for each group one of
 * its primary muscles belongs to (an exercise with two primary muscles of the same group does not count
 * twice). `perMuscle` is the raw `setsPerMuscle` result for anyone who wants the detail.
 */
export function workSetsPerGroup(p: Prepared, weekDate: string, catalog: CatalogMuscles): { groups: GroupSets[]; perMuscle: MuscleSets[] } {
  const start = isoWeekStart(weekDate)
  const end = addDays(start, 6)
  const sets: ExerciseSet[] = []
  for (const s of p.sessions) if (s.date >= start && s.date <= end) sets.push(...workSetsOf(p, s))
  const acc = new Map<MuscleGroupId, number>()
  for (const s of sets) {
    const e = catalog.get(s.exerciseId)
    if (!e) continue
    for (const g of new Set(e.primaryMuscles.map(groupOfMuscle).filter((x): x is MuscleGroupId => x !== null))) acc.set(g, (acc.get(g) ?? 0) + 1)
  }
  const groups = [...acc.entries()].map(([group, n]) => ({ group, sets: n })).sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group))
  return { groups, perMuscle: setsPerMuscle(sets, catalog) }
}

// ───────────── records ─────────────

const PR_ORDER: PRType[] = ['max_weight', 'max_e1rm', 'max_reps_at_weight', 'max_volume_set', 'max_duration', 'max_distance']

/** Every set that set a record at the time it was done (setId → types). Warm-ups never do. */
export function allRecords(p: Prepared): Map<string, PRType[]> {
  const byExercise = new Map<string, ExerciseSet[]>()
  for (const list of p.setsBySession.values())
    for (const s of list) {
      const same = byExercise.get(s.exerciseId)
      if (same) same.push(s)
      else byExercise.set(s.exerciseId, [s])
    }
  const out = new Map<string, PRType[]>()
  for (const sets of byExercise.values()) for (const [id, types] of prsBySet(sets)) out.set(id, types)
  return out
}

/** Exercises that reached at least one record in each session (what the history rows call "récords"). */
export function recordCountBySession(p: Prepared, records: Map<string, PRType[]>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [sid, sets] of p.setsBySession) {
    const ex = new Set<string>()
    for (const s of sets) if (records.has(s.id)) ex.add(s.exerciseId)
    if (ex.size) out.set(sid, ex.size)
  }
  return out
}

export interface RecentRecord {
  exerciseId: string
  exerciseName: string
  type: PRType
  /** "Peso máximo", "1RM estimado"… */
  label: string
  value: number
  unit: string
  /** Ready to show: "85 kg", "9 reps con 80 kg", "0:45". */
  display: string
  date: string
  setId: string
  sessionId: string
}

function recordValue(type: PRType, s: ExerciseSet): { value: number; unit: string; display: string } | null {
  const w = s.weight ?? 0
  switch (type) {
    case 'max_weight':
      return { value: w, unit: 'kg', display: `${formatNumber(w, 2)} kg` }
    case 'max_e1rm': {
      const v = s.weight !== null && s.reps !== null ? e1rm(s.weight, s.reps) : null
      return v === null ? null : { value: v, unit: 'kg', display: `${formatNumber(Math.round(v * 2) / 2, 1)} kg` }
    }
    case 'max_reps_at_weight':
      return { value: s.reps ?? 0, unit: 'reps', display: `${s.reps ?? 0} reps con ${formatNumber(w, 2)} kg` }
    case 'max_volume_set':
      return { value: w * (s.reps ?? 0), unit: 'kg', display: `${formatNumber(w * (s.reps ?? 0), 0)} kg en una serie` }
    case 'max_duration':
      return { value: s.durationSec ?? 0, unit: 's', display: formatDuration(s.durationSec) }
    case 'max_distance':
      return { value: s.distanceM ?? 0, unit: 'm', display: `${formatNumber((s.distanceM ?? 0) / 1000, 2)} km` }
  }
}

/**
 * Records set in the `days` days up to `today` (inclusive), from `prsBySet`. One entry per exercise and
 * record type (the most recent one, which is also the highest), newest first.
 */
export function recentRecords(p: Prepared, records: Map<string, PRType[]>, today: string, days = 30): RecentRecord[] {
  const from = addDays(today, -(days - 1))
  const sessionDate = new Map(p.sessions.map((s) => [s.id, s.date]))
  const best = new Map<string, RecentRecord & { idx: number }>()
  for (const [sid, sets] of p.setsBySession) {
    const date = sessionDate.get(sid)!
    if (date < from || date > today) continue
    for (const s of sets) {
      for (const type of records.get(s.id) ?? []) {
        const v = recordValue(type, s)
        if (!v) continue
        const key = `${s.exerciseId}|${type}`
        const cur = best.get(key)
        if (cur && (cur.date > date || (cur.date === date && cur.idx >= s.setIndex))) continue
        best.set(key, { exerciseId: s.exerciseId, exerciseName: s.exerciseName, type, label: PR_LABEL[type], ...v, date, setId: s.id, sessionId: sid, idx: s.setIndex })
      }
    }
  }
  return [...best.values()]
    .map(({ idx: _idx, ...r }) => (void _idx, r))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : PR_ORDER.indexOf(a.type) - PR_ORDER.indexOf(b.type) || a.exerciseName.localeCompare(b.exerciseName)))
}

/** One record per exercise (its most recent, then the most telling type), newest first, at most `limit`. */
export function headlineRecords(records: readonly RecentRecord[], limit = 5): RecentRecord[] {
  if (limit <= 0) return []
  const seen = new Set<string>()
  const out: RecentRecord[] = []
  for (const r of records) {
    if (seen.has(r.exerciseId)) continue
    seen.add(r.exerciseId)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

// ───────────── routines ─────────────

export interface RoutineStats {
  exerciseCount: number
  /** Sum of the planned work sets (warm-ups not included). */
  plannedSets: number
  plannedWarmups: number
  /** Muscle groups of the routine's exercises (primary muscles), by planned work sets, largest first. */
  groups: GroupSets[]
  /** Date of the most recent finished session of this routine. */
  lastDate: string | null
  /** Finished sessions of this routine in the last 28 days. */
  timesLast4Weeks: number
  /** Finished sessions of this routine, ever. */
  sessionCount: number
  /** Median minutes of the (up to 8) latest timed sessions, only when at least 2 exist; otherwise null. */
  estimatedMin: number | null
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function routineStats(routine: Pick<Routine, 'id' | 'exercises'>, p: Prepared, today: string, catalog?: CatalogMuscles): RoutineStats {
  const mine = p.sessions.filter((s) => s.routineId === routine.id)
  const from = addDays(today, -27)
  const timed = mine.map(sessionMinutes).filter((m): m is number => m !== null).slice(0, 8)
  const acc = new Map<MuscleGroupId, number>()
  let plannedSets = 0
  let plannedWarmups = 0
  for (const e of routine.exercises) {
    const n = Math.max(0, Math.round(e.targetSets) || 0)
    plannedSets += n
    plannedWarmups += Math.max(0, Math.round(e.warmupSets ?? 0))
    const c = catalog?.get(e.exerciseId)
    if (!c) continue
    for (const g of new Set(c.primaryMuscles.map(groupOfMuscle).filter((x): x is MuscleGroupId => x !== null))) acc.set(g, (acc.get(g) ?? 0) + n)
  }
  return {
    exerciseCount: routine.exercises.length,
    plannedSets,
    plannedWarmups,
    groups: [...acc.entries()].map(([group, sets]) => ({ group, sets })).sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group)),
    lastDate: mine[0]?.date ?? null,
    timesLast4Weeks: mine.filter((s) => s.date >= from && s.date <= today).length,
    sessionCount: mine.length,
    estimatedMin: timed.length >= 2 ? Math.round(median(timed)) : null,
  }
}

/** Date of the latest finished session per routine id. */
export function lastUsedByRoutine(p: Prepared): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of p.sessions) if (s.routineId && !out.has(s.routineId)) out.set(s.routineId, s.date)
  return out
}

/** Most recent counted session of each routine, for "Iniciar <última rutina>": the routine of the newest session. */
export function lastUsedRoutineId(p: Prepared, usable: ReadonlySet<string>): string | null {
  for (const s of p.sessions) if (s.routineId && usable.has(s.routineId)) return s.routineId
  return null
}

export interface LastPerformance {
  date: string
  sessionId: string
  /** Work sets in order. */
  sets: ExerciseSet[]
  best: ExerciseSet | null
}

/** The latest counted session that has work sets of any of `exerciseIds`. */
export function lastExercisePerformance(p: Prepared, exerciseIds: readonly string[]): LastPerformance | null {
  const ids = new Set(exerciseIds)
  for (const s of p.sessions) {
    const sets = workSetsOf(p, s).filter((x) => ids.has(x.exerciseId)).sort((a, b) => a.setIndex - b.setIndex)
    if (sets.length) return { date: s.date, sessionId: s.id, sets, best: (bestSet(sets) as ExerciseSet | null) ?? null }
  }
  return null
}

// ───────────── history ─────────────

export interface SessionDigest {
  session: TrainingSession
  workSets: number
  volume: number
  minutes: number | null
  records: number
}

export function digestSessions(p: Prepared, records: Map<string, number>): SessionDigest[] {
  return p.sessions.map((session) => {
    const sets = workSetsOf(p, session)
    return { session, workSets: sets.length, volume: sessionVolume(sets), minutes: sessionMinutes(session), records: records.get(session.id) ?? 0 }
  })
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const monthKey = (date: string) => date.slice(0, 7)
/** "Noviembre 2026". */
export function monthLabel(key: string): string {
  const name = MONTHS[Number(key.slice(5, 7)) - 1] ?? key
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${key.slice(0, 4)}`
}

/** Groups rows (already newest first) by month, keeping their order. */
export function groupByMonth<T extends { session: Pick<TrainingSession, 'date'> }>(rows: readonly T[]): { key: string; label: string; rows: T[] }[] {
  const out: { key: string; label: string; rows: T[] }[] = []
  for (const r of rows) {
    const key = monthKey(r.session.date)
    const last = out[out.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else out.push({ key, label: monthLabel(key), rows: [r] })
  }
  return out
}

// ───────────── formatting ─────────────

/** 95 → "1:35" with unit "h"; under an hour → "48" with unit "min". */
export function formatMinutes(min: number): { value: string; unit: string } {
  const m = Math.round(min)
  if (m < 60) return { value: String(m), unit: 'min' }
  return { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, unit: 'h' }
}
/** "58 min", "1 h 35 min". */
export function minutesText(min: number): string {
  const m = Math.round(min)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// ───────────── V3.1: muscle split, totals, best lifts, history lines ─────────────

export interface MuscleShare {
  group: MuscleGroupId
  /** Work sets that touch this group (a set with primary muscles in two groups counts once in each). */
  sets: number
  /** 0..1 of the session's work sets (a set is shared equally between its groups, so shares add up to 1). */
  share: number
}

/**
 * "División muscular" of ONE session: the share of its completed work sets per muscle group (PRIMARY muscles
 * only, like `workSetsPerGroup`). Warm-ups, undone and excluded sets and exercises missing from the catalog do
 * not count. Largest first, ties by group id. Empty when nothing counts.
 */
export function sessionMuscleSplit(sets: readonly ExerciseSet[], catalog: CatalogMuscles): MuscleShare[] {
  const whole = new Map<MuscleGroupId, number>()
  const part = new Map<MuscleGroupId, number>()
  let total = 0
  for (const s of sets) {
    if (!isCountedSet(s)) continue
    const e = catalog.get(s.exerciseId)
    if (!e) continue
    const groups = [...new Set(e.primaryMuscles.map(groupOfMuscle).filter((x): x is MuscleGroupId => x !== null))]
    if (!groups.length) continue
    total++
    for (const g of groups) {
      whole.set(g, (whole.get(g) ?? 0) + 1)
      part.set(g, (part.get(g) ?? 0) + 1 / groups.length)
    }
  }
  if (!total) return []
  return [...whole.entries()]
    .map(([group, sets]) => ({ group, sets, share: part.get(group)! / total }))
    .sort((a, b) => b.share - a.share || b.sets - a.sets || a.group.localeCompare(b.group))
}

/** Work sets per muscle group between two dates (inclusive), same rule as `workSetsPerGroup`. */
export function workSetsPerGroupRange(p: Prepared, from: string, to: string, catalog: CatalogMuscles): GroupSets[] {
  const acc = new Map<MuscleGroupId, number>()
  for (const s of p.sessions) {
    if (s.date < from || s.date > to) continue
    for (const x of workSetsOf(p, s)) {
      const e = catalog.get(x.exerciseId)
      if (!e) continue
      for (const g of new Set(e.primaryMuscles.map(groupOfMuscle).filter((y): y is MuscleGroupId => y !== null))) acc.set(g, (acc.get(g) ?? 0) + 1)
    }
  }
  return [...acc.entries()].map(([group, n]) => ({ group, sets: n })).sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group))
}

export interface TrainingTotals {
  sessions: number
  workSets: number
  /** Minutes summed over the sessions that have a duration. */
  durationMin: number
  /** kg lifted (weight × reps of work sets). */
  volume: number
}

/** Totals of the counted sessions dated between `from` and `to` (both optional, inclusive). */
export function trainingTotals(p: Prepared, from?: string, to?: string): TrainingTotals {
  const out: TrainingTotals = { sessions: 0, workSets: 0, durationMin: 0, volume: 0 }
  for (const s of p.sessions) {
    if ((from !== undefined && s.date < from) || (to !== undefined && s.date > to)) continue
    const sets = workSetsOf(p, s)
    out.sessions++
    out.workSets += sets.length
    out.volume += sessionVolume(sets)
    out.durationMin += sessionMinutes(s) ?? 0
  }
  return out
}

export interface BestLift {
  exerciseId: string
  exerciseName: string
  weight: number
  reps: number | null
  date: string
}

/** Top exercises by heaviest completed work set (weight above zero), heaviest first; ties go to the newest. */
export function bestLifts(p: Prepared, limit = 5): BestLift[] {
  const best = new Map<string, BestLift>()
  for (const s of p.sessions) {
    for (const x of workSetsOf(p, s)) {
      if (x.weight === null || x.weight <= 0) continue
      const cur = best.get(x.exerciseId)
      if (!cur || x.weight > cur.weight) best.set(x.exerciseId, { exerciseId: x.exerciseId, exerciseName: x.exerciseName, weight: x.weight, reps: x.reps, date: s.date })
    }
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight || (a.date < b.date ? 1 : -1) || a.exerciseName.localeCompare(b.exerciseName)).slice(0, Math.max(0, limit))
}

export interface ExerciseLine {
  exerciseId: string
  name: string
  /** Completed work sets of this exercise in the session. */
  sets: number
}

/** The exercises a session actually did, in session order ("3 × Sentadilla con barra"); skipped ones are left out. */
export function sessionExerciseLines(p: Prepared, session: TrainingSession): ExerciseLine[] {
  const count = new Map<string, number>()
  for (const s of workSetsOf(p, session)) count.set(s.exerciseId, (count.get(s.exerciseId) ?? 0) + 1)
  const out: ExerciseLine[] = []
  for (const o of session.exerciseOrder) {
    const n = count.get(o.exerciseId)
    if (n) {
      out.push({ exerciseId: o.exerciseId, name: o.name, sets: n })
      count.delete(o.exerciseId)
    }
  }
  return out
}
