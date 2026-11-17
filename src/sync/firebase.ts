import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { SYNC_CONFIG, type SyncConfig } from './config'

/**
 * One Firebase app instance per LOCAL PROFILE ("salud-<profileId>"). Each has its own Auth session
 * (persisted under its own key), so two people on one phone can be signed in to two accounts at the
 * same time and a sync for one profile can never run with the other person's session.
 *
 * Firebase is loaded lazily: nothing is downloaded or initialised until a profile uses an account.
 * Firestore uses its in-memory cache, so health data is not duplicated into a second IndexedDB
 * store (Dexie is the only local copy).
 */
export interface ProfileServices {
  app: FirebaseApp
  auth: Auth
  fs: Firestore
  config: SyncConfig
}

const cache = new Map<string, Promise<ProfileServices>>()

export const isNativeShell = () => typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()


/**
 * Id of the PENDING session: a Firebase app ("salud-pending") that belongs to no local profile. It exists
 * only while a person signs in with Google on the welcome screen BEFORE having a profile; it is moved to
 * the new profile (moveSession) or signed out, never kept. A real profile id is a uuid, so it cannot collide.
 */
export const PENDING_SESSION = 'pending'

export function appName(profileId: string) {
  return `salud-${profileId}`
}

export function profileServices(profileId: string, config: SyncConfig | null = SYNC_CONFIG): Promise<ProfileServices> {
  if (!config) return Promise.reject(new Error('La sincronización no está configurada en esta versión.'))
  let p = cache.get(profileId)
  if (!p) {
    p = init(profileId, config)
    cache.set(profileId, p)
    p.catch(() => cache.delete(profileId))
  }
  return p
}

async function init(profileId: string, config: SyncConfig): Promise<ProfileServices> {
  const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
  const name = appName(profileId)
  const existing = getApps().find((a) => a.name === name)
  const app = existing ?? initializeApp(config.firebase, name)
  const native = isNativeShell()
  const browser = typeof window !== 'undefined'
  const auth = existing
    ? authMod.getAuth(app)
    : authMod.initializeAuth(app, {
        // Node (emulator tests) has no browser storage: sessions live in memory there.
        persistence: browser ? [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence] : authMod.inMemoryPersistence,
        // Popups only exist on the web; the Android shell signs in through the native plugin.
        popupRedirectResolver: native || !browser ? undefined : authMod.browserPopupRedirectResolver,
      })
  const fs = existing
    ? fsMod.getFirestore(app)
    : fsMod.initializeFirestore(app, { localCache: fsMod.memoryLocalCache(), ignoreUndefinedProperties: true })
  if (config.emulatorHost && !existing) {
    authMod.connectAuthEmulator(auth, `http://${config.emulatorHost}:${config.authEmulatorPort}`, { disableWarnings: true })
    fsMod.connectFirestoreEmulator(fs, config.emulatorHost, config.firestoreEmulatorPort)
  }
  return { app, auth, fs, config }
}

/** Drops the cached instance (after the profile is deleted). */
export async function disposeProfileServices(profileId: string): Promise<void> {
  const p = cache.get(profileId)
  cache.delete(profileId)
  if (!p) return
  try {
    const s = await p
    const { deleteApp } = await import('firebase/app')
    await deleteApp(s.app)
  } catch {
    /* already gone */
  }
}
