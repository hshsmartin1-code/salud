import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDocFromServer,
  getDocsFromServer,
  limit as qLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore'
import { RemoteError, type CommitOneResult, type RemoteDoc, type RemoteErrorCode, type RemoteMeta, type RemoteStore, type RemoteWrite } from './remote'
import { PROFILE_TABLE, SYNC_TABLES } from './syncTables'

/**
 * RemoteStore over Cloud Firestore.
 *
 *   users/{uid}            meta: { profileName, createdAt, schema, appVersion }
 *   users/{uid}/rows/{key} { t, id, rev, del, d, h, at }   (d = row JSON without local ids)
 *
 * The security rules (firestore.rules) only let the signed-in uid touch its own tree and only accept
 * `rev == stored + 1`, so a stale write fails on the server instead of overwriting.
 */

const NETWORK_TIMEOUT_MS = 30_000

/** Firestore Timestamp → integer microseconds (exact; a batch shares one server timestamp). */
export const toMicros = (t: Timestamp) => t.seconds * 1_000_000 + Math.floor(t.nanoseconds / 1000)
export const fromMicros = (us: number) => new Timestamp(Math.floor(us / 1_000_000), (us % 1_000_000) * 1000)

export function mapFirestoreError(e: unknown): RemoteError {
  if (e instanceof RemoteError) return e
  const code = (e as { code?: string })?.code ?? ''
  const map: Record<string, RemoteErrorCode> = {
    'permission-denied': 'permission',
    unauthenticated: 'auth',
    unavailable: 'offline',
    'deadline-exceeded': 'offline',
    aborted: 'offline',
    cancelled: 'offline',
    'resource-exhausted': 'quota',
    'invalid-argument': 'invalid',
    'failed-precondition': 'invalid',
    'out-of-range': 'invalid',
  }
  // Only the code and Firestore's own message are kept: never row contents.
  const msg = String((e as { message?: string })?.message ?? '').slice(0, 160)
  return new RemoteError(map[code] ?? 'unknown', msg || code || 'Error de Firestore')
}

async function guarded<T>(p: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new RemoteError('offline', 'Sin conexión')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RemoteError('offline', 'Tiempo de espera agotado')), NETWORK_TIMEOUT_MS)
      }),
    ])
  } catch (e) {
    throw mapFirestoreError(e)
  } finally {
    clearTimeout(timer)
  }
}

function toDoc(key: string, data: DocumentData): RemoteDoc | null {
  if (!(data.at instanceof Timestamp)) return null // cannot be in an `at` query anyway
  // Malformed (console edit): keep its position so paging continues, with a table the engine skips.
  if (typeof data.t !== 'string' || typeof data.id !== 'string' || typeof data.rev !== 'number')
    return { key, t: '', id: '', rev: 0, del: false, d: null, h: null, at: toMicros(data.at) }
  return {
    key,
    t: data.t,
    id: data.id,
    rev: data.rev,
    del: data.del === true,
    d: typeof data.d === 'string' ? data.d : null,
    h: typeof data.h === 'string' ? data.h : null,
    at: toMicros(data.at),
  }
}

const body = (w: RemoteWrite) => ({ t: w.t, id: w.id, rev: w.baseRev + 1, del: w.del, d: w.del ? null : w.d, h: w.del ? null : w.h, at: serverTimestamp() })

export class FirestoreRemote implements RemoteStore {
  readonly uid: string
  private fs: Firestore
  constructor(fs: Firestore, uid: string) {
    this.fs = fs
    this.uid = uid
  }

  private rows() {
    return collection(this.fs, 'users', this.uid, 'rows')
  }

  pull(since: number | null, after: { at: number; key: string } | null, limit: number): Promise<RemoteDoc[]> {
    return guarded(async () => {
      const c: QueryConstraint[] = []
      if (since !== null && since > 0) c.push(where('at', '>=', fromMicros(since)))
      c.push(orderBy('at'), orderBy(documentId()))
      if (after) c.push(startAfter(fromMicros(after.at), after.key))
      c.push(qLimit(limit))
      const snap = await getDocsFromServer(query(this.rows(), ...c))
      const out: RemoteDoc[] = []
      for (const d of snap.docs) {
        const r = toDoc(d.id, d.data())
        if (r) out.push(r)
      }
      return out
    })
  }

  commit(writes: RemoteWrite[]): Promise<void> {
    return guarded(async () => {
      const b = writeBatch(this.fs)
      for (const w of writes) b.set(doc(this.rows(), w.key), body(w))
      await b.commit()
    })
  }

  commitOne(w: RemoteWrite): Promise<CommitOneResult> {
    return guarded(() =>
      runTransaction(this.fs, async (tx) => {
        const ref = doc(this.rows(), w.key)
        const snap = await tx.get(ref)
        const cur = snap.exists() ? toDoc(snap.id, snap.data()) : null
        const curRev = snap.exists() ? Number(snap.data().rev ?? -1) : 0
        if (curRev !== w.baseRev) return { ok: false as const, current: cur }
        tx.set(ref, body(w))
        return { ok: true as const, rev: w.baseRev + 1 }
      }),
    )
  }

  liveCounts(): Promise<Record<string, number>> {
    return guarded(async () => {
      const tables = [PROFILE_TABLE, ...SYNC_TABLES]
      const counts = await Promise.all(
        tables.map((t) => getCountFromServer(query(this.rows(), where('t', '==', t), where('del', '==', false))).then((s) => s.data().count)),
      )
      const out: Record<string, number> = {}
      tables.forEach((t, i) => {
        if (counts[i]) out[t] = counts[i]!
      })
      return out
    })
  }

  getMeta(): Promise<RemoteMeta | null> {
    return guarded(async () => {
      const snap = await getDocFromServer(doc(this.fs, 'users', this.uid))
      if (!snap.exists()) return null
      const m = snap.data()
      return {
        profileName: typeof m.profileName === 'string' ? m.profileName : null,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : null,
        schema: typeof m.schema === 'number' ? m.schema : 0,
        appVersion: typeof m.appVersion === 'string' ? m.appVersion : '',
      }
    })
  }

  setMeta(meta: RemoteMeta): Promise<void> {
    return guarded(() => setDoc(doc(this.fs, 'users', this.uid), { ...meta }))
  }

  deleteAll(): Promise<number> {
    return guarded(async () => {
      let n = 0
      for (;;) {
        const snap = await getDocsFromServer(query(this.rows(), qLimit(400)))
        if (snap.empty) break
        const b = writeBatch(this.fs)
        snap.docs.forEach((d) => b.delete(d.ref))
        await b.commit()
        n += snap.size
      }
      await deleteDoc(doc(this.fs, 'users', this.uid))
      return n
    })
  }
}
