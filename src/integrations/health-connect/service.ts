import { repo } from '../../db/repo'
import type { SaludDB } from '../../db/schema'
import type { HealthCategory, IntegrationState } from '../../db/types'
import { categoryInfo, grantedCategories, metricsFor, permissionsFor } from './categories'
import { deleteImported } from './merge'
import { emptyState, getLinkedProfileId, linkProfile, loadState, nowIso, saveState, unlinkProfile } from './state'
import { errMsg } from './sync'
import type { HealthConnectPlugin } from './types'

export interface ServiceDeps {
  plugin: HealthConnectPlugin
  db: SaludDB
}

const UNAVAILABLE: Record<string, string> = {
  web: 'Health Connect solo está disponible en la app de Android.',
  'android-version': 'Health Connect requiere Android 9 o superior.',
  'not-installed': 'Instala Health Connect desde Google Play para continuar.',
  'update-required': 'Actualiza Health Connect desde Google Play para continuar.',
  unknown: 'Health Connect no está disponible en este dispositivo.',
}

async function requireAvailable(plugin: HealthConnectPlugin) {
  const s = await plugin.getStatus()
  if (!s.available) throw new Error(UNAVAILABLE[s.reason ?? 'unknown'] ?? UNAVAILABLE.unknown)
}

/**
 * Link this device's Health Connect to `profileId` and ask for the permissions of the chosen categories.
 * Throws LinkError when another profile already owns the link. Resolves with the new state, or null when the
 * person granted nothing (the link is released again).
 */
export async function connect(deps: ServiceDeps, profileId: string, categories: readonly HealthCategory[]): Promise<IntegrationState | null> {
  const { plugin, db } = deps
  if (categories.length === 0) throw new Error('Elige al menos una categoría.')
  await requireAvailable(plugin)
  const r = repo(profileId, db)
  const wasLinked = (await getLinkedProfileId(db)) === profileId
  await linkProfile(db, profileId) // throws LinkError for another profile
  try {
    await plugin.requestReadPermissions({ permissions: permissionsFor(categories) })
    const { granted } = await plugin.getGrantedPermissions()
    const ok = new Set(grantedCategories(granted))
    const enabled = categories.filter((c) => ok.has(c))
    if (enabled.length === 0) {
      if (!wasLinked) await unlinkProfile(db, profileId)
      return null
    }
    const prev = (await loadState(r)) ?? { ...emptyState(profileId) }
    const needsHistory = prev.status !== 'connected' || enabled.some((c) => !prev.categories[c])
    return await saveState(r, {
      ...prev,
      status: 'connected',
      categories: Object.fromEntries(enabled.map((c) => [c, true])),
      grantedPermissions: granted,
      linkedAt: prev.linkedAt ?? nowIso(),
      lastError: null,
      ...(needsHistory ? { lastSyncFrom: null, lastSyncTo: null } : {}),
    })
  } catch (e) {
    if (!wasLinked) await unlinkProfile(db, profileId)
    throw e
  }
}

/** Turn a category on (asks only for its permissions). Returns false if the person did not grant all of them. */
export async function enableCategory(deps: ServiceDeps, profileId: string, category: HealthCategory): Promise<boolean> {
  const { plugin, db } = deps
  const r = repo(profileId, db)
  const state = await loadState(r)
  if (!state || state.status !== 'connected') throw new Error('La integración no está conectada.')
  await plugin.requestReadPermissions({ permissions: permissionsFor([category]) })
  const { granted } = await plugin.getGrantedPermissions()
  const ok = grantedCategories(granted).includes(category)
  await saveState(r, {
    ...state,
    categories: { ...state.categories, ...(ok ? { [category]: true } : {}) },
    grantedPermissions: granted,
    // A newly enabled category needs the full available history, even after another category synced today.
    ...(ok && !state.categories[category] ? { lastSyncFrom: null, lastSyncTo: null } : {}),
  })
  return ok
}

/**
 * Turn a category off: stop reading it right away and forget its change tokens (a later re-enable re-reads the
 * window). Imported rows are kept unless `deleteData`.
 */
export async function disableCategory(deps: ServiceDeps, profileId: string, category: HealthCategory, deleteData = false): Promise<number> {
  const r = repo(profileId, deps.db)
  const state = await loadState(r)
  if (!state) return 0
  const tokens = { ...state.changesTokens }
  for (const t of categoryInfo(category).rawTypes) delete tokens[t]
  await saveState(r, { ...state, categories: { ...state.categories, [category]: false }, changesTokens: tokens })
  return deleteData ? deleteImported(r, metricsFor([category])) : 0
}

export interface DisconnectResult {
  revokeFailed: string | null
  deleted: number
}

/** Revoke (best effort), mark disconnected, release the device link. Imported data is kept unless `deleteData`. */
export async function disconnect(deps: ServiceDeps, profileId: string, deleteData = false): Promise<DisconnectResult> {
  const { plugin, db } = deps
  const r = repo(profileId, db)
  let revokeFailed: string | null = null
  try {
    await plugin.revokeAll()
  } catch (e) {
    revokeFailed = errMsg(e)
  }
  const state = await loadState(r)
  if (state) {
    await saveState(r, { ...state, status: 'disconnected', categories: {}, grantedPermissions: [], changesTokens: {}, lastError: null })
  }
  await unlinkProfile(db, profileId)
  const deleted = deleteData ? await deleteImported(r) : 0
  return { revokeFailed, deleted }
}
