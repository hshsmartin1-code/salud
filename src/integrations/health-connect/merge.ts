import type { Repo } from '../../db/repo'
import type { HealthMetric, HealthRecord } from '../../db/types'
import type { HealthRow } from './mapper'

export interface MergeResult {
  added: number
  updated: number
  unchanged: number
}

const SAME_KEYS = ['kind', 'metric', 'date', 'start', 'end', 'value', 'unit', 'device', 'externalId', 'lastModified', 'title'] as const

/** True when re-importing `next` over `prev` would not change anything the person can see. */
function sameContent(prev: HealthRecord, next: HealthRow): boolean {
  for (const k of SAME_KEYS) if ((prev[k] ?? null) !== (next[k] ?? null)) return false
  if (JSON.stringify([...prev.sources].sort()) !== JSON.stringify([...next.sources].sort())) return false
  return JSON.stringify(prev.detail ?? {}) === JSON.stringify(next.detail ?? {})
}

/**
 * Upsert imported rows. De-duplicates by id (re-sync is idempotent) and PRESERVES the person's `excluded`
 * choice: when a row exists, its `excluded` value wins over whatever the import suggests.
 */
export async function upsertHealthRows(r: Repo, rows: readonly HealthRow[]): Promise<MergeResult> {
  const result: MergeResult = { added: 0, updated: 0, unchanged: 0 }
  if (rows.length === 0) return result
  // last occurrence wins when a batch repeats an id
  const byId = new Map<string, HealthRow>()
  for (const row of rows) byId.set(row.id, row)
  const ids = [...byId.keys()]
  const existing = await r.db.healthRecords.bulkGet(ids)
  const toWrite: (HealthRow | HealthRecord)[] = []
  ids.forEach((id, i) => {
    const next = byId.get(id)!
    const prev = existing[i]
    if (!prev) {
      result.added++
      toWrite.push(next)
      return
    }
    if (prev.profileId !== r.profileId) throw new Error('Un registro importado pertenece a otro perfil')
    if (sameContent(prev, next)) {
      result.unchanged++
      return
    }
    result.updated++
    const merged: HealthRow = { ...next, importedAt: prev.importedAt }
    if (prev.excluded !== undefined) merged.excluded = prev.excluded
    toWrite.push(merged)
  })
  if (toWrite.length) await r.bulkPut('healthRecords', toWrite)
  return result
}

/** Removes rows whose `externalId` is one of the deleted Health Connect ids. Returns how many were removed. */
export async function deleteByExternalIds(r: Repo, externalIds: readonly string[]): Promise<number> {
  let removed = 0
  for (const ext of externalIds) {
    const rows = await r.byIndex('healthRecords', 'externalId', ext)
    if (rows.length) {
      await r.removeMany('healthRecords', rows.map((x) => x.id))
      removed += rows.length
    }
  }
  return removed
}

/**
 * Daily rows in [from, to] for these metrics that the latest aggregate no longer produces
 * (data deleted/changed in Health Connect) are removed.
 */
export async function pruneDaily(r: Repo, from: string, to: string, metrics: readonly HealthMetric[], keepIds: ReadonlySet<string>): Promise<number> {
  const rows = await r.range('healthRecords', from, to)
  const stale = rows.filter((x) => x.kind === 'daily' && metrics.includes(x.metric) && !keepIds.has(x.id)).map((x) => x.id)
  if (stale.length) await r.removeMany('healthRecords', stale)
  return stale.length
}

/** Deletes imported rows of the given metrics (or all when omitted) for this profile. */
export async function deleteImported(r: Repo, metrics?: readonly HealthMetric[]): Promise<number> {
  const rows = await r.all('healthRecords')
  const ids = rows.filter((x) => x.provider === 'health-connect' && (!metrics || metrics.includes(x.metric))).map((x) => x.id)
  if (ids.length) await r.removeMany('healthRecords', ids)
  return ids.length
}
