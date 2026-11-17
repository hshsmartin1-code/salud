import type { User } from 'firebase/auth'
import { disposeProfileServices, isNativeShell, PENDING_SESSION, profileServices } from './firebase'
import type { Account } from './link'

/**
 * Google sign-in per local profile.
 *  - Web: Firebase popup with "select_account", so each profile can pick a different Google account.
 *  - Android: the native Credential Manager sheet (@capacitor-firebase/authentication with
 *    skipNativeAuth) returns a Google ID token, which signs in ONLY this profile's Firebase instance;
 *    the native layer is signed out right away so the next profile can choose another account.
 *  - Emulator builds: a fake Google credential accepted only by the local Auth emulator.
 * Tokens are kept by the Firebase SDK in this profile's own IndexedDB entry; the app never stores or
 * logs them.
 */

export type AuthErrorCode = 'cancelled' | 'offline' | 'not-configured' | 'native-unavailable' | 'popup-blocked' | 'domain' | 'failed'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'AuthError'
  }
}

export const toAccount = (u: Pick<User, 'uid' | 'email' | 'displayName'>): Account => ({ uid: u.uid, email: u.email ?? null, displayName: u.displayName ?? null })

export function mapAuthError(e: unknown): AuthError {
  if (e instanceof AuthError) return e
  const code = String((e as { code?: string })?.code ?? '')
  const msg = String((e as { message?: string })?.message ?? '')
  if (/popup-closed|cancelled-popup|user-cancel|canceled|cancelled/i.test(code + ' ' + msg)) return new AuthError('cancelled', 'Inicio de sesión cancelado.')
  if (/network-request-failed|offline|unavailable/i.test(code + ' ' + msg)) return new AuthError('offline', 'Sin conexión. Inténtalo cuando tengas internet.')
  if (/popup-blocked/.test(code)) return new AuthError('popup-blocked', 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio.')
  if (/unauthorized-domain|operation-not-allowed|invalid-api-key|app-not-authorized/.test(code))
    return new AuthError('domain', 'Este dominio o esta app no están autorizados en el proyecto de Firebase. Revisa la guía de configuración.')
  if (/not implemented|not available|UNIMPLEMENTED/i.test(msg)) return new AuthError('native-unavailable', 'El inicio de sesión nativo no está incluido en esta compilación.')
  return new AuthError('failed', 'No se pudo iniciar sesión. Inténtalo de nuevo.')
}

/** Current session of this profile (waits for the persisted session to load). */
export async function currentAccount(profileId: string): Promise<Account | null> {
  const { auth } = await profileServices(profileId)
  await auth.authStateReady()
  return auth.currentUser ? toAccount(auth.currentUser) : null
}

export async function onAccountChange(profileId: string, cb: (a: Account | null) => void): Promise<() => void> {
  const { auth } = await profileServices(profileId)
  const { onAuthStateChanged } = await import('firebase/auth')
  return onAuthStateChanged(auth, (u) => cb(u ? toAccount(u) : null))
}

export async function signInProfile(profileId: string, opts: { emulatorIdentity?: { sub: string; email: string; name: string } } = {}): Promise<Account> {
  const s = await profileServices(profileId)
  const a = await import('firebase/auth')
  try {
    if (s.config.emulatorHost) {
      if (!opts.emulatorIdentity) throw new AuthError('failed', 'Falta la identidad de prueba del emulador.')
      // The Auth emulator accepts an unsigned JSON "id token"; this path does not exist for real projects.
      const cred = a.GoogleAuthProvider.credential(JSON.stringify({ ...opts.emulatorIdentity, email_verified: true }))
      return toAccount((await a.signInWithCredential(s.auth, cred)).user)
    }
    if (isNativeShell()) {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
      try {
        const r = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })
        const idToken = r.credential?.idToken
        if (!idToken) throw new AuthError('failed', 'Google no devolvió una credencial.')
        return toAccount((await a.signInWithCredential(s.auth, a.GoogleAuthProvider.credential(idToken))).user)
      } finally {
        await FirebaseAuthentication.signOut().catch(() => undefined)
      }
    }
    const provider = new a.GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    return toAccount((await a.signInWithPopup(s.auth, provider)).user)
  } catch (e) {
    throw mapAuthError(e)
  }
}

/** Ends this profile's session. Local data and the link stay; the next sign-in must use the same account. */
export async function signOutProfile(profileId: string): Promise<void> {
  const { auth } = await profileServices(profileId)
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
}

/**
 * Moves the session from one profile's Firebase instance to another's (used when the account is
 * downloaded into a NEW profile): the new profile keeps syncing with it and the original profile is
 * left signed out, so the account is never attached to two local profiles.
 */
export async function moveSession(fromProfileId: string, toProfileId: string): Promise<void> {
  const from = await profileServices(fromProfileId)
  const to = await profileServices(toProfileId)
  const { signOut, updateCurrentUser } = await import('firebase/auth')
  await from.auth.authStateReady()
  await to.auth.authStateReady()
  if (!from.auth.currentUser) throw new AuthError('failed', 'No hay sesión que mover.')
  const previous = to.auth.currentUser
  await updateCurrentUser(to.auth, from.auth.currentUser)
  try {
    await signOut(from.auth)
  } catch (e) {
    // The caller cannot treat a failed transfer as an adopted session. Undo the copy
    // so a cancelled onboarding does not leave credentials on an unlinked profile.
    await updateCurrentUser(to.auth, previous).catch(() => undefined)
    throw e
  }
}

/* ── Pending session (Google first, before any local profile exists) ─────────────────────────────
 * Same three sign-in paths as a profile, on the app instance "salud-pending". Nothing is linked or
 * written locally by these functions: the caller reads the account's cloud state, then either moves
 * the session to a NEW profile (adoptPendingSession) or signs it out (signOutPending). */

const PENDING_FLAG = 'salud-pending-session'
const setPendingFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PENDING_FLAG, '1')
    else localStorage.removeItem(PENDING_FLAG)
  } catch {
    /* storage unavailable: the flag only avoids loading Firebase for nothing */
  }
}
const hasPendingFlag = () => {
  try {
    return localStorage.getItem(PENDING_FLAG) === '1'
  } catch {
    return false
  }
}

export async function signInPending(opts: { emulatorIdentity?: { sub: string; email: string; name: string } } = {}): Promise<Account> {
  setPendingFlag(true)
  try {
    return await signInProfile(PENDING_SESSION, opts)
  } catch (e) {
    await signOutPending().catch(() => undefined)
    throw e
  }
}

/** Ends the pending session. With `onlyIfStale` it does nothing (and loads nothing) unless one was left behind. */
export async function signOutPending(opts: { onlyIfStale?: boolean } = {}): Promise<void> {
  if (opts.onlyIfStale && !hasPendingFlag()) return
  try {
    await signOutProfile(PENDING_SESSION)
    // A failed SDK sign-out can leave persisted credentials. Keep the marker so the next
    // welcome visit retries cleanup instead of silently reusing that session.
    setPendingFlag(false)
  } finally {
    await disposeProfileServices(PENDING_SESSION)
  }
}

/** The pending session becomes the session of `profileId` (a NEW profile); the pending one is left signed out. */
export async function adoptPendingSession(profileId: string): Promise<void> {
  await moveSession(PENDING_SESSION, profileId)
  setPendingFlag(false)
  await disposeProfileServices(PENDING_SESSION)
}
