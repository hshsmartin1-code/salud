import { RemoteError, type CommitOneResult, type RemoteDoc, type RemoteMeta, type RemoteStore, type RemoteWrite } from './remote'

/**
 * In-memory server shared by several simulated devices. It applies the same acceptance rule as the
 * Firestore security rules (per-account isolation, rev == stored + 1) and can inject faults:
 * offline periods, lost acknowledgements (write applied but the client sees an error) and commits
 * that become visible with an older server timestamp than a later read (out-of-order visibility).
 */
export class MemoryServer {
  private accounts = new Map<string, Map<string, RemoteDoc>>()
  private metas = new Map<string, RemoteMeta>()
  private clock = 1_000_000
  offline = false
  /** The next N commit calls apply their writes but then fail as if the response was lost. */
  loseAcks = 0
  /** The next accepted write gets a timestamp this many µs in the past. */
  backdateNext = 0
  /** Document keys the "rules" refuse (permission denied), like an invalid or oversized row. */
  refuseKeys = new Set<string>()
  /**
   * Call counters. `reads` follows Firestore billing for the calls the engine makes on every sync: one
   * read per returned document and one for a query that returns nothing; one per metadata get.
   */
  readonly calls = { pull: 0, commit: 0, commitOne: 0, written: 0, reads: 0 }

  docs(uid: string): Map<string, RemoteDoc> {
    let m = this.accounts.get(uid)
    if (!m) this.accounts.set(uid, (m = new Map()))
    return m
  }

  /** Current server time (µs). */
  get now(): number {
    return this.clock
  }

  /** Lets server time pass (µs), e.g. minutes between two syncs. */
  advance(us: number): void {
    this.clock += us
  }

  /** One server timestamp; every write of a batch shares it, as in Firestore. */
  tick(): number {
    this.clock += 10
    if (this.backdateNext) {
      const at = this.clock - this.backdateNext
      this.backdateNext = 0
      return at
    }
    return this.clock
  }

  /** Same acceptance rule as firestore.rules. */
  accepts(uid: string, w: RemoteWrite): boolean {
    const cur = this.docs(uid).get(w.key)
    return cur ? cur.rev === w.baseRev : w.baseRev === 0
  }

  apply(uid: string, w: RemoteWrite, at = this.tick()): RemoteDoc {
    const doc: RemoteDoc = { key: w.key, t: w.t, id: w.id, rev: w.baseRev + 1, del: w.del, d: w.del ? null : w.d, h: w.del ? null : w.h, at }
    this.docs(uid).set(w.key, doc)
    this.calls.written++
    return doc
  }

  getMeta(uid: string) {
    return this.metas.get(uid) ?? null
  }
  setMeta(uid: string, m: RemoteMeta) {
    this.metas.set(uid, m)
  }
  clearMeta(uid: string) {
    this.metas.delete(uid)
  }
  remote(uid: string): MemoryRemote {
    return new MemoryRemote(this, uid)
  }
}

export class MemoryRemote implements RemoteStore {
  private server: MemoryServer
  readonly uid: string
  constructor(server: MemoryServer, uid: string) {
    this.server = server
    this.uid = uid
  }

  private online() {
    if (this.server.offline) throw new RemoteError('offline', 'Sin conexión')
  }

  async pull(since: number | null, after: { at: number; key: string } | null, limit: number): Promise<RemoteDoc[]> {
    this.online()
    this.server.calls.pull++
    const out = [...this.server.docs(this.uid).values()]
      .filter((d) => since === null || d.at >= since)
      .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .filter((d) => !after || d.at > after.at || (d.at === after.at && d.key > after.key))
      .slice(0, limit)
      .map((d) => ({ ...d }))
    this.server.calls.reads += Math.max(1, out.length)
    return out
  }

  async commit(writes: RemoteWrite[]): Promise<void> {
    this.online()
    this.server.calls.commit++
    if (writes.some((w) => this.server.refuseKeys.has(w.key))) throw new RemoteError('permission', 'Permiso denegado')
    if (writes.some((w) => !this.server.accepts(this.uid, w))) throw new RemoteError('conflict', 'Revisión desactualizada')
    const at = this.server.tick()
    for (const w of writes) this.server.apply(this.uid, w, at)
    if (this.server.loseAcks > 0) {
      this.server.loseAcks--
      throw new RemoteError('offline', 'Respuesta perdida')
    }
  }

  async commitOne(w: RemoteWrite): Promise<CommitOneResult> {
    this.online()
    this.server.calls.commitOne++
    if (this.server.refuseKeys.has(w.key)) throw new RemoteError('permission', 'Permiso denegado')
    if (!this.server.accepts(this.uid, w)) {
      const cur = this.server.docs(this.uid).get(w.key)
      return { ok: false, current: cur ? { ...cur } : null }
    }
    const doc = this.server.apply(this.uid, w)
    return { ok: true, rev: doc.rev }
  }

  async liveCounts(): Promise<Record<string, number>> {
    this.online()
    const out: Record<string, number> = {}
    for (const d of this.server.docs(this.uid).values()) if (!d.del) out[d.t] = (out[d.t] ?? 0) + 1
    return out
  }

  async listLive(table: string, afterKey: string | null, limit: number): Promise<RemoteDoc[]> {
    this.online()
    const out = [...this.server.docs(this.uid).values()]
      .filter((d) => d.t === table && !d.del && (afterKey === null || d.key > afterKey))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, limit)
      .map((d) => ({ ...d }))
    this.server.calls.reads += Math.max(1, out.length)
    return out
  }

  async getMeta() {
    this.online()
    this.server.calls.reads++
    return this.server.getMeta(this.uid)
  }
  async setMeta(m: RemoteMeta) {
    this.online()
    this.server.setMeta(this.uid, m)
  }
  async deleteAll(): Promise<number> {
    this.online()
    const docs = this.server.docs(this.uid)
    const n = docs.size
    docs.clear()
    this.server.clearMeta(this.uid)
    return n
  }
}
