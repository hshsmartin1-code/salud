import type { SyncLink } from '../db/types'

/** What the account screen shows for one profile. Pure so it can be unit-tested. */
export type SyncStatus =
  | 'not-linked' // the profile is local-only
  | 'signed-out' // linked, but this profile has no session on this device
  | 'account-mismatch' // the session belongs to another account than the link
  | 'syncing'
  | 'linking' // first merge not verified yet
  | 'offline'
  | 'auth' // session expired or revoked: sign in again
  | 'error'
  | 'conflicts'
  | 'held' // deletions waiting for confirmation
  | 'pending'
  | 'synced'

export interface LiveSyncState {
  syncing: boolean
  /** uid of this profile's current session; null = signed out; undefined = still loading. */
  sessionUid: string | null | undefined
}

export function deriveStatus(link: SyncLink | undefined | null, live: LiveSyncState, conflicts: number, online: boolean, localPending?: number): SyncStatus {
  if (!link) return 'not-linked'
  if (live.syncing) return 'syncing'
  if (live.sessionUid === null) return 'signed-out'
  if (live.sessionUid && live.sessionUid !== link.uid) return 'account-mismatch'
  if (conflicts > 0) return 'conflicts'
  if (link.heldDeletes > 0) return 'held'
  if (link.lastErrorCode === 'auth') return 'auth'
  if (!online || link.lastErrorCode === 'offline') return 'offline'
  if (link.lastErrorCode) return 'error'
  if (link.state !== 'linked') return 'linking'
  if ((localPending ?? link.pending) > 0) return 'pending'
  return 'synced'
}

export const STATUS_LABEL: Record<SyncStatus, string> = {
  'not-linked': 'Solo en este dispositivo',
  'signed-out': 'Sesión cerrada',
  'account-mismatch': 'Cuenta distinta',
  syncing: 'Sincronizando…',
  linking: 'Vinculación sin verificar',
  offline: 'Sin conexión',
  auth: 'Inicia sesión de nuevo',
  error: 'Error de sincronización',
  conflicts: 'Conflictos por revisar',
  held: 'Borrados por confirmar',
  pending: 'Cambios pendientes',
  synced: 'Sincronizado',
}

export type StatusTone = 'ok' | 'muted' | 'warn' | 'bad'
export const STATUS_TONE: Record<SyncStatus, StatusTone> = {
  'not-linked': 'muted',
  'signed-out': 'muted',
  'account-mismatch': 'bad',
  syncing: 'muted',
  linking: 'warn',
  offline: 'muted',
  auth: 'warn',
  error: 'bad',
  conflicts: 'warn',
  held: 'warn',
  pending: 'muted',
  synced: 'ok',
}
