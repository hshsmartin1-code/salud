/**
 * Firebase web configuration, read from build-time variables (`.env.local`, never committed).
 * Without a complete configuration the app runs exactly as before: local only, and the account
 * screen says that sync is not configured instead of showing buttons that cannot work.
 *
 * Emulator mode (`VITE_FIREBASE_EMULATOR_HOST`) talks only to the local Firebase emulators with the
 * demo project id, so no real project or credential is involved.
 */
export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  messagingSenderId?: string
}

export interface SyncConfig {
  firebase: FirebaseWebConfig
  /** Host of the local emulators, or null for the real project. */
  emulatorHost: string | null
  authEmulatorPort: number
  firestoreEmulatorPort: number
}

type Env = Record<string, string | boolean | undefined>

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export const DEMO_PROJECT_ID = 'demo-salud'

export function readSyncConfig(env: Env): SyncConfig | null {
  // The regular e2e build and the screenshot tool set this: sync is OFF whatever .env.local holds, so a test
  // build can never reach a real Firebase project. (Only ever turns sync off.)
  if (str(env.VITE_SYNC_DISABLED) === '1') return null
  const emulatorHost = str(env.VITE_FIREBASE_EMULATOR_HOST)
  const port = (v: unknown, d: number) => {
    const n = Number(str(v) ?? d)
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : d
  }
  if (emulatorHost) {
    if (!/^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])$/.test(emulatorHost)) return null // emulators are local only
    // The real project's variables (.env.local) are ignored here on purpose: emulator builds read
    // only VITE_FIREBASE_EMULATOR_PROJECT_ID, so a configured real project can never leak into them.
    const projectId = str(env.VITE_FIREBASE_EMULATOR_PROJECT_ID) ?? DEMO_PROJECT_ID
    if (!projectId.startsWith('demo-')) return null // never point emulator mode at a real project
    return {
      firebase: { apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: 'demo-app' },
      emulatorHost,
      authEmulatorPort: port(env.VITE_FIREBASE_AUTH_EMULATOR_PORT, 9099),
      firestoreEmulatorPort: port(env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT, 8080),
    }
  }
  const apiKey = str(env.VITE_FIREBASE_API_KEY)
  const authDomain = str(env.VITE_FIREBASE_AUTH_DOMAIN)
  const projectId = str(env.VITE_FIREBASE_PROJECT_ID)
  const appId = str(env.VITE_FIREBASE_APP_ID)
  if (!apiKey || !authDomain || !projectId || !appId) return null
  if (projectId.startsWith('demo-')) return null
  const messagingSenderId = str(env.VITE_FIREBASE_MESSAGING_SENDER_ID) ?? undefined
  return { firebase: { apiKey, authDomain, projectId, appId, messagingSenderId }, emulatorHost: null, authEmulatorPort: 9099, firestoreEmulatorPort: 8080 }
}

/** Configuration of this build (null = sync not configured). */
export const SYNC_CONFIG: SyncConfig | null = readSyncConfig(import.meta.env as Env)
