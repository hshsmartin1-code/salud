import type { CapacitorUpdaterPlugin, BundleInfo } from '@capgo/capacitor-updater'
import { assertAllowedUrl, OtaError, type OtaManifest, type SignedManifest } from './manifest'
import type { OtaConfig } from './config'
import type { InstalledBundle, NativeBundleInstaller } from './updater'

export type CapgoPort = Pick<CapacitorUpdaterPlugin, 'download' | 'delete' | 'next' | 'reload' | 'reset' | 'current' | 'list' | 'getFailedUpdate' | 'getNextBundle' | 'notifyAppReady' | 'addListener'>
export interface HttpPort {
  request(options: { url: string; method: string; disableRedirects: boolean; responseType: 'text'; connectTimeout: number; readTimeout: number }): Promise<{ status: number; headers: Record<string, string>; data: unknown; url: string }>
}
export type AppInfoPort = () => Promise<{ build: string; version: string }>
const header = (headers: Record<string, string>, name: string): string | undefined => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
const bundleInfo = (b: BundleInfo): InstalledBundle => ({ id: b.id, version: b.version, checksum: b.checksum, builtin: b.id === 'builtin', status: b.status === 'success' ? 'success' : b.status === 'error' ? 'error' : 'pending' })

/** Lazy imports match the notifications adapter: importing this module has no native side effects. */
const CAPGO_METHODS = ['download', 'delete', 'next', 'reload', 'reset', 'current', 'list', 'getFailedUpdate', 'getNextBundle', 'notifyAppReady', 'addListener'] as const
/**
 * A Capacitor plugin object is a Proxy that answers EVERY property, including "then". Returning it from an async
 * function (or resolving a promise with it) makes the runtime call plugin.then(), which rejects with
 * "is not implemented on android" (found on a real device: the updater could never start). Hand out a plain object instead.
 */
export async function loadCapgo(): Promise<CapgoPort> {
  const plugin = (await import('@capgo/capacitor-updater')).CapacitorUpdater
  return Object.fromEntries(CAPGO_METHODS.map((name) => [name, (...args: unknown[]) => (plugin[name] as (...a: unknown[]) => unknown)(...args)])) as unknown as CapgoPort
}
export async function nativeAppInfo() { return (await import('@capacitor/app')).App.getInfo() }
export async function loadHttp(): Promise<HttpPort> {
  const http = (await import('@capacitor/core')).CapacitorHttp // also a Proxy: never resolve a promise with it directly
  return { request: (options) => http.request(options as never) as ReturnType<HttpPort['request']> }
}

/** No new highest percentage for this long counts as a failed download. */
const STALL_MS = 30_000

export function createCapgoInstaller(config: OtaConfig, dependencies: {
  plugin?: () => Promise<CapgoPort>; http?: () => Promise<HttpPort>; appInfo?: AppInfoPort
} = {}): NativeBundleInstaller {
  const plugin = dependencies.plugin ?? loadCapgo
  const appInfo = dependencies.appInfo ?? nativeAppInfo
  const staged = new Map<string, { id: string; checksum: string }>()
  const enabled = () => { if (!config.enabled) throw new OtaError('disabled', 'Actualizaciones desactivadas en esta compilación') }

  // Inspect each redirect without following it first. GitHub Releases requires explicitly allowing
  // github.com AND release-assets.githubusercontent.com (legacy: objects.githubusercontent.com).
  // Native download follows redirects independently; see the project notes for the host-policy limit.
  async function request(url: string, method: 'GET' | 'HEAD', absentOk = false) {
    enabled()
    const http = await (dependencies.http ?? loadHttp)()
    for (let hop = 0; hop < 6; hop++) {
      const checked = assertAllowedUrl(url, config)
      const response = await http.request({ url: checked.href, method, disableRedirects: true, responseType: 'text', connectTimeout: 20000, readTimeout: 20000 })
      assertAllowedUrl(response.url || checked.href, config)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = header(response.headers, 'location')
        if (!location) throw new OtaError('network', 'Redirección sin destino')
        url = assertAllowedUrl(new URL(location, checked).href, config).href
        continue
      }
      // Nothing has been published on this channel yet: that is "no update", only for the manifest itself.
      if (response.status === 404 && absentOk) return null
      if (response.status !== 200 && response.status !== 204) throw new OtaError('network', 'No se pudo consultar el servidor de actualizaciones')
      return { ...response, url: checked.href }
    }
    throw new OtaError('host', 'Demasiadas redirecciones')
  }

  return {
    nativeVersionCode: async () => {
      const code = Number((await appInfo()).build)
      if (!Number.isSafeInteger(code) || code < 1) throw new OtaError('native', 'No se pudo leer la versión nativa')
      return code
    },
    fetchManifest: async () => {
      const response = await request(config.manifestUrl, 'GET', true)
      if (!response) return null
      try { return (typeof response.data === 'string' ? JSON.parse(response.data) : response.data) as SignedManifest | null }
      catch { throw new OtaError('format', 'El manifiesto no es JSON') }
    },
    downloadVerified: async (manifest: OtaManifest, progress) => {
      enabled()
      const response = await request(manifest.url, 'HEAD')
      if (!response) throw new OtaError('network', 'No se pudo consultar el servidor de actualizaciones') // fail closed: a ZIP is never optional
      // Fail closed if the host cannot supply a size; native API does not expose zip byte length.
      if (Number(header(response.headers, 'content-length')) !== manifest.size) throw new OtaError('integrity', 'Tamaño distinto al del manifiesto')
      const capgo = await plugin()
      // The native downloader never gives up: on a cut connection WorkManager retries without limit, restarts the
      // transfer from 0 % and the promise below never settles (seen on a device with the server cutting at 30 %).
      // Its progress events also include stray 0 % readings, so a drop is NOT a failure by itself. What fails the
      // download is 30 s without any NEW highest percentage (a restart keeps replaying the same early percentages).
      let bundleId: string | null = null
      let highest = -1
      let stalled: ((error: OtaError) => void) | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const failure = new Promise<never>((_, reject) => { stalled = reject })
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => stalled?.(new OtaError('download', 'La descarga se detuvo')), STALL_MS) }
      const listener = await capgo.addListener('download', (event) => {
        if (event.bundle.version !== manifest.version || !Number.isFinite(event.percent)) return
        bundleId ??= event.bundle.id
        const percent = Math.max(0, Math.min(100, event.percent))
        if (percent > highest) { highest = percent; arm(); progress(percent) }
      })
      arm()
      try {
        // CapgoUpdater.java:1377-1435 hashes the downloaded ZIP before unzip, with SHA-256.
        // The signed digest binds all bytes (hence their length); JS never receives the zip.
        const result = await Promise.race([capgo.download({ url: response.url, version: manifest.version, checksum: manifest.sha256 }), failure])
        if (result.checksum !== manifest.sha256 || result.version !== manifest.version || !['pending', 'success'].includes(result.status) || result.id === 'builtin') throw new OtaError('integrity', 'El instalador rechazó la integridad del bundle')
        staged.set(manifest.version, { id: result.id, checksum: manifest.sha256 })
        return bundleInfo(result)
      } catch (error) {
        if (error instanceof OtaError) throw error
        // Android sometimes wraps a checksum error in a generic download rejection. Both fail closed.
        // The plugin retries network errors forever, so a REJECTION from it is a permanent failure. On a device a corrupted ZIP rejects with
        // only "Failed to download from: <url>" (the checksum text stays in logcat) after the HEAD check already passed.
        if (/checksum|integrity|Failed to download from/i.test(String(error))) throw new OtaError('integrity', 'El contenido descargado está dañado')
        throw new OtaError('download', 'La descarga falló o se perdió la conexión')
      } finally {
        clearTimeout(timer)
        await listener.remove()
        // Best effort: also stops the native worker that would otherwise keep retrying in the background.
        if (bundleId && !staged.has(manifest.version)) await capgo.delete({ id: bundleId }).catch(() => undefined)
      }
    },
    activateOnNextStart: async (version, sha256) => {
      enabled()
      const capgo = await plugin()
      const local = staged.get(version)
      const id = local && (!sha256 || local.checksum === sha256) ? local.id :
        (await capgo.list()).bundles.find((b) => b.version === version && b.status === 'pending' && !!sha256 && b.checksum === sha256)?.id
      if (!id) throw new OtaError('installer', 'No hay un bundle verificado preparado')
      await capgo.next({ id })
    },
    apply: async () => { enabled(); await (await plugin()).reload() },
    revertToPrevious: async () => { await (await plugin()).reset({ toLastSuccessful: true }) },
    reportHealthy: async () => { await (await plugin()).notifyAppReady() },
    boot: async () => {
      const capgo = await plugin()
      const current = await capgo.current()
      const bundles = await capgo.list()
      const next = await capgo.getNextBundle()
      // getFailedUpdate is consuming; read it last, also retain error bundles in native storage.
      const lastFailed = await capgo.getFailedUpdate()
      return { active: bundleInfo(current.bundle), next: next ? bundleInfo(next) : null, downloaded: bundles.bundles.map(bundleInfo),
        failed: [...new Set([...bundles.bundles.filter((b) => b.status === 'error').map((b) => b.version), ...(lastFailed ? [lastFailed.bundle.version] : [])])] }
    },
  }
}
