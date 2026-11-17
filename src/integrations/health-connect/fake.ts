import type { HcChanges, HcDailyDay, HcDailyMetric, HcNativeRecord, HcRawType, HcStatus, HealthConnectPlugin } from './types'

/** In-memory Health Connect used by tests (and as a reference for the native plugin's contract). Synthetic data only. */
export class FakeHealthConnect implements HealthConnectPlugin {
  status: HcStatus = { available: true }
  granted = new Set<string>()
  grantOnRequest = true
  daily: HcDailyDay[] = []
  skipped: HcDailyMetric[] = []
  pageSize = 2
  calls: string[] = []

  private records = new Map<string, HcNativeRecord>()
  private version = 0
  private journal: { v: number; type: HcRawType; upsert?: HcNativeRecord; del?: string }[] = []
  private tokens = new Map<string, { type: HcRawType; v: number }>()
  private expired = new Set<string>()
  private n = 0

  setRecord(rec: HcNativeRecord) {
    this.version++
    this.records.set(rec.id, rec)
    this.journal.push({ v: this.version, type: rec.type, upsert: rec })
  }
  removeRecord(id: string) {
    const rec = this.records.get(id)
    if (!rec) return
    this.version++
    this.records.delete(id)
    this.journal.push({ v: this.version, type: rec.type, del: id })
  }
  expireAllTokens() {
    for (const t of this.tokens.keys()) this.expired.add(t)
  }

  getStatus() {
    this.calls.push('getStatus')
    return Promise.resolve(this.status)
  }
  openInstallOrUpdate() {
    return Promise.resolve()
  }
  openSettings() {
    return Promise.resolve()
  }
  getGrantedPermissions() {
    return Promise.resolve({ granted: [...this.granted] })
  }
  requestReadPermissions(o: { permissions: string[] }) {
    this.calls.push('requestReadPermissions')
    if (this.grantOnRequest) for (const p of o.permissions) this.granted.add(p)
    return Promise.resolve({ granted: [...this.granted] })
  }
  revokeAll() {
    this.calls.push('revokeAll')
    this.granted.clear()
    return Promise.resolve()
  }
  readDailyAggregates(o: { from: string; to: string; metrics: HcDailyMetric[] }) {
    this.calls.push('readDailyAggregates')
    const days = this.daily
      .filter((d) => d.date >= o.from && d.date <= o.to)
      .map((d) => ({
        date: d.date,
        values: Object.fromEntries(Object.entries(d.values).filter(([k]) => o.metrics.includes(k as HcDailyMetric) && !this.skipped.includes(k as HcDailyMetric))),
        origins: d.origins,
      }))
    return Promise.resolve({ days, skipped: this.skipped.filter((m) => o.metrics.includes(m)) })
  }
  readRecords(o: { type: HcRawType; from: string; to: string; pageToken?: string }) {
    this.calls.push(`readRecords:${o.type}`)
    const all = [...this.records.values()].filter((r) => r.type === o.type && r.date >= o.from && r.date <= o.to).sort((a, b) => a.id.localeCompare(b.id))
    const offset = o.pageToken ? Number(o.pageToken) : 0
    const page = all.slice(offset, offset + this.pageSize)
    const next = offset + this.pageSize < all.length ? String(offset + this.pageSize) : undefined
    return Promise.resolve({ records: page, pageToken: next })
  }
  getChangesToken(o: { type: HcRawType }) {
    this.calls.push(`getChangesToken:${o.type}`)
    const token = `tok-${o.type}-${this.n++}`
    this.tokens.set(token, { type: o.type, v: this.version })
    return Promise.resolve({ token })
  }
  getChanges(o: { token: string }): Promise<HcChanges> {
    this.calls.push('getChanges')
    const t = this.tokens.get(o.token)
    if (!t || this.expired.has(o.token)) return Promise.resolve({ expired: true, upserts: [], deletedIds: [], nextToken: o.token, hasMore: false })
    const next = `tok-${t.type}-${this.n++}`
    this.tokens.set(next, { type: t.type, v: this.version })
    const mine = this.journal.filter((j) => j.v > t.v && j.type === t.type)
    return Promise.resolve({
      expired: false,
      upserts: mine.filter((j) => j.upsert).map((j) => j.upsert as HcNativeRecord),
      deletedIds: mine.filter((j) => j.del).map((j) => j.del as string),
      nextToken: next,
      hasMore: false,
    })
  }
}
