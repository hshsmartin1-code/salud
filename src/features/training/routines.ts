/**
 * Routine library and editor logic (pure, no React, no I/O).
 *
 * Rules that matter for the data:
 *  - a routine the person did not touch is never rewritten (callers get only the changes);
 *  - editing keeps every property of the row and of each exercise it does not show (unknown fields survive);
 *  - `order` is the manual position; once any active routine has one the list is manual, otherwise it is
 *    sorted by last use.
 */
import type { TrackingType } from '../../db/catalogTypes'
import type { Routine, RoutineExercise } from '../../db/types'

// ───────────── list order ─────────────

export const hasManualOrder = (routines: readonly Pick<Routine, 'order' | 'archived'>[]): boolean =>
  routines.some((r) => !r.archived && typeof r.order === 'number' && Number.isFinite(r.order))

const hasOrder = (r: Pick<Routine, 'order'>): r is { order: number } => typeof r.order === 'number' && Number.isFinite(r.order)
const byName = (a: Pick<Routine, 'name'>, b: Pick<Routine, 'name'>) => a.name.localeCompare(b.name, 'es')

/**
 * Display order of the active (not archived) routines: manual positions first (then name), the rest by
 * last use, most recent first (never used last), then name. Returns a new array.
 */
export function sortRoutines<T extends Pick<Routine, 'id' | 'name' | 'order' | 'archived'>>(routines: readonly T[], lastUsed: ReadonlyMap<string, string>): T[] {
  const active = routines.filter((r) => !r.archived)
  const ordered = active.filter(hasOrder).sort((a, b) => (a.order as number) - (b.order as number) || byName(a, b))
  const rest = active
    .filter((r) => !hasOrder(r))
    .sort((a, b) => {
      const da = lastUsed.get(a.id) ?? ''
      const db = lastUsed.get(b.id) ?? ''
      return da !== db ? (da < db ? 1 : -1) : byName(a, b)
    })
  return [...ordered, ...rest]
}

export const archivedRoutines = <T extends Pick<Routine, 'name' | 'archived'>>(routines: readonly T[]): T[] => routines.filter((r) => r.archived).sort(byName)

/** The routine "Iniciar" points at: the most recently used active one, else the first of the display order. */
export function habitualRoutine<T extends Pick<Routine, 'id' | 'name' | 'order' | 'archived'>>(routines: readonly T[], lastUsed: ReadonlyMap<string, string>): T | null {
  const sorted = sortRoutines(routines, lastUsed)
  let best: T | null = null
  let bestDate = ''
  for (const r of sorted) {
    const d = lastUsed.get(r.id)
    if (d && d > bestDate) {
      best = r
      bestDate = d
    }
  }
  return best ?? sorted[0] ?? null
}

export interface OrderChange {
  id: string
  order: number
}

/**
 * Moves one routine a position up or down in `display` (the current display order of the active
 * routines) and returns ONLY the rows whose `order` has to change. When every routine already has a
 * distinct manual position, that is the swap of two rows; otherwise the whole list is numbered 0..n-1
 * (the first manual reorder) and only rows whose number differs are returned.
 */
export function moveRoutine(display: readonly Pick<Routine, 'id' | 'order'>[], id: string, dir: -1 | 1): OrderChange[] {
  const i = display.findIndex((r) => r.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= display.length) return []
  const a = display[i]!
  const b = display[j]!
  const distinct = display.every(hasOrder) && new Set(display.map((r) => r.order)).size === display.length
  if (distinct) return [{ id: a.id, order: b.order as number }, { id: b.id, order: a.order as number }]
  const next = display.map((r) => r.id)
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  const out: OrderChange[] = []
  next.forEach((rid, pos) => {
    const cur = display.find((r) => r.id === rid)!
    if (cur.order !== pos) out.push({ id: rid, order: pos })
  })
  return out
}

/** Position for a routine inserted right after `after` in a manual list (no other row changes), or at the end. */
export function orderAfter(display: readonly Pick<Routine, 'id' | 'order'>[], afterId: string | null): number | undefined {
  if (!display.some(hasOrder)) return undefined
  const ordered = display.filter(hasOrder).sort((a, b) => (a.order as number) - (b.order as number))
  const last = ordered[ordered.length - 1]!.order as number
  if (afterId === null) return last + 1
  const i = ordered.findIndex((r) => r.id === afterId)
  if (i < 0) return last + 1
  const cur = ordered[i]!.order as number
  const next = ordered[i + 1]
  return next ? (cur + (next.order as number)) / 2 : cur + 1
}

// ───────────── duplicate / archive ─────────────

const META = ['id', 'profileId', 'createdAt', 'updatedAt'] as const
export type NewRoutine = Omit<Routine, (typeof META)[number]>

/** "Pierna A" → "Pierna A (copia)" → "Pierna A (copia 2)"… unique among `names`. */
export function copyName(name: string, names: readonly string[]): string {
  const base = name.replace(/ \(copia(?: \d+)?\)$/, '')
  const taken = new Set(names.map((n) => n.toLowerCase()))
  let candidate = `${base} (copia)`
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (copia ${n})`
  return candidate
}

/**
 * Data of the copy of `routine`: every property is carried over (unknown ones too) except the row
 * identity and the archived flag; exercises get new keys. `order` is `position` when given.
 */
export function duplicateRoutine(routine: Routine, names: readonly string[], newKey: () => string, position?: number): NewRoutine {
  const copy: Record<string, unknown> = { ...routine }
  for (const k of META) delete copy[k]
  delete copy.archived
  delete copy.order
  copy.name = copyName(routine.name, names)
  copy.exercises = routine.exercises.map((e) => ({ ...e, key: newKey() }))
  if (position !== undefined) copy.order = position
  return copy as unknown as NewRoutine
}

// ───────────── editor draft ─────────────

export interface RoutineDraft {
  name: string
  notes: string
  exercises: RoutineExercise[]
}

export const draftFromRoutine = (r: Pick<Routine, 'name' | 'notes' | 'exercises'> | undefined): RoutineDraft => ({ name: r?.name ?? '', notes: r?.notes ?? '', exercises: r?.exercises ?? [] })

const normExercise = (e: RoutineExercise): RoutineExercise => e

/** Whether the draft differs from what was loaded (name and notes trimmed, exercises compared deeply). */
export function isDirty(initial: RoutineDraft, now: RoutineDraft): boolean {
  return initial.name.trim() !== now.name.trim() || initial.notes.trim() !== now.notes.trim() || JSON.stringify(initial.exercises.map(normExercise)) !== JSON.stringify(now.exercises.map(normExercise))
}

/**
 * The row to store: `existing` with only name, notes and exercises replaced. Every other property of the
 * row stays. Empty notes are removed instead of stored as "". Exercises keep all their own properties;
 * `warmupSets`, `notes` and an unused `warmupSets: 0` are removed when empty so an untouched exercise stays identical.
 */
export function buildRoutine(existing: Routine | undefined, draft: RoutineDraft): Omit<Routine, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> & Partial<Pick<Routine, 'id' | 'profileId' | 'createdAt' | 'updatedAt'>> {
  const base: Record<string, unknown> = { ...(existing ?? {}) }
  base.name = draft.name.trim()
  const notes = draft.notes.trim()
  if (notes) base.notes = notes
  else delete base.notes
  base.exercises = draft.exercises.map(cleanExercise)
  return base as unknown as ReturnType<typeof buildRoutine>
}

function cleanExercise(e: RoutineExercise): RoutineExercise {
  const out: Record<string, unknown> = { ...e }
  if (!(typeof e.warmupSets === 'number' && e.warmupSets > 0)) delete out.warmupSets
  if (typeof e.notes !== 'string' || !e.notes.trim()) delete out.notes
  else out.notes = e.notes.trim()
  return out as unknown as RoutineExercise
}

// ───────────── editor exercise list ─────────────

export function newExerciseItem(e: { id: string; nameEs: string; trackingType: TrackingType }, key: string, defaultRest: Record<TrackingType, number>): RoutineExercise {
  return { key, exerciseId: e.id, name: e.nameEs, trackingType: e.trackingType, targetSets: 3, targetReps: e.trackingType === 'time' ? '30-60 s' : e.trackingType === 'distance' ? '' : '8-12', restSec: defaultRest[e.trackingType] }
}

export function moveItem<T>(items: readonly T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || index >= items.length || j < 0 || j >= items.length) return items.slice()
  const out = items.slice()
  ;[out[index], out[j]] = [out[j]!, out[index]!]
  return out
}

/** Copy inserted right after `index`, with a new key and all other properties. */
export function duplicateItem(items: readonly RoutineExercise[], index: number, newKey: string): RoutineExercise[] {
  const src = items[index]
  if (!src) return items.slice()
  const out = items.slice()
  out.splice(index + 1, 0, { ...src, key: newKey })
  return out
}

export function removeItem<T>(items: readonly T[], index: number): { items: T[]; removed: T | undefined } {
  const out = items.slice()
  const [removed] = out.splice(index, 1)
  return { items: out, removed }
}

export function insertItem<T>(items: readonly T[], index: number, item: T): T[] {
  const out = items.slice()
  out.splice(Math.min(Math.max(0, index), out.length), 0, item)
  return out
}

// ───────────── text ─────────────

/** 120 → "2:00". */
export function formatRest(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "3 series · 8–10 reps · descanso 2:00" (+ warm-ups). Reps text is shown as typed, with a plain hyphen turned into an en dash. */
export function describeExercise(e: Pick<RoutineExercise, 'targetSets' | 'targetReps' | 'restSec' | 'trackingType' | 'warmupSets'>): string {
  const parts = [`${e.targetSets} ${e.targetSets === 1 ? 'serie' : 'series'}`]
  const reps = (e.targetReps ?? '').trim().replace(/(\d)\s*-\s*(\d)/g, '$1–$2')
  if (reps) parts.push(e.trackingType === 'time' || /[a-zA-Z]/.test(reps) ? reps : `${reps} reps`)
  if (e.restSec > 0) parts.push(`descanso ${formatRest(e.restSec)}`)
  if (e.warmupSets && e.warmupSets > 0) parts.push(`${e.warmupSets} ${e.warmupSets === 1 ? 'calentamiento' : 'calentamientos'}`)
  return parts.join(' · ')
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ───────────── editor: patches ─────────────

export type ExercisePatch = Partial<Pick<RoutineExercise, 'targetSets' | 'targetReps' | 'restSec' | 'notes' | 'warmupSets'>>

/**
 * Applies a patch to one exercise. A warm-up count of 0 and an empty note remove the property, so going
 * back to the original value leaves the exercise identical to what was stored (the draft is not "dirty").
 */
export function patchExercise(item: RoutineExercise, patch: ExercisePatch): RoutineExercise {
  const out: RoutineExercise = { ...item, ...patch }
  if ('warmupSets' in patch && !(typeof patch.warmupSets === 'number' && patch.warmupSets > 0)) delete out.warmupSets
  if ('notes' in patch && !(typeof patch.notes === 'string' && patch.notes.trim() !== '')) delete out.notes
  return out
}

/**
 * The fields to write when an existing routine is saved: only name, notes and exercises. Every other
 * property of the row (order, archived, unknown ones) is left to the store, so a save never overwrites
 * what another device changed in the meantime. `notes: undefined` removes the note.
 */
export function patchFromDraft(draft: RoutineDraft): { name: string; notes: string | undefined; exercises: RoutineExercise[] } {
  const notes = draft.notes.trim()
  return { name: draft.name.trim(), notes: notes || undefined, exercises: draft.exercises.map(cleanExercise) }
}

/**
 * Drops routine `id` at position `toIndex` of `display` and returns only the rows whose `order` changes.
 * With distinct manual positions already in place the same set of numbers is re-dealt in the new order
 * (rows that keep their number are not written); otherwise the list is numbered 0..n-1 first.
 */
export function moveRoutineTo(display: readonly Pick<Routine, 'id' | 'order'>[], id: string, toIndex: number): OrderChange[] {
  const from = display.findIndex((r) => r.id === id)
  const to = Math.min(Math.max(0, toIndex), display.length - 1)
  if (from < 0 || from === to) return []
  const ids = display.map((r) => r.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved!)
  const distinct = display.every(hasOrder) && new Set(display.map((r) => r.order)).size === display.length
  const numbers = distinct ? display.map((r) => r.order as number).sort((a, b) => a - b) : display.map((_, i) => i)
  const byId = new Map(display.map((r) => [r.id, r.order]))
  const out: OrderChange[] = []
  ids.forEach((rid, pos) => {
    if (byId.get(rid) !== numbers[pos]) out.push({ id: rid, order: numbers[pos]! })
  })
  return out
}

/** Routines whose name, exercise names or muscle groups (labels) contain every word of `query`. */
export function filterRoutines<T extends Pick<Routine, 'id' | 'name' | 'exercises'>>(routines: readonly T[], query: string, groupsOf: (r: T) => string[]): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return routines.slice()
  return routines.filter((r) => {
    const hay = norm([r.name, ...r.exercises.map((e) => e.name), ...groupsOf(r)].join(' '))
    return words.every((w) => hay.includes(w))
  })
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
