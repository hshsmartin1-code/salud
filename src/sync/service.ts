import Dexie from 'dexie'
import { db as defaultDb, type SaludDB } from '../db/schema'
import { SYNC_CONFIG } from './config'
import { syncProfile, type SyncOptions, type SyncResult } from './engine'
import { profileServices } from './firebase'
import { verifyLink } from './link'
import type { RemoteStore } from './remote'
import type { LiveSyncState } from './status'

/**
 * Background sync for every linked profile that has its own session on this device.
 * Triggers: start-up, coming back online, the app returning to the foreground, a 5-minute timer
 * while visible and local edits (debounced). Failures back off exponentially; an expired session or
 * a permission error stops retries until the person acts. Only one sync per profile runs at a time.
 */

const live = new Map<string, LiveSyncState>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const IDLE: LiveSyncState = Object.freeze({ syncing: false, sessionUid: undefined })
/** Stable snapshot (safe for useSyncExternalStore). */
export function getLive(profileId: string): LiveSyncState {
  return live.get(profileId) ?? IDLE
}
export function subscribeLive(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setLive(profileId: string, patch: Partial<LiveSyncState>) {
  live.set(profileId, { ...getLive(profileId), ...patch })
  emit()
}

/** Firestore remote bound to THIS profile's session (throws if signed out). */
export async function remoteFor(profileId: string): Promise<RemoteStore> {
  const s = await profileServices(profileId)
  await s.auth.authStateReady()
  const user = s.auth.currentUser
  if (!user) throw new Error('No hay sesión para este perfil.')
  const { FirestoreRemote } = await import('./firestoreRemote')
  return new FirestoreRemote(s.fs, user.uid)
}

const running = new Map<string, Promise<SyncResult>>()

export function runSync(profileId: string, opts: SyncOptions = {}, database: SaludDB = defaultDb): Promise<SyncResult> {
  const cur = running.get(profileId)
  if (cur) return cur
  const p = (async () => {
    setLive(profileId, { syncing: true })
    try {
      const remote = await remoteFor(profileId)
      const r = await syncProfile(database, profileId, remote, opts)
      const link = await database.syncLinks.get(profileId)
      if (link && link.state !== 'linked') await verifyLink(database, profileId, remote)
      return r
    } finally {
      setLive(profileId, { syncing: false })
      running.delete(profileId)
    }
  })()
  running.set(profileId, p)
  return p
}

export const RETRY_BASE_MS = 30_000
export const RETRY_MAX_MS = 15 * 60_000
export const backoff = (failures: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1))

let started = false
let kick: (() => void) | null = null

export function startSyncScheduler(database: SaludDB = defaultDb): () => void {
  if (!SYNC_CONFIG || started || typeof window === 'undefined') return () => undefined
  started = true
  const failures = new Map<string, number>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionWatch = new Map<string, () => void>()
  let stopped = false

  const schedule = (pid: string, delay: number) => {
    clearTimeout(timers.get(pid))
    timers.set(
      pid,
      setTimeout(() => void tick(pid), delay),
    )
  }

  const tick = async (pid: string) => {
    if (stopped) return
    const link = await database.syncLinks.get(pid)
    if (!link) return
    const sessionUid = getLive(pid).sessionUid
    if (!sessionUid || sessionUid !== link.uid) return // signed out or another account: never sync
    if (!navigator.onLine) return
    try {
      await runSync(pid, {}, database)
      failures.set(pid, 0)
    } catch {
      const l = await database.syncLinks.get(pid)
      if (l?.lastErrorCode === 'auth' || l?.lastErrorCode === 'permission' || l?.lastErrorCode === 'account-mismatch' || l?.lastErrorCode === 'foreign-row' || l?.lastErrorCode === 'cloud-reset') return
      const f = (failures.get(pid) ?? 0) + 1
      failures.set(pid, f)
      schedule(pid, backoff(f))
    }
  }

  const syncAll = async (delay = 0) => {
    const links = await database.syncLinks.toArray()
    for (const l of links) {
      if (!sessionWatch.has(l.profileId)) {
        sessionWatch.set(l.profileId, () => undefined)
        void import('./auth').then(({ onAccountChange }) =>
          onAccountChange(l.profileId, (a) => {
            setLive(l.profileId, { sessionUid: a?.uid ?? null })
            if (a) schedule(l.profileId, 500)
          }).then((unsub) => sessionWatch.set(l.profileId, unsub)),
        )
      }
      if ((failures.get(l.profileId) ?? 0) === 0) schedule(l.profileId, delay)
    }
  }

  let debounce: ReturnType<typeof setTimeout> | undefined
  const SYNC_TABLE_RE = /\/(syncLinks|syncShadow|syncConflicts|meta)\//
  const onMutated = (parts: Record<string, unknown>) => {
    if ([...running.keys()].length > 0) return // our own pull writes
    const keys = Object.keys(parts)
    if (keys.length && keys.every((k) => SYNC_TABLE_RE.test(k))) return
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncAll(), 15_000)
  }
  const onOnline = () => {
    failures.clear()
    void syncAll(1000)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncAll(1000)
  }
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') void syncAll()
  }, 5 * 60_000)

  Dexie.on('storagemutated', onMutated)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  void syncAll(1500)
  kick = () => {
    failures.clear()
    void syncAll(300)
  }

  return () => {
    kick = null
    stopped = true
    started = false
    clearInterval(interval)
    clearTimeout(debounce)
    timers.forEach((t) => clearTimeout(t))
    sessionWatch.forEach((u) => u())
    Dexie.on('storagemutated').unsubscribe(onMutated)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Picks up a newly linked profile (or a new session) and syncs soon. */
export function refreshScheduler() {
  kick?.()
}
