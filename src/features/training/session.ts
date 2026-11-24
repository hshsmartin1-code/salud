import type { Repo } from '../../db/repo'
import type { ExerciseSet, Routine, SessionExercise, TrainingSession } from '../../db/types'
import type { TrackingType } from '../../db/catalogTypes'
import { isWorkSet, isWarmupSet, withSetKind } from '../../domain/setKind'
import { todayLocal } from '../../domain/dates'
import { idsResolvingTo, type ExerciseAliases } from './exerciseKnowledge'
import { clearRest, sweepRestTimers } from './restTimer'

type OrderItem = SessionExercise

export const DEFAULT_REST: Record<TrackingType, number> = { weight_reps: 120, bodyweight_reps: 90, time: 60, distance: 0 }

// ───────────── Active session (one per profile) ─────────────

const startKey = (s: Pick<TrainingSession, 'startedAt' | 'createdAt'>) => s.startedAt ?? s.createdAt ?? ''

/**
 * The profile's session in progress, or null. If several are active (two devices started one each
 * while offline and then synced), the most recently started one is returned.
 */
export async function getActiveSession(r: Repo): Promise<TrainingSession | null> {
  const active = await r.byIndex('trainingSessions', 'status', 'active')
  if (!active.length) return null
  return active.sort((a, b) => startKey(b).localeCompare(startKey(a)) || (b.id < a.id ? -1 : 1))[0]!
}

// ───────────── Previous performance ─────────────

type SessionRef = Pick<TrainingSession, 'id' | 'date' | 'startedAt' | 'createdAt'>

/** Whether finished session `s` happened before `ref` (earlier date, or same date and earlier start). */
function isBefore(s: SessionRef, ref: SessionRef): boolean {
  if (s.id === ref.id) return false
  if (s.date !== ref.date) return s.date < ref.date
  return startKey(s) < startKey(ref)
}

/**
 * Sets of `exerciseId` (alias-resolved like exerciseKnowledge.ts) from the most recent FINISHED session
 * before `ref`. Excluded: rows with `excludeFromStats` (sets or sessions), the current session, other
 * active sessions, sets not marked done and orphan sets. Sorted by setIndex.
 */
export async function previousSessionSets(r: Repo, ref: SessionRef, exerciseId: string, aliases: ExerciseAliases = {}): Promise<ExerciseSet[]> {
  const ids = idsResolvingTo(exerciseId, aliases)
  const sets: ExerciseSet[] = []
  for (const id of new Set([exerciseId, ...ids])) sets.push(...(await r.byProfileIndex('exerciseSets', 'exerciseId', id)))
  const bySession = new Map<string, ExerciseSet[]>()
  for (const s of sets) {
    if (!s.done || s.excludeFromStats || s.sessionId === ref.id) continue
    bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s])
  }
  let best: TrainingSession | null = null
  for (const sid of bySession.keys()) {
    const sess = await r.get('trainingSessions', sid)
    if (!sess || sess.status !== 'done' || sess.excludeFromStats || !isBefore(sess, ref)) continue
    if (!best || sess.date > best.date || (sess.date === best.date && startKey(sess) > startKey(best))) best = sess
  }
  if (!best) return []
  return bySession.get(best.id)!.slice().sort((a, b) => a.setIndex - b.setIndex)
}

/**
 * Pairs each current set with the comparable set of the previous session: work sets by ordinal among
 * work sets (drop and failure sets are work sets), warm-ups by ordinal among warm-ups. Rows are taken
 * in setIndex order. Missing counterpart = null.
 */
export function matchPreviousSets(current: readonly ExerciseSet[], previous: readonly ExerciseSet[]): Map<string, ExerciseSet | null> {
  const bySetIndex = (a: ExerciseSet, b: ExerciseSet) => a.setIndex - b.setIndex
  const prevWork = previous.filter(isWorkSet).sort(bySetIndex)
  const prevWarm = previous.filter(isWarmupSet).sort(bySetIndex)
  const out = new Map<string, ExerciseSet | null>()
  let w = 0
  let u = 0
  for (const s of [...current].sort(bySetIndex)) out.set(s.id, isWarmupSet(s) ? (prevWarm[u++] ?? null) : (prevWork[w++] ?? null))
  return out
}

/** The previous comparable set for each row of one exercise in `session`. */
export async function previousForRows(r: Repo, session: SessionRef, exerciseId: string, rows: readonly ExerciseSet[], aliases: ExerciseAliases = {}): Promise<Map<string, ExerciseSet | null>> {
  return matchPreviousSets(rows, await previousSessionSets(r, session, exerciseId, aliases))
}

/** Last completed sets of an exercise from an earlier finished session (prefill and the "anterior" hint). */
export async function lastPerformance(r: Repo, exerciseId: string, date: string, sessionId?: string, aliases: ExerciseAliases = {}): Promise<ExerciseSet[]> {
  const cur = sessionId ? await r.get('trainingSessions', sessionId) : undefined
  // Without a session, every finished session of earlier dates (and of the same date) is "before".
  const ref: SessionRef = cur ?? { id: sessionId ?? '', date, startedAt: null, createdAt: '￿' }
  return previousSessionSets(r, ref, exerciseId, aliases)
}

// ───────────── Session lifecycle ─────────────

export function blankSet(session: Pick<TrainingSession, 'id' | 'date'>, item: OrderItem, setIndex: number, from?: ExerciseSet): Omit<ExerciseSet, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> {
  return {
    sessionId: session.id,
    date: session.date,
    exerciseId: item.exerciseId,
    exerciseName: item.name,
    setIndex,
    weight: from?.weight ?? null,
    reps: from?.reps ?? null,
    durationSec: from?.durationSec ?? null,
    distanceM: from?.distanceM ?? null,
    rpe: null,
    isWarmup: false,
    done: false,
    origin: 'app',
  }
}

/** Adds `count` pending set rows, prefilled from the previous finished session of that exercise. */
export async function addPendingSets(r: Repo, session: TrainingSession, item: OrderItem, count: number, aliases: ExerciseAliases = {}) {
  const prev = await previousSessionSets(r, session, item.exerciseId, aliases)
  const existing = (await r.byIndex('exerciseSets', 'sessionId', session.id)).filter((s) => s.exerciseId === item.exerciseId)
  const start = existing.reduce((m, s) => Math.max(m, s.setIndex + 1), 0)
  const work = prev.filter(isWorkSet)
  const existingWork = existing.filter(isWorkSet).length
  for (let i = 0; i < count; i++) {
    const src = work[Math.min(existingWork + i, work.length - 1)] ?? existing.filter(isWorkSet).pop()
    await r.add('exerciseSets', blankSet(session, item, start + i, src))
  }
}

/**
 * A routine may list the same exercise twice (the editor can duplicate a block) but a session keys its
 * sets by exercise, so repeats are folded into the first occurrence: set counts add up, the rest comes from the first.
 */
export function mergePlanned(exercises: Routine['exercises']): Routine['exercises'] {
  const byId = new Map<string, Routine['exercises'][number]>()
  for (const e of exercises) {
    const first = byId.get(e.exerciseId)
    if (!first) byId.set(e.exerciseId, e)
    else byId.set(e.exerciseId, { ...first, targetSets: first.targetSets + e.targetSets, ...(first.warmupSets || e.warmupSets ? { warmupSets: (first.warmupSets ?? 0) + (e.warmupSets ?? 0) } : {}) })
  }
  return [...byId.values()]
}

/** Adds `count` pending warm-up rows (kind 'warmup', never counted as work) before the work sets, prefilled from the previous warm-ups. */
async function addWarmupSets(r: Repo, session: TrainingSession, item: OrderItem, count: number, aliases: ExerciseAliases = {}) {
  const prev = (await previousSessionSets(r, session, item.exerciseId, aliases)).filter(isWarmupSet)
  for (let i = 0; i < count; i++) await r.add('exerciseSets', withSetKind(blankSet(session, item, i, prev[i]), 'warmup'))
}

/** Note of the most recent finished session (before `ref`) that has a note for this exercise. */
function carriedNote(ref: SessionRef, exerciseId: string, finished: TrainingSession[]): string | undefined {
  let best: TrainingSession | null = null
  for (const s of finished) {
    if (!isBefore(s, ref) || !s.exerciseOrder.some((o) => o.exerciseId === exerciseId)) continue
    if (!best || s.date > best.date || (s.date === best.date && startKey(s) > startKey(best))) best = s
  }
  const note = best?.exerciseOrder.find((o) => o.exerciseId === exerciseId)?.notes
  return note && note.trim() ? note : undefined
}

function orderItemFromRoutine(e: Routine['exercises'][number], carried: string | undefined): OrderItem {
  const item: OrderItem = { exerciseId: e.exerciseId, name: e.name, trackingType: e.trackingType, restSec: e.restSec }
  if (typeof e.targetSets === 'number') item.targetSets = e.targetSets
  if (typeof e.targetReps === 'string' && e.targetReps) item.targetReps = e.targetReps
  const note = e.notes && e.notes.trim() ? e.notes : carried
  if (note) item.notes = note
  return item
}

/**
 * Starts a session, or returns the one already in progress: there is at most ONE active session per
 * profile (checked and created in one transaction, so a double tap cannot create two).
 * From the routine, each exercise gets its target sets/reps and its note; when the routine has no note
 * for an exercise, the note of the most recent finished session containing it is carried over.
 */
export async function startSession(r: Repo, opts: { routine?: Routine; date?: string; name?: string; aliases?: ExerciseAliases }): Promise<TrainingSession> {
  const db = r.db
  sweepRestTimers(r.profileId)
  return db.transaction('rw', [db.trainingSessions, db.exerciseSets], async () => {
    const existing = await getActiveSession(r)
    if (existing) return existing
    const routine = opts.routine
    const date = opts.date ?? todayLocal()
    const startedAt = new Date().toISOString()
    const ref: SessionRef = { id: '', date, startedAt, createdAt: startedAt }
    const finished = routine ? (await r.all('trainingSessions')).filter((s) => s.status === 'done' && !s.excludeFromStats) : []
    const exerciseOrder: OrderItem[] = []
    for (const e of mergePlanned(routine?.exercises ?? [])) exerciseOrder.push(orderItemFromRoutine(e, carriedNote(ref, e.exerciseId, finished)))
    const session = await r.add('trainingSessions', {
      date,
      name: opts.name ?? routine?.name ?? 'Entrenamiento libre',
      routineId: routine?.id ?? null,
      status: 'active',
      startedAt,
      endedAt: null,
      restEndsAt: null,
      exerciseOrder,
      origin: 'app',
    })
    for (const e of mergePlanned(routine?.exercises ?? [])) {
      const item = session.exerciseOrder.find((o) => o.exerciseId === e.exerciseId)!
      const warm = Math.min(10, Math.max(0, Math.round(e.warmupSets ?? 0)))
      if (warm > 0) await addWarmupSets(r, session, item, warm, opts.aliases)
      await addPendingSets(r, session, item, Math.max(1, e.targetSets), opts.aliases)
    }
    return session
  })
}

/** Ends the session; pending (not done) rows are removed so they never count as performed. */
/** What "Terminar" changed, kept in memory for the undo window (see reopenSession). */
export interface FinishSnapshot {
  /** The session row exactly as it was before finishing (status active). */
  session: TrainingSession
  /** Pending rows deleted by finishing, exactly as they were (same ids, values, timestamps). */
  removed: ExerciseSet[]
  /** The row written by finishing; undo must not overwrite a newer edit. */
  finished: TrainingSession
  /** Rows marked done by finishing, in their finished state. */
  completed: ExerciseSet[]
}

/** Whether a row has the measure its tracking type needs to be marked done. */
export function hasMeasure(s: Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'>, t: TrackingType | undefined): boolean {
  switch (t ?? 'weight_reps') {
    case 'weight_reps':
      return s.weight != null && s.reps != null
    case 'bodyweight_reps':
      return s.reps != null
    case 'time':
      return s.durationSec != null
    case 'distance':
      return s.distanceM != null || s.durationSec != null
  }
}

/**
 * Closes the session. `complete`: pending rows to mark done first (only those that still have the
 * measure their tracking type needs); every other pending row is deleted.
 *
 * One transaction: no other write (another tab, a late set completion) can land between reading the
 * pending rows, deleting them and closing the session. Each row is re-read right before deleting, so
 * a set completed after the list was read is kept.
 */
export async function finishSession(r: Repo, session: TrainingSession, opts: { complete?: readonly string[] } = {}): Promise<{ removed: number; completed: number; snapshot: FinishSnapshot }> {
  const db = r.db
  const want = new Set(opts.complete ?? [])
  const snapshot = await db.transaction('rw', [db.exerciseSets, db.trainingSessions], async (): Promise<FinishSnapshot> => {
    const before = (await r.get('trainingSessions', session.id)) ?? session
    const tracking = new Map(before.exerciseOrder.map((o) => [o.exerciseId, o.trackingType]))
    const sets = await r.byIndex('exerciseSets', 'sessionId', session.id)
    const candidates = sets.filter((s) => !s.done).map((s) => s.id)
    const still = (await db.exerciseSets.bulkGet(candidates)).filter((s): s is ExerciseSet => !!s && !s.done)
    const completed: string[] = []
    const removed: ExerciseSet[] = []
    for (const s of still) {
      if (want.has(s.id) && hasMeasure(s, tracking.get(s.exerciseId))) completed.push(s.id)
      else removed.push(s)
    }
    for (const id of completed) await r.update('exerciseSets', id, { done: true })
    await r.removeMany('exerciseSets', removed.map((s) => s.id))
    const end = new Date()
    const durationMin = before.startedAt ? Math.max(1, Math.round((end.getTime() - new Date(before.startedAt).getTime()) / 60000)) : null
    // restEndsAt is only touched when an older client left a value behind (V3 never writes one).
    await r.update('trainingSessions', session.id, { status: 'done', endedAt: end.toISOString(), durationMin: before.durationMin ?? durationMin, ...(before.restEndsAt != null ? { restEndsAt: null } : {}) })
    const finished = await r.get('trainingSessions', session.id)
    const completedRows = await db.exerciseSets.bulkGet(completed)
    return { session: before, removed, finished: finished!, completed: completedRows.filter((s): s is ExerciseSet => !!s) }
  })
  clearRest(r.profileId, session.id)
  sweepRestTimers(r.profileId)
  return { removed: snapshot.removed.length, completed: snapshot.completed.length, snapshot }
}

/**
 * "Deshacer" after finishing: the session is active again as it was, the deleted rows come back with
 * their ids, values and timestamps, the rows completed by finishing are unticked. The rest timer is
 * not restarted. One transaction. Refused (false) when another session became active meanwhile (one
 * active session per profile) or the session was deleted.
 *
 * Sync converges either way: it diffs local rows against its shadow (no queued operations). If the
 * deletion was not pushed yet, the restored rows equal the shadow and nothing is sent; if it was, the
 * rows go up as new writes over the deleted revisions.
 */
export async function reopenSession(r: Repo, snap: FinishSnapshot): Promise<boolean> {
  const db = r.db
  return db.transaction('rw', [db.exerciseSets, db.trainingSessions], async () => {
    const current = await r.get('trainingSessions', snap.session.id)
    if (!current || current.status !== 'done' || JSON.stringify(current) !== JSON.stringify(snap.finished)) return false
    const active = await getActiveSession(r)
    if (active && active.id !== snap.session.id) return false
    if (snap.removed.some((row) => row.profileId !== r.profileId || row.sessionId !== snap.session.id)) return false
    // Undo is all-or-nothing. A later local or synced edit must win over the in-memory snapshot.
    if ((await db.exerciseSets.bulkGet(snap.removed.map((row) => row.id))).some(Boolean)) return false
    for (const row of snap.completed) {
      const now = await r.get('exerciseSets', row.id)
      if (!now || now.profileId !== r.profileId || now.sessionId !== snap.session.id || JSON.stringify(now) !== JSON.stringify(row)) return false
    }
    await db.exerciseSets.bulkPut(snap.removed)
    for (const row of snap.completed) await r.update('exerciseSets', row.id, { done: false })
    const { status, endedAt, durationMin, updatedAt } = snap.session
    await db.trainingSessions.put({ ...current, status, endedAt, durationMin, updatedAt })
    return true
  })
}

export type MeasurePatch = Partial<Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'>>
export interface AppliedValues {
  id: string
  before: MeasurePatch
  after: MeasurePatch
}

/**
 * "Aplicar a las siguientes" and the progression hint: writes `patch` to the given rows that are still
 * pending (a done row is never touched) in one transaction, and returns what each row had, for undo.
 */
export async function applyToPendingSets(r: Repo, ids: readonly string[], patch: MeasurePatch): Promise<AppliedValues[]> {
  const keys = Object.keys(patch) as (keyof MeasurePatch)[]
  if (!ids.length || !keys.length) return []
  return r.db.transaction('rw', r.db.exerciseSets, async () => {
    const out: AppliedValues[] = []
    for (const s of await r.db.exerciseSets.bulkGet([...ids])) {
      if (!s || s.done || s.profileId !== r.profileId) continue
      const changed = keys.filter((k) => s[k] !== patch[k])
      if (!changed.length) continue
      const before: MeasurePatch = {}
      const after: MeasurePatch = {}
      for (const k of changed) {
        before[k] = s[k]
        after[k] = patch[k]
      }
      await r.update('exerciseSets', s.id, after)
      out.push({ id: s.id, before, after })
    }
    return out
  })
}

/** Undo of applyToPendingSets: restores rows that are still pending and still hold the applied values. */
export async function restoreAppliedSets(r: Repo, applied: readonly AppliedValues[]): Promise<string[]> {
  if (!applied.length) return []
  return r.db.transaction('rw', r.db.exerciseSets, async () => {
    const restored: string[] = []
    for (const a of applied) {
      const s = await r.db.exerciseSets.get(a.id)
      if (!s || s.done) continue
      const keys = Object.keys(a.after) as (keyof MeasurePatch)[]
      if (keys.some((k) => s[k] !== a.after[k])) continue // edited since: keep the newer value
      await r.update('exerciseSets', s.id, a.before)
      restored.push(s.id)
    }
    return restored
  })
}

/** Deletes the session and all its sets in ONE transaction (all or nothing). */
export async function deleteSession(r: Repo, session: TrainingSession) {
  await r.db.transaction('rw', [r.db.exerciseSets, r.db.trainingSessions], async () => {
    const sets = await r.byIndex('exerciseSets', 'sessionId', session.id)
    await r.removeMany('exerciseSets', sets.map((s) => s.id))
    await r.remove('trainingSessions', session.id)
  })
  clearRest(r.profileId, session.id)
}

/** Sets the per-exercise note of a session (read-modify-write in one transaction; empty removes it). */
export async function updateExerciseNote(r: Repo, sessionId: string, exerciseId: string, note: string | undefined): Promise<void> {
  const db = r.db
  await db.transaction('rw', [db.trainingSessions], async () => {
    const s = await r.get('trainingSessions', sessionId)
    if (!s) return
    const order = s.exerciseOrder.map((o) => {
      if (o.exerciseId !== exerciseId) return o
      const { notes: _old, ...rest } = o
      void _old
      return note && note.trim() ? { ...rest, notes: note } : rest
    })
    await r.update('trainingSessions', sessionId, { exerciseOrder: order })
  })
}

// ───────────── Live editing (V3 session screen) ─────────────
// Every change to `exerciseOrder` reads the row inside a transaction, so a screen holding an older copy
// of the session (memoised blocks, a sync that just landed) can never write back a stale order.

type OrderPatch = Partial<Omit<OrderItem, 'exerciseId'>>

async function editOrder(r: Repo, sessionId: string, f: (order: OrderItem[]) => OrderItem[] | null): Promise<void> {
  const db = r.db
  await db.transaction('rw', [db.trainingSessions], async () => {
    const s = await r.get('trainingSessions', sessionId)
    if (!s) return
    const next = f(s.exerciseOrder.slice())
    if (next) await r.update('trainingSessions', sessionId, { exerciseOrder: next })
  })
}

/** Patch of one exercise of a session (rest, targets…). */
export function updateSessionExercise(r: Repo, sessionId: string, exerciseId: string, patch: OrderPatch): Promise<void> {
  return editOrder(r, sessionId, (order) => (order.some((o) => o.exerciseId === exerciseId) ? order.map((o) => (o.exerciseId === exerciseId ? { ...o, ...patch } : o)) : null))
}

/** Moves an exercise one place up (-1) or down (+1). No-op at the ends. */
export function moveSessionExercise(r: Repo, sessionId: string, exerciseId: string, delta: -1 | 1): Promise<void> {
  return editOrder(r, sessionId, (order) => {
    const i = order.findIndex((o) => o.exerciseId === exerciseId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return null
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    return order
  })
}

/** Removes an exercise and all its sets from the session. Returns the removed sets. */
export async function removeSessionExercise(r: Repo, sessionId: string, exerciseId: string): Promise<ExerciseSet[]> {
  const db = r.db
  return db.transaction('rw', [db.trainingSessions, db.exerciseSets], async () => {
    const mine = (await r.byIndex('exerciseSets', 'sessionId', sessionId)).filter((s) => s.exerciseId === exerciseId)
    await r.removeMany('exerciseSets', mine.map((s) => s.id))
    await editOrder(r, sessionId, (order) => order.filter((o) => o.exerciseId !== exerciseId))
    return mine
  })
}

/**
 * Appends an exercise with pending sets prefilled from its previous finished session (as many as were
 * done then, at least one). Returns false when the exercise is already in the session.
 */
export async function addSessionExercise(r: Repo, sessionId: string, e: { id: string; nameEs: string; trackingType: TrackingType }, aliases: ExerciseAliases = {}): Promise<boolean> {
  const db = r.db
  return db.transaction('rw', [db.trainingSessions, db.exerciseSets], async () => {
    const s = await r.get('trainingSessions', sessionId)
    if (!s || s.exerciseOrder.some((o) => o.exerciseId === e.id)) return false
    const item: OrderItem = { exerciseId: e.id, name: e.nameEs, trackingType: e.trackingType, restSec: DEFAULT_REST[e.trackingType] }
    const order = [...s.exerciseOrder, item]
    await r.update('trainingSessions', s.id, { exerciseOrder: order })
    const prev = await previousSessionSets(r, s, e.id, aliases)
    await addPendingSets(r, { ...s, exerciseOrder: order }, item, Math.max(1, prev.filter(isWorkSet).length), aliases)
    return true
  })
}

/**
 * "+ Serie": one more pending set, prefilled from the last set of this exercise in this session (a
 * warm-up copies its values but the new row is a normal set). Without any row yet it falls back to
 * addPendingSets (previous session).
 */
export async function addSetLikeLast(r: Repo, session: TrainingSession, item: OrderItem, aliases: ExerciseAliases = {}): Promise<void> {
  const existing = (await r.byIndex('exerciseSets', 'sessionId', session.id)).filter((s) => s.exerciseId === item.exerciseId).sort((a, b) => a.setIndex - b.setIndex)
  const last = existing[existing.length - 1]
  if (!last) return addPendingSets(r, session, item, 1, aliases)
  await r.add('exerciseSets', blankSet(session, item, last.setIndex + 1, last))
}

const isEmptySet = (s: ExerciseSet) => s.weight === null && s.reps === null && s.durationSec === null && s.distanceM === null

/**
 * Marks a set done (with the values just typed) or not done. Completing also prefills the next
 * pending set of the same exercise when that row is still completely empty.
 */
export async function markSetDone(r: Repo, setId: string, values: Partial<Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM' | 'rpe' | 'rir'>>, done: boolean): Promise<void> {
  const db = r.db
  await db.transaction('rw', [db.exerciseSets], async () => {
    const set = await r.get('exerciseSets', setId)
    if (!set) return
    await r.update('exerciseSets', setId, { ...values, done })
    if (!done) return
    const following = (await r.byIndex('exerciseSets', 'sessionId', set.sessionId))
      .filter((s) => s.exerciseId === set.exerciseId && s.setIndex > set.setIndex)
      .sort((a, b) => a.setIndex - b.setIndex)[0]
    if (following && !following.done && isEmptySet(following)) {
      const { weight, reps, durationSec, distanceM } = { ...set, ...values }
      await r.update('exerciseSets', following.id, { weight, reps, durationSec, distanceM })
    }
  })
}
