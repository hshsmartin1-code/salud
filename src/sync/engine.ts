import type { Table } from 'dexie'
import type { SaludDB } from '../db/schema'
import type { ExerciseSet, SyncConflict, SyncLink, SyncShadow } from '../db/types'
import { cloudRowId, decodeRow, docKey, encodeRow, localRowId, sameContent, shadowKey, type EncodedRow } from './codec'
import { describeFromSets, mergeSessionRows } from './sessionMerge'
import { RemoteError, type CommitOneResult, type RemoteDoc, type RemoteStore, type RemoteWrite } from './remote'
import { AUTO_RESOLVE_TABLES, isSyncedTable, PROFILE_TABLE, SYNC_TABLES, TABLES_VERSION, type SyncedTableName } from './syncTables'

/**
 * Offline-first sync of ONE local profile with ONE account.
 *
 * Dexie stays the source of truth on the device. The engine keeps a "shadow" per row: the last
 * revision and content hash agreed with the server. From it:
 *   - local changes = rows whose hash differs from the shadow, plus shadows whose row is gone
 *     (deletions). The pending queue is therefore derived from durable data: it survives crashes,
 *     covers every write path (forms, backup restore, repairs) and can never lose a deletion.
 *   - remote changes = documents newer than the shadow, read incrementally by server time.
 * A row changed on both sides is a conflict: both versions are stored and nothing is overwritten
 * until the person chooses (except low-stakes shortcut tables, see AUTO_RESOLVE_TABLES).
 */

export const PULL_PAGE = 300
export const PUSH_BATCH = 200
/** Same limit as `firestore.rules` (`d.size() <= 200000`). */
export const MAX_ROW_CHARS = 200_000
/**
 * Re-read window behind the cursor (µs). `at` is the commit time the server picks, so a write can become
 * visible with a time a little older than the newest document a pull already saw. Such writes are within
 * this window of the cursor, so pulls re-read it; applying is idempotent (a revision the shadow already
 * has is skipped). Once a pull has re-read the window at least this long after the cursor was first seen
 * (device clock), the window is settled and later pulls start right after the last document seen: idle
 * syncs then cost one empty query instead of re-reading every recent document (Spark quota).
 */
export const PULL_OVERLAP_US = 90 * 1_000_000
const SETTLE_MS = PULL_OVERLAP_US / 1000

export type SyncErrorCode = 'not-linked' | 'account-mismatch' | 'foreign-row' | 'profile-missing' | 'cloud-reset'

export class SyncError extends Error {
  readonly code: SyncErrorCode
  constructor(code: SyncErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'SyncError'
  }
}

export interface SyncOptions {
  /** Push deletions even if they exceed the mass-delete guard (after the person confirmed). */
  confirmDeletes?: boolean
  now?: () => Date
}

export interface SyncResult {
  pulled: number
  applied: number
  pushed: number
  conflicts: number
  pending: number
  heldDeletes: number
  /** Rows the server refused (too large or invalid). They stay on the device and pending. */
  rejected: number
  /** Remote documents that could not be read and were skipped. */
  unreadable: number
}

type Row = Record<string, unknown> & { id: string; profileId?: string; updatedAt?: string }

interface LocalChange extends RemoteWrite {
  rowId: string
}

const syncTableNames = (db: SaludDB) => SYNC_TABLES.map((t) => db.table(t))
const rowTable = (db: SaludDB, t: SyncedTableName) => (t === PROFILE_TABLE ? db.profiles : db.table(t)) as unknown as Table<Row, string>

/** Mass-delete guard: more deletions than this in one sync need explicit confirmation. */
export function deleteThreshold(syncedLiveRows: number): number {
  return Math.max(25, Math.ceil(syncedLiveRows * 0.2))
}

async function readLocal(db: SaludDB, profileId: string, t: SyncedTableName, rowId: string): Promise<Row | undefined> {
  const row = await rowTable(db, t).get(rowId)
  if (!row) return undefined
  if (t !== PROFILE_TABLE && row.profileId !== profileId)
    throw new SyncError('foreign-row', 'Un registro de esta cuenta ya existe en otro perfil de este dispositivo. Vincula ese perfil en su lugar.')
  return row
}

/**
 * Encodings made during ONE sync round, keyed by table and row id. The round scans every local row twice
 * (to upload, then to count what is still pending); the second scan reuses the encoding of a row whose
 * stored JSON did not change in between. Rows edited meanwhile differ in JSON and are encoded again.
 * Never kept across rounds: every upload decision starts from fresh encodings.
 */
export type EncodeMemo = Map<string, { json: string; enc: EncodedRow }>

function encodeLocal(t: SyncedTableName, row: Row, profileId: string, memo: EncodeMemo | undefined): EncodedRow {
  if (!memo) return encodeRow(t, row, profileId)
  const k = `${t}\u0000${row.id}`
  const json = JSON.stringify(row)
  const hit = memo.get(k)
  if (hit && hit.json === json) return hit.enc
  const enc = encodeRow(t, row, profileId)
  memo.set(k, { json, enc })
  return enc
}

/** Computes local changes against the shadow. Rows with an open conflict are held back. */
export async function localChanges(db: SaludDB, profileId: string, memo?: EncodeMemo): Promise<{ writes: LocalChange[]; deletes: LocalChange[]; liveSynced: number }> {
  const writes: LocalChange[] = []
  const deletes: LocalChange[] = []
  let liveSynced = 0
  const open = await db.syncConflicts.where('profileId').equals(profileId).toArray()
  const blocked = new Set(open.map((c) => c.key))
  // A session deleted here but changed on another device is waiting for the person: its set
  // deletions (whose session is unknown once the rows are gone) are held until it is resolved.
  let holdSetDeletes = open.some(isSessionDeletedHere)
  // Sets of a session whose deletion is waiting for the person are not uploaded meanwhile either: the
  // choice decides whether they live (then they go up) or go with the session.
  const heldSessions = new Set(open.filter(isSessionDeletion).map((c) => c.rowId))
  for (const c of open) {
    const sid = c.table === 'exerciseSets' ? c.remote?.sessionId : undefined
    if (typeof sid === 'string' && !(await readLocal(db, profileId, 'trainingSessions', sid))) {
      heldSessions.add(sid)
      holdSetDeletes = true
    }
  }
  const scan = async (t: SyncedTableName, rows: Row[]) => {
    const shadows = await db.syncShadow.where('[profileId+table]').equals([profileId, t]).toArray()
    const byRow = new Map(shadows.map((s) => [s.rowId, s]))
    for (const s of shadows) if (s.hash !== null) liveSynced++
    for (const row of rows) {
      const enc = encodeLocal(t, row, profileId, memo)
      const sh = byRow.get(row.id)
      byRow.delete(row.id)
      if (sh && sh.hash === enc.h) continue
      if (blocked.has(enc.key)) continue
      if (t === 'exerciseSets' && heldSessions.has(String(row.sessionId))) continue
      writes.push({ key: enc.key, t, id: enc.cloudId, rowId: row.id, baseRev: sh?.rev ?? 0, del: false, d: enc.d, h: enc.h })
    }
    for (const sh of byRow.values()) {
      if (sh.hash === null || blocked.has(sh.k.slice(profileId.length + 1))) continue
      if (t === 'trainingSessions' && heldSessions.has(sh.rowId)) continue
      if (holdSetDeletes && t === 'exerciseSets') continue
      const key = sh.k.slice(profileId.length + 1)
      deletes.push({ key, t, id: key.slice(t.length + 1), rowId: sh.rowId, baseRev: sh.rev, del: true, d: null, h: null })
    }
  }
  const profile = await db.profiles.get(profileId)
  await scan(PROFILE_TABLE, profile ? [profile as unknown as Row] : [])
  for (const t of SYNC_TABLES) await scan(t, (await db.table(t).where('profileId').equals(profileId).toArray()) as Row[])
  // A deletion's cloud id is the encoded part of the key; decode it for the document body.
  for (const d of deletes) d.id = decodeURIComponent(d.id)
  return { writes, deletes, liveSynced }
}

function shadowRow(profileId: string, t: string, key: string, rowId: string, rev: number, hash: string | null): SyncShadow {
  return { k: shadowKey(profileId, key), profileId, table: t, rowId, rev, hash }
}

async function recordConflict(db: SaludDB, profileId: string, t: string, key: string, rowId: string, local: Row | undefined, remote: Row | null, remoteRev: number, now: Date) {
  const existing = await db.syncConflicts.where('[profileId+key]').equals([profileId, key]).first()
  const c: SyncConflict = {
    id: existing?.id ?? crypto.randomUUID(),
    profileId,
    key,
    table: t,
    rowId,
    local: local ? { ...local } : null,
    remote,
    remoteRev,
    detectedAt: now.toISOString(),
  }
  await db.syncConflicts.put(c)
}

async function writeLocal(db: SaludDB, t: SyncedTableName, profileId: string, rowId: string, row: Row | null) {
  if (t === PROFILE_TABLE) {
    // A profile is never deleted by sync; only its synced fields are replaced.
    if (row) await db.profiles.put({ ...(row as Record<string, unknown>), id: profileId } as never)
    return
  }
  const table = rowTable(db, t)
  if (row) await table.put({ ...row, id: rowId, profileId })
  else await table.delete(rowId)
}

async function hasLocallyDeletedSession(db: SaludDB, pid: string, set: Row): Promise<boolean> {
  const sid = set.sessionId
  if (typeof sid !== 'string' || await readLocal(db, pid, SESSIONS, sid)) return false
  const sh = await db.syncShadow.get(shadowKey(pid, docKey(SESSIONS, cloudRowId(sid, pid))))
  return sh !== undefined && sh.hash !== null
}

/**
 * Applies one pulled page. `saveProgress` runs in the same transaction, so the cursor can never move
 * past documents whose effect is not stored, and a concurrent cursor reset is seen consistently.
 */
async function applyPage(db: SaludDB, link: SyncLink, docs: RemoteDoc[], now: Date, saveProgress?: () => Promise<void>): Promise<{ applied: number; conflicts: number; unreadable: number }> {
  const pid = link.profileId
  let applied = 0
  let conflicts = 0
  let unreadable = 0
  await db.transaction('rw', [db.profiles, db.syncShadow, db.syncConflicts, db.syncLinks, ...syncTableNames(db)], async () => {
    const hold = await sessionDeletionGuard(db, pid, docs)
    for (const doc of docs) {
      if (!isSyncedTable(doc.t) || docKey(doc.t, doc.id) !== doc.key) continue // unknown/newer table or malformed key
      const t = doc.t
      const sk = shadowKey(pid, doc.key)
      const sh = await db.syncShadow.get(sk)
      if (sh && doc.rev <= sh.rev) continue // already known (overlap window, own writes)
      const rowId = localRowId(doc.id, pid)
      const local = await readLocal(db, pid, t, rowId)
      const localHash = local ? encodeRow(t, local, pid).h : null
      const remoteHash = doc.del ? null : doc.h
      const localDirty = sh ? localHash !== sh.hash : local !== undefined
      let remoteRow: Row | null
      try {
        remoteRow = doc.del || doc.d === null ? null : (decodeRow(t, doc.id, doc.d, pid) as Row)
      } catch {
        // Unreadable content (only a console edit or a client bug can produce it). Skip it without
        // touching the local row or the shadow; one bad document must not stop every other row.
        unreadable++
        continue
      }

      if (localHash === remoteHash) {
        // Same content on both sides (or both deleted): just record the agreed revision.
      } else if (localDirty && local && remoteRow && sameContent(t, local, remoteRow, pid)) {
        // Only the timestamps differ: there is nothing to choose. Take the server's copy so both agree.
        await writeLocal(db, t, pid, rowId, remoteRow)
        applied++
      } else if (!localDirty && remoteRow === null && local && hold(t, local)) {
        // The session was deleted elsewhere while this device has unsynced changes to it: the row is
        // kept and the person's choice on the session conflict decides the session and its sets together.
        await recordConflict(db, pid, t, doc.key, rowId, local, null, doc.rev, now)
        conflicts++
      } else if (!localDirty && t === SETS && remoteRow && await hasLocallyDeletedSession(db, pid, remoteRow)) {
        // A newly added remote set also changes a session deleted here. Hold it for the session
        // choice instead of creating a live set whose parent deletion could be pushed silently.
        await recordConflict(db, pid, t, doc.key, rowId, local, remoteRow, doc.rev, now)
        conflicts++
      } else if (!localDirty) {
        await writeLocal(db, t, pid, rowId, remoteRow)
        applied++
      } else if (AUTO_RESOLVE_TABLES.has(t)) {
        const remoteNewer = (remoteRow?.updatedAt ?? '') > (local?.updatedAt ?? '')
        if (remoteNewer) {
          await writeLocal(db, t, pid, rowId, remoteRow)
          applied++
        }
      } else {
        await recordConflict(db, pid, t, doc.key, rowId, local, remoteRow, doc.rev, now)
        conflicts++
      }
      await db.syncShadow.put(shadowRow(pid, t, doc.key, rowId, doc.rev, remoteHash))
    }
    await saveProgress?.()
  })
  return { applied, conflicts, unreadable }
}

// Keep checked headers (including unreadable/stale ones) across rounds of this engine instance.
// Incremental pulls supply newer revisions; relinking to another account/epoch discards the cache.
const sessionHeaderChecks = new WeakMap<SaludDB, Map<string, {
  uid: string; epoch: SyncLink['cloudEpoch']; headers: Map<string, RemoteDoc | null>
}>>()

/** A remote set edit must ask about a locally deleted parent even if its header did not change. */
async function raiseSessionDeletionConflicts(db: SaludDB, link: SyncLink, remote: RemoteStore, now: Date, headers = new Map<string, RemoteDoc>(), deletedSessions: readonly string[] = []): Promise<number> {
  const pid = link.profileId
  let profiles = sessionHeaderChecks.get(db)
  if (!profiles) sessionHeaderChecks.set(db, (profiles = new Map()))
  let checked = profiles.get(pid)
  if (!checked || checked.uid !== link.uid || checked.epoch !== link.cloudEpoch) {
    checked = { uid: link.uid, epoch: link.cloudEpoch, headers: new Map() }
    profiles.set(pid, checked)
  }
  const known = checked.headers
  const open = await db.syncConflicts.where('profileId').equals(pid).toArray()
  const candidates = new Set(deletedSessions)
  for (const c of open) {
    const sid = c.table === SETS ? c.remote?.sessionId : undefined
    if (typeof sid !== 'string' || open.some((x) => x.table === SESSIONS && x.rowId === sid)) continue
    if (await readLocal(db, pid, SESSIONS, sid)) continue
    const sh = await db.syncShadow.get(shadowKey(pid, docKey(SESSIONS, cloudRowId(sid, pid))))
    if (sh) candidates.add(sid)
  }
  for (const sid of candidates) {
    const d = headers.get(sid)
    if (d && d.rev >= (known.get(sid)?.rev ?? 0)) known.set(sid, d)
  }
  const missing = new Set([...candidates].filter((sid) => !known.has(sid)))
  // The unchanged header may be older than the overlap window. Read it without changing the cursor
  // or replaying unrelated rows; no extra stored snapshot or remote API is needed.
  let after: { at: number; key: string } | null = null
  while (missing.size) {
    const docs = await remote.pull(null, after, PULL_PAGE)
    for (const d of docs) {
      const sid = localRowId(d.id, pid)
      if (d.t !== SESSIONS || docKey(d.t, d.id) !== d.key || !missing.has(sid)) continue
      known.set(sid, d)
      missing.delete(sid)
    }
    if (docs.length < PULL_PAGE) break
    const last = docs[docs.length - 1]!
    after = { at: last.at, key: last.key }
  }
  for (const sid of missing) known.set(sid, null)
  let raised = 0
  await db.transaction('rw', [db.trainingSessions, db.exerciseSets, db.syncShadow, db.syncConflicts], async () => {
    for (const sid of candidates) {
      const d = known.get(sid)
      if (await readLocal(db, pid, SESSIONS, sid)) continue
      const current = await db.syncConflicts.where('profileId').equals(pid).toArray()
      if (current.some((c) => c.table === SESSIONS && c.rowId === sid)) continue
      const key = docKey(SESSIONS, cloudRowId(sid, pid))
      const sh = await db.syncShadow.get(shadowKey(pid, key))
      if (d && sh && sh.rev > d.rev) continue
      if (!d || d.del) {
        // Both sides have lost the session: no set version may bring its children back.
        const closed = current.filter((c) => c.table === SETS && [c.local, c.remote].some((row) => row?.sessionId === sid))
        await db.syncConflicts.bulkDelete(closed.map((c) => c.id))
        const sets = (await db.exerciseSets.where('sessionId').equals(sid).toArray()).filter((s) => s.profileId === pid)
        await db.exerciseSets.bulkDelete(sets.map((s) => s.id))
        await db.syncShadow.put(shadowRow(pid, SESSIONS, key, sid, d?.rev ?? 0, null))
        continue // Set shadows stay intact so their deletions are pushed normally.
      }
      if (!d.d) continue
      const changedSet = current.some((c) => c.table === SETS && c.remote?.sessionId === sid)
      if (!changedSet && (!sh || d.rev <= sh.rev)) continue
      let row: Row
      try { row = decodeRow(SESSIONS, d.id, d.d, pid) as Row } catch { continue }
      await recordConflict(db, pid, SESSIONS, d.key, sid, undefined, row, d.rev, now)
      await db.syncShadow.put(shadowRow(pid, SESSIONS, d.key, sid, d.rev, d.h))
      raised++
    }
  })
  return raised
}

interface Position {
  at: number
  key: string
}
const isAfter = (a: Position, b: Position | null) => !b || a.at > b.at || (a.at === b.at && a.key > b.key)
const samePosition = (a: Position | null, b: Position | null) => (a === null ? b === null : b !== null && a.at === b.at && a.key === b.key)
/** The position the stored cursor stands for; null = the next pull reads everything. */
function storedPosition(link: SyncLink | undefined): Position | null {
  if (!link || link.cursor === null || link.tablesVersion !== TABLES_VERSION) return null
  return { at: link.cursor, key: link.cursorKey ?? '' }
}

async function pull(db: SaludDB, link: SyncLink, remote: RemoteStore, now: Date, clock: () => number) {
  const pid = link.profileId
  // Every cursor write is a compare-and-set against the position this pull last stored: a reset to null
  // made meanwhile (restoring held deletions or a deleted session) or another tab's newer position is
  // never overwritten. Once a write is refused, this pull stops moving the cursor.
  let expected = storedPosition(link)
  let ownsCursor = true
  let advanced = false
  let seen = expected
  const settled = expected !== null && link.cursorSettled === true
  const startedAt = clock()
  // Settled: start right after the last document seen. Otherwise re-read the overlap window too.
  const since = expected === null ? null : settled ? expected.at : expected.at - PULL_OVERLAP_US
  let fetchAfter: Position | null = settled ? expected : null
  let pulled = 0
  let applied = 0
  let conflicts = 0
  let unreadable = 0
  const headers = new Map<string, RemoteDoc>()
  // Documents fetched but not applied yet: every document is read (and billed) once.
  const buffer: RemoteDoc[] = []
  let exhausted = false
  const fetchMore = async () => {
    const docs = await remote.pull(since, fetchAfter, PULL_PAGE)
    if (docs.length < PULL_PAGE) exhausted = true
    const last = docs[docs.length - 1]
    if (last) fetchAfter = { at: last.at, key: last.key }
    buffer.push(...docs)
  }
  for (;;) {
    if (buffer.length < PULL_PAGE && !exhausted) await fetchMore()
    if (!buffer.length) break
    // One push batch shares one server time: keep the whole group in one page, so a session deletion
    // and the deletions of its sets are always judged together (see sessionDeletionGuard).
    let take = Math.min(PULL_PAGE, buffer.length)
    for (;;) {
      while (take < buffer.length && buffer[take]!.at === buffer[take - 1]!.at) take++
      if (take < buffer.length || exhausted) break
      await fetchMore()
    }
    const docs = buffer.splice(0, take)
    const last = docs[docs.length - 1]!
    const next: Position | null = isAfter(last, seen) ? { at: last.at, key: last.key } : null
    if (next) seen = next
    // Progress is durable page by page: an interrupted pull resumes near where it stopped.
    const save = next && ownsCursor
      ? async () => {
          if (!samePosition(storedPosition(await db.syncLinks.get(pid)), expected)) {
            ownsCursor = false
            return
          }
          await db.syncLinks.update(pid, { cursor: next.at, cursorKey: next.key, cursorSeenAt: clock(), cursorSettled: false, tablesVersion: TABLES_VERSION })
          expected = next
          advanced = true
        }
      : undefined
    const r = await applyPage(db, link, docs, now, save)
    for (const d of docs) if (d.t === SESSIONS && docKey(d.t, d.id) === d.key) headers.set(localRowId(d.id, pid), d)
    pulled += docs.length
    applied += r.applied
    conflicts += r.conflicts
    unreadable += r.unreadable
  }
  if (ownsCursor && !advanced) {
    await db.transaction('rw', db.syncLinks, async () => {
      const cur = await db.syncLinks.get(pid)
      if (!cur || !samePosition(storedPosition(cur), expected)) return
      if (expected === null) {
        // Empty account: remember that it was read once.
        await db.syncLinks.update(pid, { cursor: 0, cursorKey: '', cursorSeenAt: clock(), cursorSettled: false, tablesVersion: TABLES_VERSION })
      } else if (!cur.cursorSettled) {
        const seenAt = cur.cursorSeenAt
        // Unknown (link from an older version) or the device clock went back: start the wait again.
        if (seenAt == null || seenAt > startedAt) await db.syncLinks.update(pid, { cursorSeenAt: clock() })
        // This pull began at least one window after the cursor was seen and re-read the window: any
        // write older than the cursor was already visible to it, so nothing older can still appear.
        else if (startedAt - seenAt >= SETTLE_MS) await db.syncLinks.update(pid, { cursorSettled: true })
      }
    })
  }
  conflicts += await raiseSessionDeletionConflicts(db, link, remote, now, headers)
  return { pulled, applied, conflicts, unreadable }
}

async function saveShadows(db: SaludDB, pid: string, rows: SyncShadow[]) {
  if (rows.length) await db.syncShadow.bulkPut(rows)
  void pid
}

async function push(db: SaludDB, link: SyncLink, remote: RemoteStore, opts: SyncOptions, now: Date, memo?: EncodeMemo) {
  const pid = link.profileId
  const { writes, deletes, liveSynced } = await localChanges(db, pid, memo)
  const heldDeletes = !opts.confirmDeletes && deletes.length > deleteThreshold(liveSynced) ? deletes.length : 0
  // A row bigger than the server accepts would be refused forever: keep it local and report it.
  const oversize = new Set(writes.filter((w) => w.d !== null && w.d.length > MAX_ROW_CHARS))
  const sendable = oversize.size ? writes.filter((w) => !oversize.has(w)) : writes
  const queue = heldDeletes ? sendable : [...sendable, ...deletes]
  let pushed = 0
  let conflicts = 0
  let rejected = oversize.size
  // Set by a conflict on a session deleted here (see localChanges): its set deletions wait.
  let holdSets = false
  const heldSessions = new Set<string>()
  const heldSet = (w: LocalChange) => w.del && ((holdSets && w.t === SETS) || (w.t === SESSIONS && heldSessions.has(w.rowId)))
  for (let i = 0; i < queue.length; i += PUSH_BATCH) {
    const batch = queue.slice(i, i + PUSH_BATCH).filter((w) => !heldSet(w))
    if (!batch.length) continue
    const body = batch.map(({ rowId: _r, ...w }) => (void _r, w))
    try {
      await remote.commit(body)
      await saveShadows(db, pid, batch.map((w) => shadowRow(pid, w.t, w.key, w.rowId, w.baseRev + 1, w.del ? null : w.h)))
      pushed += batch.length
      continue
    } catch (e) {
      if (!(e instanceof RemoteError) || (e.code !== 'conflict' && e.code !== 'permission')) throw e
    }
    // Check a header edited during this upload before isolating set writes. Keep headers first in
    // the bulk queue so this protection also precedes set deletions in later batches.
    const sessionDeletes = batch.filter((w) => w.del && w.t === SESSIONS).map((w) => w.rowId)
    if (sessionDeletes.length) {
      conflicts += await raiseSessionDeletionConflicts(db, link, remote, now, undefined, sessionDeletes)
      const open = await db.syncConflicts.where('profileId').equals(pid).toArray()
      for (const c of open.filter(isSessionDeletedHere)) {
        heldSessions.add(c.rowId)
        holdSets = true
      }
    }
    // Some revision was stale (or one row was refused): isolate it with one transactional write per row.
    // Within this failed batch only, check sets first: a set-only edit must hold its header too.
    batch.sort((a, b) => Number(a.del && a.t === SESSIONS) - Number(b.del && b.t === SESSIONS))
    let refusedInBatch = 0
    let lastRefusal: RemoteError | null = null
    for (const w of batch) {
      if (heldSet(w)) continue
      const { rowId, ...body1 } = w
      let r: CommitOneResult
      try {
        r = await remote.commitOne(body1)
      } catch (e) {
        if (!(e instanceof RemoteError) || (e.code !== 'permission' && e.code !== 'invalid')) throw e
        // The server refused this row only: it stays local and pending, the rest keeps going.
        refusedInBatch++
        lastRefusal = e
        continue
      }
      if (r.ok) {
        await saveShadows(db, pid, [shadowRow(pid, w.t, w.key, rowId, r.rev, w.del ? null : w.h)])
        pushed++
        continue
      }
      const cur = r.current
      const curHash = cur && !cur.del ? cur.h : null
      if (cur && curHash === (w.del ? null : w.h)) {
        // Already on the server (e.g. a lost acknowledgement): idempotent success.
        await saveShadows(db, pid, [shadowRow(pid, w.t, w.key, rowId, cur.rev, curHash)])
        pushed++
        continue
      }
      // Someone else changed it since our base: keep both versions for review, overwrite nothing.
      let sameRecord = false
      await db.transaction('rw', [db.syncShadow, db.syncConflicts, db.profiles, ...syncTableNames(db)], async () => {
        const t = w.t as SyncedTableName
        const local = await readLocal(db, pid, t, rowId)
        const remoteRow = cur && !cur.del && cur.d ? (decodeRow(t, cur.id, cur.d, pid) as Row) : null
        if (cur && local && remoteRow && sameContent(t, local, remoteRow, pid)) {
          // The other device made the same change (only the timestamps differ): adopt its copy.
          await writeLocal(db, t, pid, rowId, remoteRow)
          await db.syncShadow.put(shadowRow(pid, t, w.key, rowId, cur.rev, curHash))
          sameRecord = true
          return
        }
        await recordConflict(db, pid, t, w.key, rowId, local, remoteRow, cur?.rev ?? 0, now)
        await db.syncShadow.put(shadowRow(pid, t, w.key, rowId, cur?.rev ?? 0, curHash))
        if (t === 'trainingSessions' && !local && remoteRow) holdSets = true
        if (t === SETS && remoteRow && typeof remoteRow.sessionId === 'string'
          && !(await readLocal(db, pid, SESSIONS, remoteRow.sessionId))) {
          heldSessions.add(remoteRow.sessionId)
          holdSets = true
        }
      })
      if (!sameRecord) conflicts++
    }
    // Every row refused: an account-level denial (revoked access), not one bad row.
    if (lastRefusal && refusedInBatch === batch.length) throw lastRefusal
    rejected += refusedInBatch
  }
  if (heldSessions.size) conflicts += await raiseSessionDeletionConflicts(db, link, remote, now)
  return { pushed, conflicts, heldDeletes, rejected, attempted: queue.length }
}

function partialMessage(rejected: number, unreadable: number): string {
  const parts: string[] = []
  if (rejected) parts.push(`${rejected} registro(s) no se pudieron subir (demasiado grandes o no válidos) y siguen solo en este dispositivo`)
  if (unreadable) parts.push(`${unreadable} registro(s) de la nube no se pudieron leer y se omitieron`)
  return parts.join('. ') + '.'
}

/** One full sync round: pull, then push, then record the outcome on the link. */
export async function syncProfile(db: SaludDB, profileId: string, remote: RemoteStore, opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now?.() ?? new Date()
  const clock = () => (opts.now?.() ?? new Date()).getTime()
  const link = await db.syncLinks.get(profileId)
  if (!link) throw new SyncError('not-linked', 'Este perfil no está vinculado a una cuenta.')
  if (link.uid !== remote.uid) throw new SyncError('account-mismatch', 'La sesión abierta es de otra cuenta. No se sincroniza nada.')
  if (!(await db.profiles.get(profileId))) throw new SyncError('profile-missing', 'El perfil ya no existe en este dispositivo.')
  try {
    // A verified link whose account no longer has its metadata means the cloud copy was erased
    // (from another device or the console). Never silently re-upload into it.
    // The same applies when it was erased and then recreated by another device: its metadata
    // carries a new createdAt (epoch), and this device's old revisions no longer describe it.
    if (link.state === 'linked') {
      const meta = await remote.getMeta()
      const epochChanged = meta !== null && link.cloudEpoch != null && meta.createdAt !== link.cloudEpoch
      if (!meta || epochChanged)
        throw new SyncError('cloud-reset', 'Los datos de esta cuenta se borraron de la nube. Desvincula el perfil y vuelve a vincularlo si quieres subirlos otra vez.')
      if (link.cloudEpoch == null && meta.createdAt != null) await db.syncLinks.update(profileId, { cloudEpoch: meta.createdAt })
    }
    const p = await pull(db, link, remote, now, clock)
    await finishSetRestore(db, profileId)
    const fresh = (await db.syncLinks.get(profileId))!
    const memo: EncodeMemo = new Map()
    const s = await push(db, fresh, remote, opts, now, memo)
    const after = await localChanges(db, profileId, memo)
    const pending = after.writes.length + after.deletes.length
    const partial = s.rejected > 0 || p.unreadable > 0
    await db.syncLinks.update(profileId, {
      lastSyncAt: now.toISOString(),
      // A partial success is shown as an error so it is never silent; later syncs keep working.
      lastError: partial ? partialMessage(s.rejected, p.unreadable) : null,
      lastErrorCode: partial ? 'partial' : null,
      pending,
      heldDeletes: s.heldDeletes,
    })
    return { pulled: p.pulled, applied: p.applied, pushed: s.pushed, conflicts: p.conflicts + s.conflicts, pending, heldDeletes: s.heldDeletes, rejected: s.rejected, unreadable: p.unreadable }
  } catch (e) {
    const code = e instanceof RemoteError || e instanceof SyncError ? e.code : 'unknown'
    // Only a code and a generic message are stored: never row contents.
    await db.syncLinks.update(profileId, { lastErrorCode: code, lastError: e instanceof Error ? e.message.slice(0, 200) : String(code) })
    throw e
  }
}

/** Pending local changes without touching the network (for the status badge). */
export async function pendingCount(db: SaludDB, profileId: string): Promise<number> {
  if (!(await db.syncLinks.get(profileId))) return 0
  const { writes, deletes } = await localChanges(db, profileId)
  return writes.length + deletes.length
}

export type ConflictChoice = 'local' | 'remote' | 'both' | 'merge'

const SESSIONS = 'trainingSessions'
const SETS = 'exerciseSets'
const restoreKey = (profileId: string) => `sync.restoreSets|${profileId}`
interface SetRestore {
  sessionIds: string[]
  setRowIds: string[]
}

/** A training session deleted on this device and changed on another one. */
export function isSessionDeletedHere(c: Pick<SyncConflict, 'table' | 'local' | 'remote'>): boolean {
  return c.table === SESSIONS && c.local === null && c.remote !== null
}
/** A training session deleted on another device while this one had unsynced changes to it. */
export function isSessionDeletedElsewhere(c: Pick<SyncConflict, 'table' | 'local' | 'remote'>): boolean {
  return c.table === SESSIONS && c.local !== null && c.remote === null
}
const isSessionDeletion = (c: Pick<SyncConflict, 'table' | 'local' | 'remote'>) => isSessionDeletedHere(c) || isSessionDeletedElsewhere(c)
const sessionOf = (c: Pick<SyncConflict, 'local' | 'remote'>) => ((c.local ?? c.remote) as { sessionId?: unknown } | null)?.sessionId

/**
 * Set conflicts that belong to a session deletion conflict: they are resolved together with it (same
 * choice) and the account screen shows them inside the session's card.
 */
export function dependentConflicts(all: readonly SyncConflict[], c: SyncConflict): SyncConflict[] {
  if (!isSessionDeletion(c)) return []
  return all.filter((x) => x.id !== c.id && x.table === SETS && sessionOf(x) === c.rowId && (x.local === null || x.remote === null))
}

/** Conflicts to show, with the dependent set conflicts folded into their session. */
export function conflictGroups(all: readonly SyncConflict[]): { conflict: SyncConflict; dependents: SyncConflict[] }[] {
  const folded = new Set<string>()
  const deps = new Map<string, SyncConflict[]>()
  for (const c of all) {
    const d = dependentConflicts(all, c)
    if (!d.length) continue
    deps.set(c.id, d)
    for (const x of d) folded.add(x.id)
  }
  return all.filter((c) => !folded.has(c.id)).map((c) => ({ conflict: c, dependents: deps.get(c.id) ?? [] }))
}

async function applyChoice(db: SaludDB, profileId: string, c: SyncConflict, choice: 'local' | 'remote') {
  const t = c.table as SyncedTableName
  if (choice === 'remote') {
    await writeLocal(db, t, profileId, c.rowId, (c.remote as Row | null) ?? null)
  }
  // Choosing local leaves the current row (or its later deletion) untouched.
}

/**
 * Resolves a conflict.
 * - local: this device's version is uploaded on the next sync (based on the server revision).
 * - remote: the other version replaces the local row.
 * - both: the local version is kept as a NEW row (new id) and the other version takes the original id.
 *   Not for training sessions (their sets would stay with the original only): use merge.
 * - merge (training sessions only): both versions are combined with mergeSessionRows; set rows are
 *   never touched. Two devices merging the same conflict produce the same bytes.
 *
 * A session deletion conflict decides the session and its sets together: the dependent set conflicts
 * get the same choice; if the session goes, every set of it on this device goes too; if a session
 * deleted here is restored, its held set deletions are undone and those sets come back from the
 * cloud on the next sync.
 */
export async function resolveConflict(db: SaludDB, profileId: string, conflictId: string, choice: ConflictChoice): Promise<void> {
  await db.transaction('rw', [db.syncConflicts, db.syncShadow, db.syncLinks, db.meta, db.profiles, ...syncTableNames(db)], async () => {
    const c = await db.syncConflicts.get(conflictId)
    if (!c || c.profileId !== profileId) throw new Error('Conflicto no encontrado')
    const t = c.table as SyncedTableName
    if (choice === 'merge') {
      if (!canMerge(c)) throw new Error('Este registro no admite combinar versiones')
      // The current row: edits made after the conflict was detected are kept too.
      const current = await readLocal(db, profileId, t, c.rowId)
      const sets = (await db.exerciseSets.where('sessionId').equals(c.rowId).toArray()).filter((s) => s.profileId === profileId)
      // A set held in a conflict can still come back. Its exercise (including targets and notes)
      // must survive this header merge even when no live set row currently refers to it.
      const open = await db.syncConflicts.where('profileId').equals(profileId).toArray()
      for (const d of open) {
        if (d.table !== SETS) continue
        for (const row of [d.local, d.remote]) {
          if (row?.sessionId === c.rowId && row.profileId === profileId) sets.push(row as unknown as ExerciseSet)
        }
      }
      const merged = mergeSessionRows((current ?? c.local) as Row, c.remote as Row, sets.map((s) => s.exerciseId), describeFromSets(sets))
      await writeLocal(db, t, profileId, c.rowId, merged)
      await db.syncConflicts.delete(conflictId)
      return
    }
    if (choice === 'both') {
      const current = await readLocal(db, profileId, t, c.rowId)
      if (!canKeepBoth({ ...c, local: current ?? null })) throw new Error('Este registro no admite conservar ambas versiones')
      await rowTable(db, t).put({ ...current!, id: crypto.randomUUID(), profileId })
      await writeLocal(db, t, profileId, c.rowId, c.remote as Row)
      await db.syncConflicts.delete(conflictId)
      return
    }
    await applyChoice(db, profileId, c, choice)
    await db.syncConflicts.delete(conflictId)
    if (t !== SESSIONS) return

    const all = await db.syncConflicts.where('profileId').equals(profileId).toArray()
    const keepSession = (await readLocal(db, profileId, t, c.rowId)) !== undefined
    if (!keepSession) {
      // Older edit/edit conflicts can also restore a set. Close every conflict that contains a
      // version belonging to this session, not just the delete/edit dependents shown in its card.
      const closed = all.filter((d) => d.table === SETS && [d.local, d.remote].some((row) => row?.sessionId === c.rowId))
      await db.syncConflicts.bulkDelete(closed.map((d) => d.id))
      // The session is gone, and so is every set of it on this device (never-synced ones and ones
      // that arrived from the other device included). Their deletions are pushed on the next sync.
      const sets = (await db.exerciseSets.where('sessionId').equals(c.rowId).toArray()).filter((s) => s.profileId === profileId)
      await db.exerciseSets.bulkDelete(sets.map((s) => s.id))
      return
    }
    if (!isSessionDeletion(c)) return
    for (const d of dependentConflicts(all, c)) {
      await applyChoice(db, profileId, d, choice)
      await db.syncConflicts.delete(d.id)
    }
    if (isSessionDeletedHere(c)) {
      // Restoring a session deleted here: its set deletions were held (never pushed), so those sets
      // still exist in the cloud. Forget the pending set deletions and re-read the account; after that
      // pull, finishSetRestore deletes again the restored sets that belong to other sessions.
      const shadows = await db.syncShadow.where('[profileId+table]').equals([profileId, SETS]).toArray()
      const pending: SyncShadow[] = []
      for (const sh of shadows) if (sh.hash !== null && !(await db.exerciseSets.get(sh.rowId))) pending.push(sh)
      const prev = (await db.meta.get(restoreKey(profileId)))?.value as SetRestore | undefined
      // A previous session restore may already have removed these sets' shadows. Still register
      // this session so finishSetRestore does not treat its recovered sets as unrelated deletions.
      if (!pending.length && !prev) return
      const value: SetRestore = {
        sessionIds: [...new Set([...(prev?.sessionIds ?? []), c.rowId])],
        setRowIds: [...new Set([...(prev?.setRowIds ?? []), ...pending.map((s) => s.rowId)])],
      }
      await db.meta.put({ key: restoreKey(profileId), value })
      await db.syncShadow.bulkDelete(pending.map((s) => s.k))
      await db.syncLinks.update(profileId, { cursor: null })
    }
  })
}

/** After a completed pull: deletes again the restored sets that do not belong to a restored session. */
async function finishSetRestore(db: SaludDB, profileId: string) {
  const m = await db.meta.get(restoreKey(profileId))
  if (!m) return
  const { sessionIds, setRowIds } = m.value as SetRestore
  await db.transaction('rw', [db.exerciseSets, db.meta], async () => {
    for (const id of setRowIds) {
      const row = await db.exerciseSets.get(id)
      if (row && row.profileId === profileId && !sessionIds.includes(row.sessionId)) await db.exerciseSets.delete(id)
    }
    await db.meta.delete(restoreKey(profileId))
  })
}

/**
 * Remote deletions in one pulled page that must NOT be applied silently: a training session deleted on
 * another device while this device has unsynced changes to it (the session row, any of its sets or a
 * new set), and the deletions of that session's sets. They become conflicts instead.
 */
async function sessionDeletionGuard(db: SaludDB, pid: string, docs: RemoteDoc[]): Promise<(t: string, local: Row) => boolean> {
  const deletedInPage = new Set<string>()
  const candidates = new Set<string>()
  for (const d of docs) {
    if (!d.del || !isSyncedTable(d.t) || docKey(d.t, d.id) !== d.key) continue
    if (d.t === SESSIONS) {
      const id = localRowId(d.id, pid)
      deletedInPage.add(id)
      candidates.add(id)
    } else if (d.t === SETS) {
      const s = await db.exerciseSets.get(localRowId(d.id, pid))
      if (s && s.profileId === pid) candidates.add(s.sessionId)
    }
  }
  const guarded = new Set<string>()
  for (const sid of candidates) if (await sessionNeedsGuard(db, pid, sid, deletedInPage.has(sid))) guarded.add(sid)
  return (t, local) => (t === SESSIONS ? guarded.has(String(local.id)) : t === SETS ? guarded.has(String(local.sessionId)) : false)
}

async function sessionNeedsGuard(db: SaludDB, pid: string, sid: string, deletedInPage: boolean): Promise<boolean> {
  const session = await db.trainingSessions.get(sid)
  if (!session || session.profileId !== pid) return false
  const key = docKey(SESSIONS, cloudRowId(sid, pid))
  const sh = await db.syncShadow.get(shadowKey(pid, key))
  const conflict = await db.syncConflicts.where('[profileId+key]').equals([pid, key]).first()
  // Only a session that is being deleted remotely: in this page, already (shadow says deleted), or
  // waiting in a conflict. A single set deleted elsewhere is a normal deletion.
  const deletedRemotely = deletedInPage || sh?.hash === null || (conflict !== undefined && conflict.remote === null)
  if (!deletedRemotely) return false
  if (conflict) return true
  if (!sh || sh.hash !== encodeRow(SESSIONS, session as unknown as Row, pid).h) return true
  const sets = (await db.exerciseSets.where('sessionId').equals(sid).toArray()).filter((s) => s.profileId === pid)
  for (const s of sets) {
    const enc = encodeRow(SETS, s as unknown as Row, pid)
    const ssh = await db.syncShadow.get(shadowKey(pid, enc.key))
    if (!ssh || ssh.hash !== enc.h) return true
  }
  return false
}

/** Whether "keep both" is possible for a conflict (same rule as resolveConflict). Never for sessions. */
export function canKeepBoth(c: Pick<SyncConflict, 'table' | 'rowId' | 'local' | 'remote'>): boolean {
  return c.table !== PROFILE_TABLE && c.table !== SESSIONS && !c.rowId.includes('|') && !!c.local && !!c.remote
}

/** Whether "Combinar" is possible: a training session changed on both devices. */
export function canMerge(c: Pick<SyncConflict, 'table' | 'local' | 'remote'>): boolean {
  return c.table === SESSIONS && !!c.local && !!c.remote
}


/**
 * Undo held deletions: forget the local "deleted" state of rows that still exist in the cloud and
 * re-read the account, so those rows come back to this device. Nothing is deleted anywhere.
 */
export async function restoreDeletedFromCloud(db: SaludDB, profileId: string, remote: RemoteStore, opts: SyncOptions = {}): Promise<SyncResult> {
  const { deletes } = await localChanges(db, profileId)
  await db.transaction('rw', [db.syncShadow, db.syncLinks], async () => {
    await db.syncShadow.bulkDelete(deletes.map((d) => shadowKey(profileId, d.key)))
    await db.syncLinks.update(profileId, { cursor: null, heldDeletes: 0 })
  })
  return syncProfile(db, profileId, remote, opts)
}
