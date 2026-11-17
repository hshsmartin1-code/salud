import { getMeta, setMeta } from '../../db/profiles'
import { nowIso, type Repo } from '../../db/repo'
import type { SaludDB } from '../../db/schema'
import type { IntegrationState } from '../../db/types'

/** Shared (device-level) meta key: which profile owns Health Connect on this phone. */
export const LINK_KEY = 'hc.linkedProfileId'

export const integrationId = (profileId: string) => `${profileId}|health-connect`

export type StateRow = Omit<IntegrationState, 'createdAt' | 'updatedAt'>

export function emptyState(profileId: string): StateRow {
  return {
    id: integrationId(profileId),
    profileId,
    provider: 'health-connect',
    status: 'disconnected',
    categories: {},
    grantedPermissions: [],
    linkedAt: null,
    lastSyncAt: null,
    lastSyncFrom: null,
    lastSyncTo: null,
    changesTokens: {},
    lastError: null,
    log: [],
  }
}

export function loadState(r: Repo): Promise<IntegrationState | undefined> {
  return r.get('integrations', integrationId(r.profileId))
}

export async function saveState(r: Repo, state: StateRow | IntegrationState): Promise<IntegrationState> {
  return r.put('integrations', state)
}

export class LinkError extends Error {
  linkedProfileId: string
  constructor(message: string, linkedProfileId: string) {
    super(message)
    this.name = 'LinkError'
    this.linkedProfileId = linkedProfileId
  }
}

/** The profile that owns Health Connect on this device (null if none, or if that profile no longer exists). */
export async function getLinkedProfileId(db: SaludDB): Promise<string | null> {
  const id = await getMeta<string | null>(LINK_KEY, db)
  if (!id) return null
  return (await db.profiles.get(id)) ? id : null
}

/** Only one profile per device. Linking a second one fails until the first is disconnected. */
export async function linkProfile(db: SaludDB, profileId: string): Promise<void> {
  const current = await getLinkedProfileId(db)
  if (current && current !== profileId) {
    throw new LinkError('Health Connect ya está vinculado a otro perfil de este teléfono. Desconéctalo primero.', current)
  }
  await setMeta(LINK_KEY, profileId, db)
}

export async function unlinkProfile(db: SaludDB, profileId: string): Promise<void> {
  const current = await getMeta<string | null>(LINK_KEY, db)
  if (current === profileId) await setMeta(LINK_KEY, null, db)
}

export { nowIso }
