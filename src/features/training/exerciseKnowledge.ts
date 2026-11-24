/**
 * Exercise knowledge base: pure logic (no React, no fetch) for filters, favourites, stable ids,
 * variants, substitutions, personal history, progression and records.
 * Only uses the bundled open-exercise-db metadata plus our own rules.
 */
import type { Repo } from '../../db/repo'
import type { ExerciseSet } from '../../db/types'
import { isWarmupSet } from '../../domain/setKind'
import { e1rm, e1rmApplies, setStrengthScore, setVolume } from '../../domain/training'
import { normalize } from '../../domain/search'

type Tracking = 'weight_reps' | 'bodyweight_reps' | 'time' | 'distance'

/** The subset of an exercise the knowledge functions need (catalog or custom). */
export interface KExercise {
  id: string
  nameEs: string
  aliases: string[]
  primaryMuscles: string[]
  secondaryMuscles: string[]
  equipment: string | null
  category: string
  level: string | null
  mechanic: string | null
  force: string | null
  trackingType: Tracking
  custom: boolean
  /** Normalized searchable text. */
  search: string
}

// ───────────── Spanish labels ─────────────
export const LEVEL_LABEL: Record<string, string> = { beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Avanzado' }
export const MECHANIC_LABEL: Record<string, string> = { compound: 'Compuesto', isolation: 'Aislado' }
export const FORCE_LABEL: Record<string, string> = { push: 'Empuje', pull: 'Tirón', static: 'Estático' }

// ───────────── Stable ids (aliases) ─────────────
export type ExerciseAliases = Record<string, string>

/** Keeps only string→string entries; keys starting with "_" (e.g. `_comment`) are metadata. */
export function parseAliases(raw: unknown): ExerciseAliases {
  const out: ExerciseAliases = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('_') || typeof v !== 'string' || !v || k === v) continue
    out[k] = v
  }
  return out
}

/** Follows old→new links (cycle-safe). An id with no alias resolves to itself. */
export function resolveExerciseId(id: string, aliases: ExerciseAliases): string {
  let cur = id
  const seen = new Set<string>()
  while (Object.prototype.hasOwnProperty.call(aliases, cur) && !seen.has(cur)) {
    seen.add(cur)
    cur = aliases[cur]!
  }
  return cur
}

/** Every id that resolves to `id` (itself first): where history may be stored after a rename. */
export function idsResolvingTo(id: string, aliases: ExerciseAliases): string[] {
  const target = resolveExerciseId(id, aliases)
  const out = [target]
  for (const old of Object.keys(aliases)) if (old !== target && resolveExerciseId(old, aliases) === target) out.push(old)
  return out
}

let aliasPromise: Promise<ExerciseAliases> | null = null
/** Loads `data/exercise-aliases.json`; any failure yields an empty map (never blocks the catalog). */
export function loadExerciseAliases(baseUrl = '/'): Promise<ExerciseAliases> {
  if (!aliasPromise) {
    aliasPromise = fetch(`${baseUrl}data/exercise-aliases.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(parseAliases)
      .catch(() => ({}) as ExerciseAliases)
  }
  return aliasPromise
}

// ───────────── Filters ─────────────
export interface LibraryFilter {
  q: string
  muscle: string
  equipment: string
  level: string
  category: string
  withMedia: boolean
  favoritesOnly: boolean
  customOnly: boolean
}

export const EMPTY_FILTER: LibraryFilter = {
  q: '',
  muscle: '',
  equipment: '',
  level: '',
  category: '',
  withMedia: false,
  favoritesOnly: false,
  customOnly: false,
}

/** Number of active non-text filters. */
export function activeFilterCount(f: LibraryFilter): number {
  return [f.muscle, f.equipment, f.level, f.category].filter(Boolean).length + [f.withMedia, f.favoritesOnly, f.customOnly].filter(Boolean).length
}

export interface FilterContext {
  hasMedia?: (id: string) => boolean
  favorites?: ReadonlySet<string>
}

/** Accent-insensitive token search + combinable filters. Returns ALL matches, best first. */
export function filterLibrary(list: readonly KExercise[], f: LibraryFilter, ctx: FilterContext = {}): KExercise[] {
  const tokens = normalize(f.q).split(' ').filter(Boolean)
  const favs = ctx.favorites
  const out: { e: KExercise; score: number }[] = []
  for (const e of list) {
    if (f.muscle && !e.primaryMuscles.includes(f.muscle)) continue
    if (f.equipment && (e.equipment ?? '') !== f.equipment) continue
    if (f.level && e.level !== f.level) continue
    if (f.category && e.category !== f.category) continue
    if (f.customOnly && !e.custom) continue
    if (f.favoritesOnly && !favs?.has(e.id)) continue
    if (f.withMedia && !(ctx.hasMedia?.(e.id) ?? false)) continue
    if (tokens.length && !tokens.every((t) => e.search.includes(t))) continue
    let score = 0
    const isFav = !!favs?.has(e.id)
    if (!tokens.length && isFav) score -= 200
    if (e.custom) score -= 50
    if (f.muscle) score -= 10
    const name = normalize(e.nameEs)
    if (tokens.length && name.startsWith(tokens[0]!)) score -= 20
    if (tokens.length && tokens.every((t) => name.includes(t))) score -= 10
    if (tokens.length && isFav) score -= 5
    if (e.level === 'beginner') score -= 2
    score += name.length / 100
    out.push({ e, score })
  }
  out.sort((a, b) => a.score - b.score)
  return out.map((x) => x.e)
}

// ───────────── Favourites ─────────────
export const favoriteRowId = (profileId: string, exerciseId: string) => `${profileId}|${exerciseId}`

export async function setFavorite(r: Repo, profileId: string, exerciseId: string, name: string, on: boolean): Promise<void> {
  const id = favoriteRowId(profileId, exerciseId)
  if (on) await r.put('exerciseFavorites', { id, exerciseId, name })
  else await r.remove('exerciseFavorites', id)
}

// ───────────── Variants & substitutions ─────────────
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'a', 'al', 'y', 'o', 'para', 'sobre', 'un', 'una', 'por'])
const EQUIP_WORDS = new Set([
  'barra', 'barras', 'mancuerna', 'mancuernas', 'polea', 'poleas', 'cable', 'maquina', 'pesa', 'rusa', 'kettlebell', 'banda', 'bandas', 'elastica',
  'elasticas', 'balon', 'rodillo', 'espuma', 'medicinal', 'estabilidad', 'z', 'corporal', 'peso', 'ez',
])

/** Significant name tokens, without articles or equipment words, singularised crudely. */
export function nameStem(nameEs: string): string[] {
  const out: string[] = []
  for (const raw of normalize(nameEs).split(' ')) {
    if (!raw || STOP.has(raw) || EQUIP_WORDS.has(raw)) continue
    out.push(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
  }
  return out
}

function stemOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sb = new Set(b)
  const shared = a.filter((t) => sb.has(t)).length
  return shared / Math.min(a.length, b.length)
}

const FREE_WEIGHTS = new Set(['barbell', 'dumbbell', 'e-z curl bar', 'kettlebells'])
const MACHINES = new Set(['machine', 'cable'])
const LIGHT = new Set(['body only', 'bands', 'exercise ball', 'medicine ball', 'foam roll'])

export function equipmentGroup(eq: string | null): string {
  if (!eq) return 'none'
  if (FREE_WEIGHTS.has(eq)) return 'free'
  if (MACHINES.has(eq)) return 'machine'
  if (LIGHT.has(eq)) return 'light'
  return 'other'
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

export interface Related {
  exercise: KExercise
  score: number
  reasons: string[]
}

export interface RelatedLabels {
  equipment?: Record<string, string>
}

/**
 * Variants: same movement family = same first primary muscle, same mechanic (when both known),
 * same category and a shared name stem (>= 60 % of the shorter stem). Equipment may differ.
 */
export function findVariants(target: KExercise, all: readonly KExercise[], opts: { limit?: number; labels?: RelatedLabels } = {}): Related[] {
  const stem = nameStem(target.nameEs)
  const lead = target.primaryMuscles[0]
  if (!lead || !stem.length) return []
  const out: Related[] = []
  for (const c of all) {
    if (c.id === target.id || c.category !== target.category) continue
    if (c.primaryMuscles[0] !== lead) continue
    if (target.mechanic && c.mechanic && target.mechanic !== c.mechanic) continue
    const ov = stemOverlap(stem, nameStem(c.nameEs))
    if (ov < 0.6) continue
    const reasons: string[] = ['Mismo movimiento']
    if (c.equipment === target.equipment) reasons.push('mismo equipo')
    else reasons.push(`con ${opts.labels?.equipment?.[c.equipment ?? ''] ?? c.equipment ?? 'otro equipo'}`.toLowerCase())
    out.push({ exercise: c, score: ov * 100 + (c.equipment !== target.equipment ? 5 : 0) - c.nameEs.length / 100, reasons })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, opts.limit ?? 8)
}

export function trackingCompatible(a: Tracking, b: Tracking): boolean {
  if (a === b) return true
  return (a === 'weight_reps' || a === 'bodyweight_reps') && (b === 'weight_reps' || b === 'bodyweight_reps')
}

/**
 * Substitutions: rank candidates by primary-muscle overlap, then mechanic, force, tracking type and
 * equipment similarity. Excludes the exercise itself, stretching↔non-stretching swaps and (optionally)
 * candidates that would change how the sets are recorded.
 */
export function rankSubstitutions(
  target: KExercise,
  all: readonly KExercise[],
  opts: { favorites?: ReadonlySet<string>; limit?: number; compatibleTrackingOnly?: boolean; exclude?: ReadonlySet<string>; labels?: RelatedLabels } = {},
): Related[] {
  if (!target.primaryMuscles.length) return []
  const out: Related[] = []
  for (const c of all) {
    if (c.id === target.id || opts.exclude?.has(c.id)) continue
    if ((c.category === 'stretching') !== (target.category === 'stretching')) continue
    const shared = c.primaryMuscles.filter((m) => target.primaryMuscles.includes(m)).length
    if (!shared) continue
    const compat = trackingCompatible(target.trackingType, c.trackingType)
    if (!compat && opts.compatibleTrackingOnly) continue
    let score = (shared / Math.max(target.primaryMuscles.length, c.primaryMuscles.length)) * 100
    const reasons: string[] = [sameSet(c.primaryMuscles, target.primaryMuscles) ? 'Mismo músculo principal' : 'Comparte músculo principal']
    if (target.mechanic && c.mechanic === target.mechanic) {
      score += 20
      reasons.push(`${MECHANIC_LABEL[c.mechanic]!.toLowerCase()}`)
    }
    if (target.force && c.force === target.force) {
      score += 10
      reasons.push(FORCE_LABEL[c.force]!.toLowerCase())
    }
    if (c.trackingType === target.trackingType) score += 8
    else if (compat) score += 4
    else score -= 30
    if (c.category === target.category) score += 4
    if (c.equipment === target.equipment) {
      score += 6
      reasons.push('mismo equipo')
    } else if (equipmentGroup(c.equipment) === equipmentGroup(target.equipment)) {
      score += 3
      reasons.push('equipo similar')
    } else reasons.push('otro equipo')
    if (nameStem(target.nameEs).length && stemOverlap(nameStem(target.nameEs), nameStem(c.nameEs)) >= 0.6) score += 6
    if (opts.favorites?.has(c.id)) {
      score += 2
      reasons.push('favorito')
    }
    out.push({ exercise: c, score: score - c.nameEs.length / 1000, reasons })
  }
  out.sort((a, b) => b.score - a.score || a.exercise.nameEs.localeCompare(b.exercise.nameEs, 'es'))
  return out.slice(0, opts.limit ?? 12)
}

/** Joins reasons as "Mismo músculo principal · compuesto · otro equipo". */
export function reasonText(r: Related): string {
  return r.reasons.join(' · ')
}

// ───────────── History, progression, records ─────────────
type SetRow = Pick<ExerciseSet, 'id' | 'sessionId' | 'date' | 'setIndex' | 'weight' | 'reps' | 'durationSec' | 'distanceM' | 'isWarmup' | 'done'> & Partial<Pick<ExerciseSet, 'kind'>>

export interface SessionSummary {
  sessionId: string
  date: string
  sets: SetRow[]
  /** Best working set: highest e1RM; else most reps/longest time/longest distance. */
  best: SetRow | null
  volume: number
  e1rm: number | null
  /** Tracking-aware headline metric (e1RM kg, reps, seconds or metres). */
  metric: number | null
}

/**
 * Ordering of the sets of one session (which one is "the best"). Loaded lifts use the Epley strength score
 * (1–15 reps, see setStrengthScore); body-weight exercises use reps, because their `weight` is only the
 * added load and an e1RM from it would not be the lifter's strength (and would not be in reps, the unit of
 * their headline metric).
 */
function rankOf(s: SetRow, t: Tracking): number | null {
  switch (t) {
    case 'weight_reps':
      return setStrengthScore(s.weight, s.reps)
    case 'bodyweight_reps':
      return s.reps
    case 'time':
      return s.durationSec
    case 'distance':
      return s.distanceM
  }
}

/** Headline metric of the best set: e1RM for loaded lifts (null above 10 reps), otherwise its rank value. */
function metricOf(s: SetRow, t: Tracking): number | null {
  if (t === 'weight_reps') return s.weight !== null && s.reps !== null ? e1rm(s.weight, s.reps) : null
  return rankOf(s, t)
}

export const METRIC_LABEL: Record<Tracking, { name: string; unit: string }> = {
  weight_reps: { name: '1RM estimado', unit: 'kg' },
  bodyweight_reps: { name: 'Mejor serie', unit: 'reps' },
  time: { name: 'Mejor tiempo', unit: 's' },
  distance: { name: 'Mayor distancia', unit: 'm' },
}

/** Sessions with at least one completed set, newest first. Warm-ups never count as best. */
export function summarizeSessions(sets: readonly SetRow[], t: Tracking): SessionSummary[] {
  const by = new Map<string, SetRow[]>()
  for (const s of sets) if (s.done) by.set(s.sessionId, [...(by.get(s.sessionId) ?? []), s])
  const out: SessionSummary[] = []
  for (const [sessionId, rows] of by) {
    rows.sort((a, b) => a.setIndex - b.setIndex)
    const work = rows.filter((s) => !isWarmupSet(s))
    let best: SetRow | null = null
    let bestM = -Infinity
    for (const s of work) {
      const m = rankOf(s, t)
      if (m !== null && m > bestM) {
        bestM = m
        best = s
      }
    }
    const e = !e1rmApplies(t)
      ? null
      : work.reduce<number | null>((acc, s) => {
          const v = s.weight !== null && s.reps !== null ? e1rm(s.weight, s.reps) : null
          return v !== null && (acc === null || v > acc) ? v : acc
        }, null)
    out.push({
      sessionId,
      date: rows[0]!.date,
      sets: rows,
      best,
      volume: work.reduce((a, s) => a + setVolume(s), 0),
      e1rm: e,
      metric: best ? metricOf(best, t) : null,
    })
  }
  out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
  return out
}

export interface ProgressPoint {
  date: string
  value: number
}

/** Oldest → newest, one point per session that has a headline metric. */
export function progression(sessions: readonly SessionSummary[]): ProgressPoint[] {
  return sessions
    .filter((s) => s.metric !== null)
    .map((s) => ({ date: s.date, value: s.metric! }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export interface DatedValue {
  value: number
  date: string
}
export interface ExerciseRecords {
  bestLoad: (DatedValue & { reps: number | null }) | null
  bestE1rm: DatedValue | null
  /** Most reps at each of the heaviest loads (max 5), heaviest first. */
  repsAtLoad: { weight: number; reps: number; date: string }[]
  bestVolumeSession: DatedValue | null
  bestReps: DatedValue | null
  bestDuration: DatedValue | null
  bestDistance: DatedValue | null
}

/** Personal records from completed working sets (warm-ups excluded). Ties keep the earliest date. */
export function exerciseRecords(sets: readonly SetRow[]): ExerciseRecords {
  const work = sets.filter((s) => s.done && !isWarmupSet(s))
  const rec: ExerciseRecords = { bestLoad: null, bestE1rm: null, repsAtLoad: [], bestVolumeSession: null, bestReps: null, bestDuration: null, bestDistance: null }
  const better = (cur: DatedValue | null, v: number, date: string) => (!cur || v > cur.value || (v === cur.value && date < cur.date) ? { value: v, date } : cur)
  const atLoad = new Map<number, { reps: number; date: string }>()
  for (const s of work) {
    if (s.weight !== null && s.weight > 0) {
      if (!rec.bestLoad || s.weight > rec.bestLoad.value || (s.weight === rec.bestLoad.value && s.date < rec.bestLoad.date))
        rec.bestLoad = { value: s.weight, date: s.date, reps: s.reps }
      if (s.reps !== null && s.reps > 0) {
        const cur = atLoad.get(s.weight)
        if (!cur || s.reps > cur.reps || (s.reps === cur.reps && s.date < cur.date)) atLoad.set(s.weight, { reps: s.reps, date: s.date })
        const v = e1rm(s.weight, s.reps)
        if (v !== null) rec.bestE1rm = better(rec.bestE1rm, v, s.date)
      }
    }
    if (s.reps !== null && s.reps > 0) rec.bestReps = better(rec.bestReps, s.reps, s.date)
    if (s.durationSec) rec.bestDuration = better(rec.bestDuration, s.durationSec, s.date)
    if (s.distanceM) rec.bestDistance = better(rec.bestDistance, s.distanceM, s.date)
  }
  rec.repsAtLoad = [...atLoad.entries()]
    .map(([weight, v]) => ({ weight, ...v }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
  const bySession = new Map<string, { vol: number; date: string }>()
  for (const s of work) {
    const cur = bySession.get(s.sessionId) ?? { vol: 0, date: s.date }
    cur.vol += setVolume(s)
    bySession.set(s.sessionId, cur)
  }
  for (const v of bySession.values()) if (v.vol > 0) rec.bestVolumeSession = better(rec.bestVolumeSession, v.vol, v.date)
  return rec
}

/** Loads every set of an exercise, including those stored under renamed (aliased) ids. */
export async function loadExerciseSets(r: Repo, exerciseId: string, aliases: ExerciseAliases): Promise<ExerciseSet[]> {
  const ids = idsResolvingTo(exerciseId, aliases)
  const parts = await Promise.all(ids.map((id) => r.byProfileIndex('exerciseSets', 'exerciseId', id)))
  return parts.flat()
}

/** Route of the full exercise page. */
export const exercisePath = (id: string) => `/entreno/ejercicios/${encodeURIComponent(id)}`
