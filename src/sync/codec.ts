import { stableId } from '../db/backup'
import { PROFILE_TABLE } from './syncTables'

/**
 * Local ↔ cloud row representation.
 * - The local profileId never leaves the device: it is removed from rows, and composite ids
 *   (`<profileId>|…`) become `@|…`; the profile row itself is `@`. Another device maps them back to
 *   ITS local profile, so rows can only ever land in the profile linked to that account.
 * - The row body is stored as one JSON string (`d`): no Firestore type surprises (nested arrays,
 *   undefined), nothing indexed by the server, and room for optional client-side encryption later.
 */

export function cloudRowId(id: string, profileId: string): string {
  if (id === profileId) return '@'
  if (id.startsWith(profileId + '|')) return '@|' + id.slice(profileId.length + 1)
  return id
}

export function localRowId(cloudId: string, profileId: string): string {
  if (cloudId === '@') return profileId
  if (cloudId.startsWith('@|')) return profileId + '|' + cloudId.slice(2)
  return cloudId
}

/** Firestore document id for a row: unique per table, safe characters only. */
export function docKey(table: string, cloudId: string): string {
  return `${table}~${encodeURIComponent(cloudId).replace(/\./g, '%2E')}`
}

export function shadowKey(profileId: string, key: string): string {
  return `${profileId}|${key}`
}

function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === 'string') return f(v)
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]))
  return v
}

/** JSON with sorted keys and without undefined values, so equal rows always hash the same. */
export function stableStringify(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map((i) => (i === undefined ? null : norm(i)))
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x).sort()) {
        const val = (x as Record<string, unknown>)[k]
        if (val !== undefined) out[k] = norm(val)
      }
      return out
    }
    return x
  }
  return JSON.stringify(norm(v))
}

export const contentHash = (d: string): string => stableId(`sync:${d}`)

export interface EncodedRow {
  cloudId: string
  key: string
  d: string
  h: string
}

export function encodeRow(table: string, row: Record<string, unknown>, profileId: string): EncodedRow {
  const { id, profileId: _owner, ...rest } = row
  void _owner
  const cloudId = cloudRowId(String(id), profileId)
  const body = mapStrings(rest, (s) => (s.startsWith(profileId + '|') ? '@|' + s.slice(profileId.length + 1) : s))
  const d = stableStringify(body)
  return { cloudId, key: docKey(table, cloudId), d, h: contentHash(d) }
}

/**
 * Whether two versions of one row hold the same record and differ at most in `createdAt`/`updatedAt`
 * (the same change made on two devices, or the same composite-id row created on both). Such a pair is
 * not a conflict: the account screen would show a card without any visible difference.
 */
export function sameContent(table: string, a: Record<string, unknown>, b: Record<string, unknown>, profileId: string): boolean {
  const body = (r: Record<string, unknown>) => {
    const { createdAt: _c, updatedAt: _u, ...rest } = r
    void _c
    void _u
    return encodeRow(table, rest, profileId).d
  }
  return body(a) === body(b)
}

export function decodeRow(table: string, cloudId: string, d: string, profileId: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(d)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Registro remoto inválido')
  const body = mapStrings(parsed, (s) => (s.startsWith('@|') ? profileId + '|' + s.slice(2) : s)) as Record<string, unknown>
  delete body.profileId
  delete body.id
  const id = localRowId(cloudId, profileId)
  return table === PROFILE_TABLE ? { ...body, id: profileId } : { ...body, id, profileId }
}
