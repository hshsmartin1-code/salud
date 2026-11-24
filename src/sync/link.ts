import { APP_VERSION } from '../db/backup'
import { createProfile, deleteProfile } from '../db/profiles'
import { SCHEMA_VERSION, type SaludDB } from '../db/schema'
import type { SyncLink } from '../db/types'
import { cloudRowId, decodeRow, docKey, encodeRow, shadowKey } from './codec'
import { DUPLICATE_TABLES, findProbableDuplicates, SKIPPABLE_DUPLICATE_TABLES, type DuplicateTable } from './duplicates'
import { syncProfile, type SyncResult } from './engine'
import type { RemoteDoc, RemoteMeta, RemoteStore } from './remote'
import { PROFILE_TABLE, SYNC_TABLES, TABLES_VERSION } from './syncTables'

/**
 * Linking a local profile to an account (first sign-in) — explicit, previewed and recoverable:
 *  1. preview: what is on this device and what the account already holds;
 *  2. refuse anything that could mix two people (account already linked to another local profile,
 *     profile already linked to another account) and require confirmation when the account holds
 *     data under a different profile name;
 *  3. merge (union by id; same row edited differently → conflict, nothing overwritten) or download
 *     the account into a NEW local profile, leaving the current one untouched. Probable duplicates
 *     (the same record entered on both sides under two ids) are shown first and can be left out of
 *     the merge: each side keeps its own copy and nothing is deleted (see leaveOutDuplicates);
 *  4. verify counts before marking the link as verified.
 * Local data is never deleted by any of these steps; a failed or interrupted run resumes on the next
 * sync because progress lives in the per-row shadow.
 */

export interface Account {
  uid: string
  email: string | null
  displayName: string | null
}

export interface LinkPreview {
  local: Record<string, number>
  localTotal: number
  remote: Record<string, number>
  remoteTotal: number
  remoteMeta: RemoteMeta | null
  /** The account was filled from a profile with another name: confirm it is the same person. */
  nameMismatch: boolean
  /** Local profile already using this account on this device (linking is refused). */
  accountUsedBy: string | null
  /** This profile is already linked (to the same or another account). */
  existingLink: SyncLink | null
  /** Probable duplicates between both sides (only when asked for; null = not checked). */
  duplicates: DuplicateSummary | null
  /** Asked for, but the account could not be read for it (the merge then works as before). */
  duplicatesFailed: boolean
}

/** A probable duplicate: the same real record on this device and in the account, under two ids. */
export interface LinkDuplicate {
  table: DuplicateTable
  /** This device's copy and its content hash when previewed. */
  localId: string
  localHash: string
  /** The account's copy: document key, revision when previewed and the row id it maps to here. */
  remoteKey: string
  remoteRev: number
  remoteId: string
}

export interface DuplicateSummary {
  pairs: LinkDuplicate[]
  byTable: Partial<Record<DuplicateTable, number>>
  /** Pairs that "Omitir duplicados probables" can leave out (training sessions are only reported). */
  skippable: number
}

type Row = Record<string, unknown> & { id: string; profileId?: string }
const LIST_PAGE = 300

/**
 * Reads the account's rows of the tables where duplicates are looked for (only where both sides have
 * rows; one read per document) and pairs them with this device's rows (see duplicates.ts). Rows that
 * already take part in sync (they have a shadow) are left out.
 */
export async function findLinkDuplicates(db: SaludDB, profileId: string, remote: RemoteStore, local: Record<string, number>, remoteCounts: Record<string, number>): Promise<DuplicateSummary> {
  const pairs: LinkDuplicate[] = []
  const byTable: DuplicateSummary['byTable'] = {}
  for (const t of DUPLICATE_TABLES) {
    if (!local[t] || !remoteCounts[t]) continue
    const known = new Set((await db.syncShadow.where('[profileId+table]').equals([profileId, t]).toArray()).map((s) => s.k))
    const mine = new Map<string, string>()
    const mineRows: Row[] = []
    for (const row of (await db.table(t).where('profileId').equals(profileId).toArray()) as Row[]) {
      const enc = encodeRow(t, row, profileId)
      if (known.has(shadowKey(profileId, enc.key))) continue
      mine.set(row.id, enc.h)
      mineRows.push(row)
    }
    const theirs = new Map<string, RemoteDoc>()
    const theirRows: Row[] = []
    for (let after: string | null = null; ;) {
      const docs = await remote.listLive(t, after, LIST_PAGE)
      for (const d of docs) {
        if (d.t !== t || d.d === null || docKey(t, d.id) !== d.key || known.has(shadowKey(profileId, d.key))) continue
        let row: Row
        try {
          row = decodeRow(t, d.id, d.d, profileId) as Row
        } catch {
          continue // unreadable: never compared
        }
        theirs.set(row.id, d)
        theirRows.push(row)
      }
      if (docs.length < LIST_PAGE) break
      after = docs[docs.length - 1]!.key
    }
    const found = findProbableDuplicates(t, mineRows, theirRows)
    if (!found.length) continue
    byTable[t] = found.length
    for (const m of found) {
      const d = theirs.get(m.remoteId)!
      pairs.push({ table: t, localId: m.localId, localHash: mine.get(m.localId)!, remoteKey: d.key, remoteRev: d.rev, remoteId: m.remoteId })
    }
  }
  return { pairs, byTable, skippable: pairs.filter((p) => SKIPPABLE_DUPLICATE_TABLES.has(p.table)).length }
}

/**
 * "Omitir duplicados probables": each side keeps its own copy of a probable duplicate and the merge
 * copies neither. This device's copy is recorded as agreed at revision 0 (so it is not uploaded) and the
 * account's copy as absent here at its revision (so it is not downloaded, and its absence is not a
 * deletion). Nothing is deleted on either side. A later change to either copy syncs normally: a new
 * revision of the account's copy is downloaded, and an edited local copy is uploaded as its own row, so
 * no edit is ever held back (at worst the pair shows up twice and can be deleted by hand).
 * A pair whose local copy changed since the preview, or that already takes part in sync, is merged
 * normally instead. Runs inside the link transaction.
 */
async function leaveOutDuplicates(db: SaludDB, profileId: string, pairs: readonly LinkDuplicate[]): Promise<number> {
  let n = 0
  for (const p of pairs) {
    if (!SKIPPABLE_DUPLICATE_TABLES.has(p.table)) continue
    if (docKey(p.table, cloudRowId(p.remoteId, profileId)) !== p.remoteKey) continue
    const row = (await db.table(p.table).get(p.localId)) as Row | undefined
    if (!row || row.profileId !== profileId || (await db.table(p.table).get(p.remoteId))) continue
    const enc = encodeRow(p.table, row, profileId)
    if (enc.h !== p.localHash || enc.key === p.remoteKey) continue
    const lk = shadowKey(profileId, enc.key)
    const rk = shadowKey(profileId, p.remoteKey)
    if ((await db.syncShadow.get(lk)) || (await db.syncShadow.get(rk))) continue
    await db.syncShadow.bulkPut([
      { k: lk, profileId, table: p.table, rowId: p.localId, rev: 0, hash: enc.h },
      { k: rk, profileId, table: p.table, rowId: p.remoteId, rev: p.remoteRev, hash: null },
    ])
    n++
  }
  return n
}

export class LinkError extends Error {
  readonly code: 'account-in-use' | 'profile-linked-elsewhere' | 'name-mismatch' | 'profile-missing'
  constructor(code: 'account-in-use' | 'profile-linked-elsewhere' | 'name-mismatch' | 'profile-missing', message: string) {
    super(message)
    this.code = code
    this.name = 'LinkError'
  }
}

const normName = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('es')

export async function localCounts(db: SaludDB, profileId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of SYNC_TABLES) {
    const n = await db.table(t).where('profileId').equals(profileId).count()
    if (n) out[t] = n
  }
  if (await db.profiles.get(profileId)) out[PROFILE_TABLE] = 1
  return out
}

const total = (c: Record<string, number>) => Object.entries(c).reduce((s, [t, n]) => (t === PROFILE_TABLE ? s : s + n), 0)

/**
 * What linking would merge. With `duplicates`, also looks for probable duplicates; that reads the
 * account's rows of those tables (one read per document), so only the link screen asks for it.
 */
export async function previewLink(db: SaludDB, profileId: string, remote: RemoteStore, opts: { duplicates?: boolean } = {}): Promise<LinkPreview> {
  const profile = await db.profiles.get(profileId)
  if (!profile) throw new LinkError('profile-missing', 'El perfil no existe.')
  const [local, remoteCounts, remoteMeta, usedBy, existingLink] = await Promise.all([
    localCounts(db, profileId),
    remote.liveCounts(),
    remote.getMeta(),
    db.syncLinks.where('uid').equals(remote.uid).first(),
    db.syncLinks.get(profileId),
  ])
  const remoteTotal = total(remoteCounts)
  // Any remote row counts, including the profile itself (name, birth date, height are personal data).
  const remoteHasData = Object.values(remoteCounts).some((c) => c > 0)
  let duplicates: DuplicateSummary | null = null
  let duplicatesFailed = false
  if (opts.duplicates) {
    try {
      duplicates = await findLinkDuplicates(db, profileId, remote, local, remoteCounts)
    } catch {
      duplicatesFailed = true
    }
  }
  return {
    local,
    localTotal: total(local),
    remote: remoteCounts,
    remoteTotal,
    remoteMeta,
    nameMismatch: remoteHasData && !!remoteMeta?.profileName && normName(remoteMeta.profileName) !== normName(profile.name),
    accountUsedBy: usedBy && usedBy.profileId !== profileId ? usedBy.profileId : null,
    existingLink: existingLink ?? null,
    duplicates,
    duplicatesFailed,
  }
}

function newLink(profileId: string, account: Account, now: Date): SyncLink {
  return {
    profileId,
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    linkedAt: now.toISOString(),
    state: 'linking',
    cursor: null,
    tablesVersion: TABLES_VERSION,
    lastSyncAt: null,
    lastError: null,
    lastErrorCode: null,
    pending: 0,
    heldDeletes: 0,
    verifiedAt: null,
  }
}

async function guard(db: SaludDB, profileId: string, account: Account) {
  const usedBy = await db.syncLinks.where('uid').equals(account.uid).first()
  if (usedBy && usedBy.profileId !== profileId)
    throw new LinkError('account-in-use', 'Esta cuenta ya está vinculada a otro perfil de este dispositivo. Cada persona necesita su propia cuenta.')
  const existing = await db.syncLinks.get(profileId)
  if (existing && existing.uid !== account.uid)
    throw new LinkError('profile-linked-elsewhere', 'Este perfil ya está vinculado a otra cuenta. Desvincúlalo antes de usar una distinta.')
}

async function writeMeta(db: SaludDB, profileId: string, remote: RemoteStore) {
  const profile = await db.profiles.get(profileId)
  const prev = await remote.getMeta()
  await remote.setMeta({
    profileName: prev?.profileName ?? profile?.name ?? null,
    createdAt: prev?.createdAt ?? Date.now(),
    schema: SCHEMA_VERSION,
    appVersion: APP_VERSION,
  })
}

export interface VerifyResult {
  ok: boolean
  mismatches: { table: string; local: number; remote: number }[]
  pending: number
  conflicts: number
}

/** Counts must match table by table, with nothing pending and no open conflicts. */
export async function verifyLink(db: SaludDB, profileId: string, remote: RemoteStore, now = new Date()): Promise<VerifyResult> {
  const link = await db.syncLinks.get(profileId)
  const [local, rc, conflicts] = await Promise.all([localCounts(db, profileId), remote.liveCounts(), db.syncConflicts.where('profileId').equals(profileId).count()])
  const tables = new Set([...Object.keys(local), ...Object.keys(rc)])
  const mismatches = [...tables].filter((t) => (local[t] ?? 0) !== (rc[t] ?? 0)).map((t) => ({ table: t, local: local[t] ?? 0, remote: rc[t] ?? 0 }))
  const pending = link?.pending ?? 0
  const ok = !!link && mismatches.length === 0 && pending === 0 && link.heldDeletes === 0 && conflicts === 0
  if (ok && link) {
    const meta = await remote.getMeta()
    await db.syncLinks.update(profileId, { state: 'linked', verifiedAt: now.toISOString(), cloudEpoch: meta?.createdAt ?? null })
  }
  return { ok, mismatches, pending, conflicts }
}

/** Links this profile and runs the first merge + verification. */
export async function linkProfile(
  db: SaludDB,
  profileId: string,
  remote: RemoteStore,
  account: Account,
  opts: {
    confirmNameMismatch?: boolean
    expectEmptyAccount?: boolean
    now?: Date
    /** Probable duplicates from the preview to leave out of the merge ("Omitir duplicados probables"). */
    skipDuplicates?: readonly LinkDuplicate[]
  } = {},
): Promise<{ sync: SyncResult; verify: VerifyResult; skippedDuplicates: number }> {
  if (account.uid !== remote.uid) throw new LinkError('account-in-use', 'La sesión no coincide con la cuenta elegida.')
  await guard(db, profileId, account)
  const preview = await previewLink(db, profileId, remote)
  if (opts.expectEmptyAccount && !preview.existingLink && Object.values(preview.remote).some((n) => n > 0))
    throw new LinkError('name-mismatch', 'La cuenta ahora tiene datos. Vuelve a revisar y restaurar su perfil antes de vincularlo.')
  if (preview.nameMismatch && !opts.confirmNameMismatch)
    throw new LinkError('name-mismatch', `La cuenta ya tiene datos del perfil «${preview.remoteMeta?.profileName}». Confirma que es la misma persona.`)
  const now = opts.now ?? new Date()
  // Preview awaits the remote. Reserve only after rechecking the local guards in the same
  // transaction as the insert, so another tab/profile cannot claim this account in between.
  // The duplicates left out are recorded in the same transaction, before any sync can run.
  let skippedDuplicates = 0
  const skipTables = [...SKIPPABLE_DUPLICATE_TABLES].map((t) => db.table(t))
  await db.transaction('rw', [db.syncLinks, db.syncShadow, ...skipTables], async () => {
    await guard(db, profileId, account)
    if (!(await db.syncLinks.get(profileId))) await db.syncLinks.put(newLink(profileId, account, now))
    if (opts.skipDuplicates?.length) skippedDuplicates = await leaveOutDuplicates(db, profileId, opts.skipDuplicates)
  })
  const sync = await syncProfile(db, profileId, remote)
  await writeMeta(db, profileId, remote)
  const verify = await verifyLink(db, profileId, remote, now)
  return { sync, verify, skippedDuplicates }
}

/** Downloads the account into a brand-new local profile (the current profile is not touched). */
export async function createProfileFromAccount(db: SaludDB, remote: RemoteStore, account: Account): Promise<{ profileId: string; sync: SyncResult; verify: VerifyResult }> {
  if (account.uid !== remote.uid) throw new LinkError('account-in-use', 'La sesión no coincide con la cuenta elegida.')
  const usedBy = await db.syncLinks.where('uid').equals(account.uid).first()
  if (usedBy) throw new LinkError('account-in-use', 'Esta cuenta ya está vinculada a otro perfil de este dispositivo.')
  const meta = await remote.getMeta()
  const now = new Date()
  const profile = await db.transaction('rw', [db.profiles, db.syncLinks, db.syncShadow], async () => {
    if (await db.syncLinks.where('uid').equals(account.uid).first())
      throw new LinkError('account-in-use', 'Esta cuenta ya está vinculada a otro perfil de este dispositivo.')
    const p = await createProfile(
      { name: meta?.profileName || account.displayName || 'Perfil', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } },
      db,
    )
    // The placeholder must not compete with the account's profile: rev 0 lets the
    // downloaded profile replace it without a conflict.
    const enc = encodeRow(PROFILE_TABLE, p as unknown as Record<string, unknown>, p.id)
    await db.syncLinks.put(newLink(p.id, account, now))
    await db.syncShadow.put({ k: shadowKey(p.id, enc.key), profileId: p.id, table: PROFILE_TABLE, rowId: p.id, rev: 0, hash: enc.h })
    return p
  })
  try {
    const sync = await syncProfile(db, profile.id, remote)
    const verify = await verifyLink(db, profile.id, remote, now)
    if (!verify.ok) throw new Error('No se pudo verificar la restauración completa de la cuenta. Inténtalo de nuevo.')
    return { profileId: profile.id, sync, verify }
  } catch (e) {
    // This profile contains only a failed download. Remove its rows and bookkeeping together;
    // otherwise the account-in-use guard prevents the welcome screen from retrying.
    await deleteProfile(profile.id, db)
    throw e
  }
}

/**
 * Removes the link on this device (sign-out for this profile keeps it; this is "Desvincular").
 * Local rows stay exactly as they are; cloud data stays in the account.
 */
export async function unlinkProfile(db: SaludDB, profileId: string): Promise<void> {
  await db.transaction('rw', [db.syncLinks, db.syncShadow, db.syncConflicts], async () => {
    await db.syncLinks.delete(profileId)
    await db.syncShadow.where('profileId').equals(profileId).delete()
    await db.syncConflicts.where('profileId').equals(profileId).delete()
  })
}

/** Data deletion: erases the account's cloud copy and unlinks. Local data is not touched. */
export async function deleteCloudData(db: SaludDB, profileId: string, remote: RemoteStore): Promise<number> {
  const link = await db.syncLinks.get(profileId)
  if (!link || link.uid !== remote.uid) throw new LinkError('profile-linked-elsewhere', 'La sesión abierta no corresponde a este perfil.')
  const n = await remote.deleteAll()
  await unlinkProfile(db, profileId)
  return n
}

/** What an account holds in the cloud, read WITHOUT any local profile (first-run "Google first"). */
export interface AccountPreview {
  counts: Record<string, number>
  total: number
  meta: RemoteMeta | null
  /** Any remote row at all, including the profile itself. */
  hasData: boolean
  /** Local profile already using this account on this device (the account cannot be restored again). */
  usedBy: string | null
}

export async function previewAccount(db: SaludDB, remote: RemoteStore): Promise<AccountPreview> {
  const [counts, meta, usedBy] = await Promise.all([remote.liveCounts(), remote.getMeta(), db.syncLinks.where('uid').equals(remote.uid).first()])
  return { counts, total: total(counts), meta, hasData: Object.values(counts).some((c) => c > 0), usedBy: usedBy?.profileId ?? null }
}
