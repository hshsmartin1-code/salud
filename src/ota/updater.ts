import { checkCompatibility, OTA_ENABLED, OtaError, verifyBundle, verifyManifest, type OtaEnvironment, type OtaManifest, type SignedManifest } from './manifest'

/**
 * Install/rollback state machine and orchestration, independent of the native installer.
 *
 * A new bundle is installed as a TRIAL. The app must report itself healthy (`ready`) after it boots
 * on the new bundle; if it boots twice without doing so (crash, white screen) the installer goes back
 * to the previous bundle and the failed version is blocked. User data is never part of a bundle:
 * IndexedDB lives outside the web assets and the schema cannot change through OTA.
 */
export interface OtaState {
  active: string
  previous: string | null
  trial: { version: string; boots: number } | null
  blocked: string[]
}

export type OtaEvent = { type: 'installed'; version: string } | { type: 'boot' } | { type: 'ready' } | { type: 'rollback' }

export const MAX_TRIAL_BOOTS = 1

export function initialOtaState(builtInVersion: string): OtaState {
  return { active: builtInVersion, previous: null, trial: null, blocked: [] }
}

export function otaReducer(s: OtaState, e: OtaEvent): OtaState {
  switch (e.type) {
    case 'installed':
      if (s.blocked.includes(e.version)) return s
      return { ...s, previous: s.active, active: e.version, trial: { version: e.version, boots: 0 } }
    case 'boot': {
      if (!s.trial) return s
      const boots = s.trial.boots + 1
      if (boots > MAX_TRIAL_BOOTS) return otaReducer({ ...s, trial: { ...s.trial, boots } }, { type: 'rollback' })
      return { ...s, trial: { ...s.trial, boots } }
    }
    case 'ready':
      return s.trial ? { ...s, trial: null } : s
    case 'rollback':
      if (!s.trial || !s.previous) return s
      return { active: s.previous, previous: null, trial: null, blocked: [...new Set([...s.blocked, s.trial.version])] }
  }
}

/** Shared orchestration contract; byte-based v1 callers and manual native installers coexist. */
interface InstallerBase {
  nativeVersionCode(): Promise<number>
  fetchManifest(): Promise<SignedManifest | null>
  activateOnNextStart(version: string, sha256?: string): Promise<void>
  revertToPrevious(): Promise<void>
}

export interface ByteBundleInstaller extends InstallerBase {
  download(url: string): Promise<Uint8Array<ArrayBuffer>>
  /** Unpacks next to the current bundle without touching it; activation happens on next start. */
  stage(version: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
}

export interface InstalledBundle { id: string; version: string; status: 'success' | 'pending' | 'error'; builtin?: boolean; checksum?: string }
export interface InstallerBoot { active: InstalledBundle; failed: string[]; next: InstalledBundle | null; downloaded: InstalledBundle[] }
export interface NativeBundleInstaller extends InstallerBase {
  /** Equivalent to verifyBundle's SHA-256 check, performed on the zip BEFORE extraction in native code. */
  downloadVerified(manifest: OtaManifest, progress: (percent: number) => void): Promise<InstalledBundle>
  boot(): Promise<InstallerBoot>
  reportHealthy(): Promise<void>
  apply(): Promise<void>
}
export type BundleInstaller = ByteBundleInstaller | NativeBundleInstaller

export interface CheckResult {
  installed: OtaManifest | null
  reason: string | null
}

/**
 * One update check. Every step must pass before anything is staged: enabled, signature, compatibility,
 * integrity. Any failure leaves the running bundle untouched.
 */
export async function checkForUpdate(
  installer: BundleInstaller,
  state: OtaState,
  env: Omit<OtaEnvironment, 'currentVersion' | 'nativeVersionCode' | 'blocked'>,
  publicKeys: Record<string, JsonWebKey>,
  enabled = OTA_ENABLED,
): Promise<CheckResult> {
  if (!enabled) return { installed: null, reason: 'disabled' }
  if (state.trial) return { installed: null, reason: 'trial-in-progress' }
  const signed = await installer.fetchManifest()
  if (!signed) return { installed: null, reason: 'no-update' }
  try {
    const m = await verifyManifest(signed, publicKeys)
    checkCompatibility(m, { ...env, currentVersion: state.active, nativeVersionCode: await installer.nativeVersionCode(), blocked: state.blocked })
    if ('downloadVerified' in installer) {
      await installer.downloadVerified(m, () => {})
    } else {
      const bytes = await installer.download(m.url)
      await verifyBundle(bytes, m)
      await installer.stage(m.version, bytes)
    }
    await installer.activateOnNextStart(m.version, m.sha256)
    return { installed: m, reason: null }
  } catch (e) {
    if (e instanceof OtaError) return { installed: null, reason: e.code }
    throw e
  }
}
