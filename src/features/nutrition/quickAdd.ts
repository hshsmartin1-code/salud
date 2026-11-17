import type { Repo } from '../../db/repo'
import type { FoodLog, FoodSnapshot, MealKey, Recent } from '../../db/types'
import { isCalendarDate, nowLocalTime } from '../../domain/dates'

export const recentId = (profileId: string, ref: string) => `${profileId}|${ref}`

/** Counts one use of a food: bumps `recents` and remembers the last quantity. */
export async function touchRecent(r: Repo, snap: FoodSnapshot) {
  const id = recentId(r.profileId, snap.foodRef)
  const prev = await r.get('recents', id)
  await r.put('recents', {
    id,
    foodRef: snap.foodRef,
    name: snap.name,
    source: snap.source,
    lastUsedAt: new Date().toISOString(),
    count: (prev?.count ?? 0) + 1,
    lastQty: snap.qty,
    lastUnit: snap.unit,
    lastPortionLabel: snap.portionLabel ?? null,
    lastPortionId: snap.portionId ?? null,
  })
}

/**
 * The frozen snapshot of a log (or template item), cloned: quantity, unit, portion, grams/ml, nutrients,
 * `missing`, source and dataset version exactly as stored. Row identity, placement and provenance
 * (id, profile, timestamps, date, meal, time, note, origin) are left out.
 */
export function snapshotOf(src: FoodSnapshot): FoodSnapshot {
  const {
    id: _id, profileId: _p, createdAt: _c, updatedAt: _u, date: _d, meal: _m, time: _t, note: _n,
    origin: _o, sourceRef: _s, approx, excludeFromStats: _e, ...snap
  } = src as FoodSnapshot & Partial<FoodLog>
  void [_id, _p, _c, _u, _d, _m, _t, _n, _o, _s, _e]
  // `approx` is part of what the entry means ("aprox."), so a copy keeps it; the key stays absent otherwise.
  return { ...snap, ...(approx !== undefined ? { approx } : {}), nutrients: { ...snap.nutrients }, missing: [...snap.missing] }
}

export interface LogEntry {
  snapshot: FoodSnapshot
  /** Time of day to store. Omitted = now. */
  time?: string | null
  note?: string
}

export interface LoggedBatch {
  /** Ids of the foodLogs rows that were created. */
  ids: string[]
  /** Deletes exactly those rows and puts `recents` back as it was. Safe to call twice. */
  undo: () => Promise<void>
}

interface RecentUndo {
  before: Recent | undefined
  after: Recent
  previous?: RecentUndo
  undone: boolean
}
// Only live undo closures retain the chain. Nothing is stored in the database or sync payload.
const recentUndos = new WeakMap<Repo['db'], Map<string, WeakRef<RecentUndo>>>()
const sameRow = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Writes copies of frozen snapshots as new logs on `date`/`meal`, updating `recents` like a normal log,
 * in ONE transaction. Never recomputes anything from the catalog.
 */
export async function logSnapshots(r: Repo, entries: readonly LogEntry[], date: string, meal: MealKey): Promise<LoggedBatch> {
  if (!isCalendarDate(date)) throw new Error('Elige una fecha válida.')
  const ids: string[] = []
  const rows = new Map<string, FoodLog>()
  const states = new Map<string, RecentUndo>()
  const journal = recentUndos.get(r.db) ?? new Map<string, WeakRef<RecentUndo>>()
  recentUndos.set(r.db, journal)
  let undone = false
  await r.db.transaction('rw', r.db.foodLogs, r.db.recents, async () => {
    for (const e of entries) {
      const id = recentId(r.profileId, e.snapshot.foodRef)
      if (!states.has(id)) {
        const before = await r.get('recents', id)
        const previous = journal.get(id)?.deref()
        // A later edit/import breaks the chain: undo must never overwrite that independent state.
        states.set(id, { before, after: before as Recent, previous: previous && sameRow(before, previous.after) ? previous : undefined, undone: false })
      }
      const row = await r.add('foodLogs', {
        ...snapshotOf(e.snapshot),
        date,
        meal,
        time: e.time === undefined ? nowLocalTime() : e.time,
        ...(e.note ? { note: e.note } : {}),
        origin: 'app',
      })
      ids.push(row.id)
      rows.set(row.id, row)
      await touchRecent(r, e.snapshot)
    }
    // Capture exactly our write before releasing the transaction, never a later batch's recent.
    for (const [id, state] of states) state.after = (await r.get('recents', id))!
  })
  for (const [id, state] of states) journal.set(id, new WeakRef(state))
  return {
    ids,
    undo: () =>
      r.db.transaction('rw', r.db.foodLogs, r.db.recents, async () => {
        if (undone) return
        for (const [id, row] of rows) {
          const current = await r.get('foodLogs', id)
          if (current && !sameRow(current, row)) throw new Error('El registro ha cambiado. No se puede deshacer sin perder cambios posteriores.')
        }
        await r.removeMany('foodLogs', ids)
        const gone: string[] = []
        for (const [id, state] of states) {
          // Leave a recents row alone if the food was used again since: that later use must survive.
          const now = await r.get('recents', id)
          if (!sameRow(now, state.after)) continue
          let before = state.before
          let previous = state.previous
          while (previous?.undone) {
            before = previous.before
            previous = previous.previous
          }
          if (before) {
            const restored = await r.put('recents', before)
            if (previous) previous.after = restored
          }
          else gone.push(id)
          if (journal.get(id)?.deref() === state) {
            if (previous) journal.set(id, new WeakRef(previous))
            else journal.delete(id)
          }
        }
        if (gone.length) await r.removeMany('recents', gone)
        for (const state of states.values()) state.undone = true
        undone = true
      }),
  }
}
