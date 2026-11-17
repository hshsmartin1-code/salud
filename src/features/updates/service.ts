import type { OtaConfig } from '../../ota/config'
import { checkCompatibility, compareVersions, isBundleVersion, MAX_RELEASE_NOTES, OtaError, verifyManifest, type OtaErrorCode, type OtaManifest, type SignedManifest } from '../../ota/manifest'
import { initialOtaState, otaReducer, type NativeBundleInstaller, type OtaState } from '../../ota/updater'
import { UPDATE_REASONS, updateReducer, type UpdateEvent, type UpdateState } from './state'

export const OTA_STORAGE_KEY = 'salud:ota:v1'
export interface UpdateStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface VersionInfo { webVersion: string; nativeVersionCode: number | null; nativeVersionName: string | null }
/** Signed notes of the bundle that was applied. Optional: a journal written by 3.1.0 has none and still loads. */
interface AppliedNotes { version: string; text: string }
interface Journal { format: 1; nativeBuild: number; ota: OtaState; staged: SignedManifest | null; notes?: AppliedNotes | null; previousNotes?: AppliedNotes | null }

/** Statuses an automatic (silent) check may start from: nothing in flight, nothing waiting for the person. */
const SILENT_FROM: ReadonlySet<UpdateState['status']> = new Set(['idle', 'none', 'incompatible', 'error'])

export interface CheckOptions {
  /** Automatic check: never publishes `checking`, `none`, `incompatible` or an error, only an offer. */
  silent?: boolean
}

function readNotes(value: unknown): AppliedNotes | null {
  const n = value as Partial<AppliedNotes> | null | undefined
  return n && isBundleVersion(n.version) && typeof n.text === 'string' && n.text.length <= MAX_RELEASE_NOTES ? { version: n.version, text: n.text } : null
}

export interface UpdateServiceOptions {
  config: OtaConfig
  platform: 'web' | 'native'
  builtInVersion: string
  schemaVersion: number
  installer: NativeBundleInstaller
  storage: UpdateStorage
  appInfo: () => Promise<{ build: string; version: string }>
}

/** Native plugin is the authority at boot. localStorage is a journal, never an activation authority. */
export function createUpdateService(options: UpdateServiceOptions) {
  const { config, installer, storage } = options
  let state: UpdateState = { status: 'idle' }
  let ota = initialOtaState(options.builtInVersion)
  let nativeBuild = 0
  let staged: SignedManifest | null = null
  let notes: AppliedNotes | null = null
  /** Notes of the bundle that was running when the current one was applied: they come back if the new one is rolled back. */
  let previousNotes: AppliedNotes | null = null
  // apply() journals the next trial before reload; that must not change what this JS context reports as installed.
  let runningVersion = options.builtInVersion
  let runningNotes = ''
  let checked: { signed: SignedManifest; manifest: OtaManifest } | null = null
  let started: Promise<void> | undefined
  let working = false
  const listeners = new Set<() => void>()
  const emit = (event: UpdateEvent) => { state = updateReducer(state, event); for (const listener of listeners) listener() }
  const transition = (next: UpdateState) => emit({ type: 'transition', state: next })
  const fail = (error: unknown, fallback: OtaErrorCode) => {
    const code = error instanceof OtaError ? error.code : fallback
    transition({ status: ['native', 'schema', 'channel', 'downgrade', 'blocked'].includes(code) ? 'incompatible' : 'error', code, reason: UPDATE_REASONS[code] })
  }
  const save = () => {
    try { storage.setItem(OTA_STORAGE_KEY, JSON.stringify({ format: 1, nativeBuild, ota, staged, notes, previousNotes } satisfies Journal)) }
    catch { throw new OtaError('storage', UPDATE_REASONS.storage) }
  }
  function restore(): Journal | null {
    try {
      const text = storage.getItem(OTA_STORAGE_KEY)
      if (!text) return null
      const j = JSON.parse(text) as Journal
      if (j.format !== 1 || !Number.isSafeInteger(j.nativeBuild) || !j.ota || !isBundleVersion(j.ota.active) ||
        !(j.ota.previous === null || isBundleVersion(j.ota.previous)) || !Array.isArray(j.ota.blocked) || !j.ota.blocked.every(isBundleVersion) ||
        !(j.ota.trial === null || (isBundleVersion(j.ota.trial.version) && Number.isSafeInteger(j.ota.trial.boots)))) throw Error('Invalid journal')
      return j
    } catch { throw new OtaError('storage', UPDATE_REASONS.storage) }
  }
  const environment = () => ({ channel: config.channel, currentVersion: ota.active, nativeVersionCode: nativeBuild, schemaVersion: options.schemaVersion, allowedHosts: config.allowedHosts, devHttp: config.devHttp, blocked: ota.blocked })

  async function initialize() {
    if (options.platform === 'web') return
    const info = await options.appInfo()
    nativeBuild = Number(info.build)
    if (!Number.isSafeInteger(nativeBuild) || nativeBuild < 1) throw new OtaError('native', UPDATE_REASONS.native)
    const journal = restore()
    if (journal) { ota = journal.ota; staged = journal.staged; notes = readNotes(journal.notes); previousNotes = readNotes(journal.previousNotes) }
    const boot = await installer.boot()
    const active = boot.active.builtin ? options.builtInVersion : boot.active.version
    if (!isBundleVersion(active)) throw new OtaError('installer', UPDATE_REASONS.installer)
    const confirmedTrial = ota.trial?.version === active && boot.active.status === 'success' && journal?.nativeBuild === nativeBuild
    const failed = boot.failed.filter((v) => isBundleVersion(v) && !ota.blocked.includes(v))
    if (ota.trial && active !== ota.trial.version && boot.next?.version !== ota.trial.version && journal?.nativeBuild === nativeBuild) {
      failed.push(ota.trial.version)
      ota = otaReducer(ota, { type: 'rollback' })
    }
    if (journal && journal.nativeBuild !== nativeBuild) { ota = initialOtaState(active); staged = null }
    // Notes describe the bundle that is running: a rollback, a new APK or the built-in interface leave none.
    if (!(notes && boot.next?.version === notes.version)) { // (a bundle still queued for the next start keeps its notes)
      if (notes?.version !== active && previousNotes?.version === active) notes = previousNotes // the applied bundle was rolled back
      if (boot.active.builtin || notes?.version !== active) notes = null
      if (boot.active.status !== 'pending') previousNotes = null // confirmed or rolled back: nothing left to fall back to
    }
    runningVersion = active
    // The running bundle's own notes: a bundle queued for the next start keeps `notes`, so fall back to the previous ones.
    runningNotes = notes?.version === active ? notes.text : previousNotes?.version === active ? previousNotes.text : ''
    if (ota.active !== active) ota = otaReducer(ota, { type: 'installed', version: active })
    ota = { ...ota, active, blocked: [...new Set([...ota.blocked, ...failed])], trial: boot.active.status === 'pending' ? { version: active, boots: 1 } : null }
    if (failed.length) {
      staged = null
      transition({ status: 'rolled-back', version: active, failedVersions: [...new Set(failed)], reason: 'Se restauró la interfaz anterior porque la actualización no arrancó correctamente.' })
    } else if (boot.active.status === 'pending') {
      staged = null
    } else if (confirmedTrial) {
      staged = null
      transition({ status: 'applied', version: active })
    } else if (config.enabled && staged) {
      const m = await verifyManifest(staged, config.publicKeys)
      if (m.version === active) {
        staged = null
        transition({ status: 'applied', version: active })
      } else {
        checkCompatibility(m, environment())
        // Restoring readiness needs an actual retained/queued native bundle, not just localStorage.
        // downloadVerified has persisted the native bundle; next is set only by apply().
        checked = { signed: staged, manifest: m }
        transition({ status: 'available', kind: 'web', manifest: m, releaseNotes: m.notes ?? '' })
        if (boot.downloaded.some((b) => b.version === m.version && b.checksum === m.sha256 && b.status !== 'error')) transition({ status: 'ready-to-restart', version: m.version, releaseNotes: m.notes ?? '' })
      }
    }
    save()
  }
  function start(): Promise<void> {
    started ??= initialize().catch((error) => { fail(error, 'installer'); throw error })
    return started
  }

  async function check(opts: CheckOptions = {}): Promise<UpdateState> {
    const silent = opts.silent === true
    if (working) return state
    // A silent check never replaces an offer, a download, a restart prompt or a one-time notice.
    if (silent && !SILENT_FROM.has(state.status)) return state
    if (options.platform === 'web') {
      if (silent) return state
      transition({ status: 'none', code: 'browser', reason: 'Gestionado por el navegador; usa el aviso de actualización de la aplicación web.' })
      return state
    }
    if (!config.enabled || !Object.keys(config.publicKeys).length || !config.allowedHosts.length || !config.manifestUrl) {
      if (silent) return state
      transition({ status: 'none', code: 'disabled', reason: UPDATE_REASONS.disabled })
      return state
    }
    working = true
    const ready = state.status === 'ready-to-restart' ? state : null // a downloaded bundle waiting for the restart
    // Silent mode publishes only an offer: every other outcome (nothing new, offline, bad signature, blocked version)
    // leaves the state exactly as it was, so neither the banner nor the settings page can show a trace of it.
    const settle = (next: UpdateState) => { if (!silent) transition(next) }
    if (!silent) { checked = null; transition({ status: 'checking' }) }
    try {
      await start()
      if (ota.trial) throw new OtaError('trial-in-progress', UPDATE_REASONS['trial-in-progress'])
      const signed = await installer.fetchManifest()
      if (!signed) { if (ready) { transition(ready); return state } settle({ status: 'none', code: 'no-update', reason: 'No hay una actualización disponible.' }); return state }
      const manifest = await verifyManifest(signed, config.publicKeys)
      if (ready && manifest.version === ready.version) { transition(ready); return state } // same version: still ready, never download twice
      const installed = compareVersions(manifest.version, ota.active) === 0
      // Equal web versions still need the correct host, schema and native shell; a required APK may be newer.
      try { checkCompatibility(manifest, environment(), installed) }
      catch (error) {
        if (!(error instanceof OtaError) || error.code !== 'native') throw error
        const n = manifest.native
        if (!n || n.versionCode < manifest.minNativeVersionCode || n.versionCode <= nativeBuild) throw error
        // Explicitly construct Play offers so an APK URL cannot leak to the settings UI.
        const native = { versionCode: n.versionCode, versionName: n.versionName, apkSha256: n.apkSha256, notes: n.notes, mandatory: n.mandatory,
          ...(config.distribution === 'play' ? { route: 'play' as const } : { route: 'apk' as const, apkUrl: n.apkUrl }) }
        transition({ status: 'available', kind: 'native', native, releaseNotes: n.notes })
        return state
      }
      if (installed) {
        settle({ status: 'none', code: 'no-update', reason: 'No hay una actualización disponible.' })
        return state
      }
      checked = { signed, manifest }
      transition({ status: 'available', kind: 'web', manifest, releaseNotes: manifest.notes ?? '' })
    } catch (error) { if (ready) transition(ready); else if (!silent) fail(error, 'network') }
    finally { working = false }
    return state
  }

  async function download(): Promise<UpdateState> {
    if (working || state.status !== 'available' || state.kind !== 'web' || !checked) return state
    working = true
    const { signed, manifest: offered } = checked
    transition({ status: 'downloading', progress: 0, releaseNotes: offered.notes ?? '' })
    try {
      // State is readable by UI consumers; never let a mutated snapshot authorize native download.
      const manifest = await verifyManifest(signed, config.publicKeys)
      checkCompatibility(manifest, environment())
      await installer.downloadVerified(manifest, (percent) => emit({ type: 'progress', percent }))
      staged = signed
      save()
      transition({ status: 'ready-to-restart', version: manifest.version, releaseNotes: manifest.notes ?? '' })
    } catch (error) { staged = null; fail(error, 'download') }
    finally { working = false }
    return state
  }

  async function apply(): Promise<UpdateState> {
    if (working || state.status !== 'ready-to-restart' || !staged) return state
    working = true
    const previous = ota
    const savedNotes = notes
    const savedPrevious = previousNotes
    let scheduled = false
    try {
      const manifest = await verifyManifest(staged, config.publicKeys)
      checkCompatibility(manifest, environment())
      ota = otaReducer(ota, { type: 'installed', version: manifest.version })
      previousNotes = notes?.version === previous.active ? notes : null
      notes = { version: manifest.version, text: manifest.notes ?? '' } // persisted with the trial, shown once it is confirmed
      save() // Record the trial BEFORE next()/reload() can destroy this JS context.
      await installer.activateOnNextStart(manifest.version, manifest.sha256)
      scheduled = true
      await installer.apply()
      // Remain ready until the new context reports healthy; reload() resolving is not proof.
    } catch (error) {
      let failure = error
      if (!scheduled) {
        ota = previous
        notes = savedNotes
        previousNotes = savedPrevious
        try { save() } catch (storageError) { failure = storageError }
      }
      fail(failure, 'installer')
    }
    finally { working = false }
    return state
  }

  async function reportHealthy(proof: { rendered: true; databaseOpened: true }): Promise<void> {
    if (options.platform === 'web') return
    if (!proof.rendered || !proof.databaseOpened) throw new OtaError('installer', 'Confirma el render y la apertura de la base de datos antes de declarar salud')
    await start()
    if (ota.blocked.includes(ota.active)) throw new OtaError('blocked', UPDATE_REASONS.blocked)
    const boot = await installer.boot()
    if ((boot.active.builtin ? options.builtInVersion : boot.active.version) !== ota.active) throw new OtaError('installer', 'El reinicio aún no terminó; no se puede confirmar salud desde la interfaz anterior')
    await installer.reportHealthy()
    const wasTrial = !!ota.trial
    ota = otaReducer(ota, { type: 'ready' })
    // After an automatic rollback the plugin may report the restored bundle as pending too: that boot is not an applied
    // update and must not hide the rollback notice.
    if (wasTrial && state.status !== 'rolled-back') { staged = null; transition({ status: 'applied', version: ota.active }) }
    save()
  }

  return {
    start, check, download, apply, reportHealthy,
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    currentVersion: async (): Promise<VersionInfo> => {
      if (options.platform === 'web') return { webVersion: options.builtInVersion, nativeVersionCode: null, nativeVersionName: null }
      await start()
      const info = await options.appInfo()
      return { webVersion: runningVersion, nativeVersionCode: Number(info.build), nativeVersionName: info.version }
    },
    releaseNotes: () => 'releaseNotes' in state ? state.releaseNotes : '',
    /** Signed notes of the bundle running now ('' for the built-in interface, after a rollback or in the browser). Valid after start(). */
    installedNotes: () => runningNotes,
    /** The one-time «actualizado» / «revertido» notice has been seen: back to idle. Any other state is untouched. */
    acknowledge: () => { if (state.status === 'applied' || state.status === 'rolled-back') transition({ status: 'idle' }) },
    // Snapshot copies prevent subscribers from mutating the persisted rollback journal.
    otaState: () => structuredClone(ota),
  }
}

export type UpdateService = ReturnType<typeof createUpdateService>
