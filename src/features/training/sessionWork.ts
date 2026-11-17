/**
 * In-flight work of the live session on this page: mounted drafts (set values, notes) and set
 * completions still being written. "Terminar" waits for all of it before closing the session, so a
 * set completed a moment before finishing is never discarded as pending.
 */
import type { Repo } from '../../db/repo'
import type { TrainingSession } from '../../db/types'
import { applyToPendingSets, finishSession, reopenSession, restoreAppliedSets, type FinishSnapshot, type MeasurePatch } from './session'

interface Flushable {
  flush(): Promise<void>
  readonly failed?: boolean
}

const drafts = new Set<Flushable>()
const work = new Set<Promise<unknown>>()

/** Registers a mounted draft; returns the unregister function. */
export function registerDraft(d: Flushable): () => void {
  drafts.add(d)
  return () => {
    drafts.delete(d)
  }
}

/** Tracks a write that must land before the session is finished (e.g. completing a set). */
export function trackSessionWork<T>(p: Promise<T>): Promise<T> {
  work.add(p)
  const done = () => {
    work.delete(p)
  }
  p.then(done, done)
  return p
}

/** Flushes every draft and waits for every tracked write (including writes they start). */
export async function settleSessionWork(): Promise<void> {
  const mounted = [...drafts]
  const flushed = await Promise.allSettled(mounted.map((d) => d.flush()))
  if (flushed.some((result) => result.status === 'rejected') || mounted.some((d) => d.failed)) throw new Error('No se pudo guardar la sesión')
  for (let i = 0; i < 10 && work.size; i++) {
    const settled = await Promise.allSettled([...work])
    if (settled.some((result) => result.status === 'rejected')) throw new Error('No se pudo guardar la sesión')
  }
  if (work.size) throw new Error('La sesión aún tiene cambios pendientes')
}

/** "Terminar": settle everything typed or tapped on this page, then finish in one transaction. */
export async function finishSessionWhenSettled(r: Repo, session: TrainingSession, opts: { complete?: readonly string[]; completeTouched?: boolean } = {}) {
  await settleSessionWork()
  // The live query can lag behind a just-flushed edit. Read touched IDs only after settling; finishSession
  // checks their persisted measures inside its transaction.
  const complete = opts.completeTouched ? [...touchedSetIds(session.id)] : opts.complete
  const out = await finishSession(r, session, { complete })
  const touchedIds = [...touchedSetIds(session.id)]
  clearTouched(session.id)
  return { ...out, touchedIds }
}

/** "Deshacer" of a finish: reopens the session (see reopenSession) and its touched-row state. */
export async function undoFinish(r: Repo, snap: FinishSnapshot, touchedIds: readonly string[]): Promise<boolean> {
  const ok = await reopenSession(r, snap)
  if (ok) for (const id of touchedIds) markSetTouched(snap.session.id, id)
  return ok
}

// ───────────── Touched rows ─────────────
//
// A row is TOUCHED when, in this session on this device, the person typed or changed one of its
// values: any valid edit through the draft (typing, "Anterior" copy), "Aplicar a las siguientes" or
// a progression hint applied to it. A row prefilled from last time and never edited is NOT touched.
// Kept in localStorage per session (survives a reload; device-local, never synced). Cleared on finish
// ("Deshacer" restores it).

const TOUCH_PREFIX = 'salud.touched|'
const touched = new Map<string, Set<string>>()

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function load(sessionId: string): Set<string> {
  let set = touched.get(sessionId)
  if (set) return set
  set = new Set()
  try {
    const raw = storage()?.getItem(TOUCH_PREFIX + sessionId)
    const ids: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') set.add(id)
  } catch {
    /* unreadable: start empty */
  }
  touched.set(sessionId, set)
  return set
}

export function markSetTouched(sessionId: string, setId: string): void {
  const set = load(sessionId)
  if (set.has(setId)) return
  set.add(setId)
  try {
    storage()?.setItem(TOUCH_PREFIX + sessionId, JSON.stringify([...set]))
  } catch {
    /* memory only */
  }
}

/** Undo of an apply: the rows go back to "not touched" (only the ids given). */
export function unmarkSetsTouched(sessionId: string, setIds: readonly string[]): void {
  const set = load(sessionId)
  let changed = false
  for (const id of setIds) changed = set.delete(id) || changed
  if (!changed) return
  try {
    storage()?.setItem(TOUCH_PREFIX + sessionId, JSON.stringify([...set]))
  } catch {
    /* memory only */
  }
}

/**
 * Applies values to pending rows (never done ones), marks them touched, and returns an undo that
 * restores the previous values and the previous touched state.
 */
export async function applyAndTouch(r: Repo, sessionId: string, ids: readonly string[], patch: MeasurePatch): Promise<{ count: number; undo: () => Promise<void> }> {
  const wasTouched = touchedSetIds(sessionId)
  const applied = await trackSessionWork(applyToPendingSets(r, ids, patch))
  const fresh = applied.map((a) => a.id).filter((id) => !wasTouched.has(id))
  for (const a of applied) markSetTouched(sessionId, a.id)
  return {
    count: applied.length,
    undo: async () => {
      const restored = await trackSessionWork(restoreAppliedSets(r, applied))
      unmarkSetsTouched(sessionId, fresh.filter((id) => restored.includes(id)))
    },
  }
}

export function touchedSetIds(sessionId: string): ReadonlySet<string> {
  return load(sessionId)
}

export function clearTouched(sessionId: string): void {
  touched.delete(sessionId)
  try {
    storage()?.removeItem(TOUCH_PREFIX + sessionId)
  } catch {
    /* nothing */
  }
}
