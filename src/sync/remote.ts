/**
 * Remote store contract. Implemented by Firestore (firestoreRemote.ts) and by an in-memory double
 * that enforces the same rules (memoryRemote.ts), so the engine is tested without a network.
 *
 * Every document lives under one account (uid). Writes carry the revision they were based on; the
 * server (security rules) accepts a write only if `rev == stored rev + 1` (or 1 for a new row), which
 * gives optimistic concurrency without trusting clocks.
 */

export interface RemoteDoc {
  key: string
  t: string
  id: string
  rev: number
  del: boolean
  d: string | null
  h: string | null
  /** Server time in microseconds (Firestore server timestamps have µs precision; a batch shares one). */
  at: number
}

export interface RemoteWrite {
  key: string
  t: string
  id: string
  /** Revision the local change was based on; 0 = new row. */
  baseRev: number
  del: boolean
  d: string | null
  h: string | null
}

export type CommitOneResult = { ok: true; rev: number } | { ok: false; current: RemoteDoc | null }

export interface RemoteMeta {
  profileName: string | null
  createdAt: number | null
  schema: number
  appVersion: string
}

export interface RemoteStore {
  readonly uid: string
  /** Changes with `at >= since` (all when null), ordered by (at, key), after the given position. */
  pull(since: number | null, after: { at: number; key: string } | null, limit: number): Promise<RemoteDoc[]>
  /** All or nothing. Throws RemoteError('conflict') if any baseRev is stale. */
  commit(writes: RemoteWrite[]): Promise<void>
  /** Transactional single write that reports the current server version on a conflict. */
  commitOne(write: RemoteWrite): Promise<CommitOneResult>
  /** Non-deleted rows per table. */
  liveCounts(): Promise<Record<string, number>>
  /** Non-deleted documents of one table ordered by key, after `afterKey` (one read per document). */
  listLive(table: string, afterKey: string | null, limit: number): Promise<RemoteDoc[]>
  getMeta(): Promise<RemoteMeta | null>
  setMeta(meta: RemoteMeta): Promise<void>
  /** Erase every document of this account (data deletion). Returns the number removed. */
  deleteAll(): Promise<number>
}

export type RemoteErrorCode = 'conflict' | 'offline' | 'auth' | 'permission' | 'quota' | 'invalid' | 'unknown'

export class RemoteError extends Error {
  readonly code: RemoteErrorCode
  constructor(code: RemoteErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
    this.name = 'RemoteError'
  }
}
