import { db as defaultDb, type SaludDB } from './schema'
import { PERSONAL_TABLES, SYNC_STATE_TABLES } from './tables'
import { nowIso, uuid } from './repo'
import type { Profile } from './types'

export type NewProfile = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>

/**
 * A profile row from an old/hand-edited backup or a partial sync may lack `settings` (the backup schema
 * only requires id, name and sex). Code reads `profile.settings.*`, so every profile that enters the app
 * (backup import, listing) goes through here.
 */
export function normalizeProfile<P extends Pick<Profile, 'settings'>>(p: P): P {
  const s = (p as { settings?: unknown }).settings
  if (s && typeof s === 'object' && !Array.isArray(s)) return p
  return { ...p, settings: { addActivityKcal: false } }
}

export async function listProfiles(database: SaludDB = defaultDb): Promise<Profile[]> {
  const all = (await database.profiles.toArray()).map(normalizeProfile)
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function createProfile(data: NewProfile, database: SaludDB = defaultDb): Promise<Profile> {
  const now = nowIso()
  const p: Profile = { ...data, id: uuid(), createdAt: now, updatedAt: now }
  await database.profiles.add(p)
  return p
}

export async function updateProfile(id: string, changes: Partial<NewProfile>, database: SaludDB = defaultDb) {
  await database.profiles.update(id, { ...changes, updatedAt: nowIso() })
}

/** Deletes a profile and every personal row it owns (single transaction). */
export async function deleteProfile(id: string, database: SaludDB = defaultDb): Promise<number> {
  let removed = 0
  const tables = [...PERSONAL_TABLES, ...SYNC_STATE_TABLES]
  await database.transaction('rw', [database.profiles, ...tables.map((t) => database.table(t))], async () => {
    for (const t of PERSONAL_TABLES) removed += await database.table(t).where('profileId').equals(id).delete()
    // The account link and sync bookkeeping go with the local profile, in the same transaction, so
    // removing a profile from this device can never be read as "delete everything in the cloud".
    for (const t of SYNC_STATE_TABLES) await database.table(t).where('profileId').equals(id).delete()
    await database.profiles.delete(id)
  })
  return removed
}

export async function getMeta<T>(key: string, database: SaludDB = defaultDb): Promise<T | undefined> {
  return (await database.meta.get(key))?.value as T | undefined
}
export async function setMeta(key: string, value: unknown, database: SaludDB = defaultDb) {
  await database.meta.put({ key, value })
}

const ACTIVE_KEY = 'pho-active-profile'
export function readActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}
export function writeActiveProfileId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* ignore */
  }
}
