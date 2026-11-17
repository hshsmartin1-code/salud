import { describe, expect, it, vi } from 'vitest'
import { createCapgoInstaller, type CapgoPort, type HttpPort } from './installer.capgo'
import { signedFixture, TEST_HOST } from './test-fixtures'

async function fixture() {
  const f = await signedFixture()
  const b = { id: 'b1', version: f.manifest.version, checksum: f.manifest.sha256, status: 'pending', downloaded: '' }
  const remove = vi.fn(async () => {})
  let onDownload: ((event: { percent: number; bundle: typeof b }) => void) | undefined
  const port = {
    download: vi.fn(async () => { onDownload?.({ percent: 50, bundle: b }); return b }),
    next: vi.fn(async () => b), reload: vi.fn(async () => {}), reset: vi.fn(async () => {}),
    current: vi.fn(async () => ({ bundle: { ...b, id: 'builtin', status: 'success' }, native: '3.0.0' })),
    list: vi.fn(async () => ({ bundles: [b, { ...b, id: 'failed', version: '3.0.1', status: 'error' }] })),
    getNextBundle: vi.fn(async () => null), getFailedUpdate: vi.fn(async () => ({ bundle: { ...b, version: '3.0.2' } })),
    notifyAppReady: vi.fn(async () => ({ bundle: b })),
    addListener: vi.fn(async (_event: string, fn: typeof onDownload) => { onDownload = fn; return { remove } }),
  }
  const http = { request: vi.fn<HttpPort['request']>(async (options) => ({ status: 200, headers: { 'Content-Length': String(f.manifest.size) }, data: JSON.stringify(f.signed), url: options.url })) }
  const installer = createCapgoInstaller(f.config, { plugin: async () => port as unknown as CapgoPort, http: async () => http, appInfo: async () => ({ build: '10', version: '3.0.0' }) })
  return { ...f, port, http, installer, b, remove }
}

describe('manual Capgo adapter', () => {
  it('passes the signed native SHA-256, forwards progress and queues only on request', async () => {
    const f = await fixture(); const progress = vi.fn()
    expect(await f.installer.nativeVersionCode()).toBe(10)
    expect(await f.installer.fetchManifest()).toEqual(f.signed)
    expect(await f.installer.downloadVerified(f.manifest, progress)).toMatchObject({ id: 'b1' })
    expect(f.port.download).toHaveBeenCalledWith({ url: f.manifest.url, version: f.manifest.version, checksum: f.manifest.sha256 })
    expect(progress).toHaveBeenCalledWith(50)
    expect(f.remove).toHaveBeenCalledOnce()
    expect(f.port.next).not.toHaveBeenCalled()
    await f.installer.activateOnNextStart(f.manifest.version)
    expect(f.port.next).toHaveBeenCalledWith({ id: 'b1' })
    await f.installer.apply(); await f.installer.reportHealthy(); await f.installer.revertToPrevious()
    expect(f.port.reload).toHaveBeenCalledOnce()
    expect(f.port.notifyAppReady).toHaveBeenCalledOnce()
    expect(f.port.reset).toHaveBeenCalledWith({ toLastSuccessful: true })
  })

  it('a channel with nothing published yet (404 on the manifest) means no update, not an error; a missing ZIP or another status still fails', async () => {
    const f = await fixture()
    f.http.request.mockResolvedValue({ status: 404, headers: {}, data: 'Not Found', url: f.config.manifestUrl })
    expect(await f.installer.fetchManifest()).toBeNull()
    await expect(f.installer.downloadVerified(f.manifest, vi.fn())).rejects.toMatchObject({ code: 'network' })
    f.http.request.mockResolvedValue({ status: 500, headers: {}, data: '', url: f.config.manifestUrl })
    await expect(f.installer.fetchManifest()).rejects.toMatchObject({ code: 'network' })
    f.http.request.mockResolvedValue({ status: 403, headers: {}, data: '', url: f.config.manifestUrl })
    await expect(f.installer.fetchManifest()).rejects.toMatchObject({ code: 'network' })
  })

  it('reconciles native current, pending, retained error bundles and consumed failure evidence', async () => {
    const f = await fixture()
    expect(await f.installer.boot()).toMatchObject({ active: { builtin: true, status: 'success' }, failed: ['3.0.1', '3.0.2'], next: null })
    expect(f.port.notifyAppReady).not.toHaveBeenCalled()
  })

  it.each(['wrong-size', 'no-length', 'wrong-checksum', 'download-rejection', 'checksum-rejection', 'plugin-final-failure'])('fails closed for %s', async (failure) => {
    const f = await fixture()
    if (failure === 'wrong-size' || failure === 'no-length') f.http.request.mockResolvedValue({ status: 200, headers: failure === 'no-length' ? {} : { 'content-length': '1' }, data: '', url: f.manifest.url })
    if (failure === 'wrong-checksum') f.port.download.mockResolvedValue({ ...f.b, checksum: 'f'.repeat(64) })
    if (failure === 'download-rejection') f.port.download.mockRejectedValue(Error('network lost'))
    if (failure === 'checksum-rejection') f.port.download.mockRejectedValue(Error('Checksum failed'))
    if (failure === 'plugin-final-failure') f.port.download.mockRejectedValue(Error('Failed to download from: http://localhost:4156/bundle.zip')) // what a corrupted ZIP rejects with on Android
    await expect(f.installer.downloadVerified(f.manifest, () => {})).rejects.toMatchObject({ code: failure === 'download-rejection' ? 'download' : 'integrity' })
    expect(f.port.next).not.toHaveBeenCalled()
    if (!['wrong-size', 'no-length'].includes(failure)) expect(f.remove).toHaveBeenCalledOnce()
  })

  it('resolves GitHub redirects only when the target host is explicitly allowed', async () => {
    const f = await fixture()
    f.config.allowedHosts = ['github.com', 'release-assets.githubusercontent.com']
    const m = { ...f.manifest, url: 'https://github.com/owner/repo/releases/download/v3.1/bundle.zip' }
    f.http.request.mockImplementation(async (options): ReturnType<HttpPort['request']> => options.url.startsWith('https://github.com/') ?
      { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset.zip?token=test' }, data: '', url: options.url } :
      { status: 200, headers: { 'content-length': String(m.size) }, data: '', url: options.url })
    await f.installer.downloadVerified(m, () => {})
    expect(f.http.request).toHaveBeenCalledWith(expect.objectContaining({ disableRedirects: true, method: 'HEAD' }))
    expect(f.port.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://release-assets.githubusercontent.com/asset.zip?token=test' }))
    f.config.allowedHosts = ['github.com']
    await expect(f.installer.downloadVerified(m, () => {})).rejects.toMatchObject({ code: 'host' })
  })

  it.each(['https://foreign.invalid/x', `http://${TEST_HOST}/x`])('refuses a redirect to %s before requesting it', async (location) => {
    const f = await fixture()
    f.http.request.mockResolvedValue({ status: 302, headers: { location }, data: '', url: f.manifest.url })
    await expect(f.installer.downloadVerified(f.manifest, () => {})).rejects.toMatchObject({ code: 'host' })
    expect(f.http.request).toHaveBeenCalledOnce()
    expect(f.port.download).not.toHaveBeenCalled()
  })

  it('disabled installer never requests or downloads anything', async () => {
    const f = await fixture(); f.config.enabled = false
    await expect(f.installer.fetchManifest()).rejects.toMatchObject({ code: 'disabled' })
    await expect(f.installer.downloadVerified(f.manifest, () => {})).rejects.toMatchObject({ code: 'disabled' })
    expect(f.http.request).not.toHaveBeenCalled(); expect(f.port.download).not.toHaveBeenCalled()
  })

  it('restores only a retained bundle matching the signed digest, not just its version label', async () => {
    const f = await fixture()
    f.port.list.mockResolvedValue({ bundles: [{ ...f.b, id: 'wrong', checksum: 'b'.repeat(64) }, f.b] })
    await f.installer.activateOnNextStart(f.manifest.version, f.manifest.sha256)
    expect(f.port.next).toHaveBeenCalledWith({ id: 'b1' })
    await expect(f.installer.activateOnNextStart(f.manifest.version, 'f'.repeat(64))).rejects.toMatchObject({ code: 'installer' })
  })
})

// Device finding (Salud Dev, Android 14): a Capacitor plugin is a Proxy that answers every property, including "then",
// so resolving a promise with it rejected with '"CapacitorUpdater.then()" is not implemented on android'.
describe('plugin loaders hand out plain objects, never the Capacitor proxy', () => {
  function proxyPlugin(methods: Record<string, unknown>) {
    return new Proxy({}, { get: (_t, prop) => (prop in methods ? methods[prop as string] : (prop === 'then' ? () => { throw new Error('"then()" is not implemented on android') } : () => Promise.reject(new Error('not implemented')))) })
  }
  it('loadCapgo resolves (no then) and delegates calls', async () => {
    vi.resetModules()
    const notifyAppReady = vi.fn(async () => ({ bundle: { id: 'builtin' } }))
    vi.doMock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: proxyPlugin({ notifyAppReady }) }))
    const { loadCapgo } = await import('./installer.capgo')
    const port = await loadCapgo()
    expect('then' in port).toBe(false)
    await port.notifyAppReady()
    expect(notifyAppReady).toHaveBeenCalledOnce()
    vi.doUnmock('@capgo/capacitor-updater')
  })
  it('loadHttp resolves (no then) and delegates request', async () => {
    vi.resetModules()
    const request = vi.fn(async () => ({ status: 200, headers: {}, data: '', url: 'http://localhost:4156/manifest.json' }))
    vi.doMock('@capacitor/core', () => ({ CapacitorHttp: proxyPlugin({ request }) }))
    const { loadHttp } = await import('./installer.capgo')
    const http = await loadHttp()
    expect('then' in http).toBe(false)
    await http.request({ url: 'http://localhost:4156/manifest.json', method: 'GET', disableRedirects: true, responseType: 'text', connectTimeout: 1, readTimeout: 1 })
    expect(request).toHaveBeenCalledOnce()
    vi.doUnmock('@capacitor/core')
  })
})

// Device finding (Salud Dev, Android 14): with the server cutting the transfer at 30 %, WorkManager retried forever,
// the percent restarted at 0 and download() never settled, so the screen sat on "Descargando… 30 %".
describe('a download that the native worker keeps retrying is reported as failed', () => {
  async function stalled() {
    const f = await fixture()
    let emit: ((event: { percent: number; bundle: typeof f.b }) => void) | undefined
    f.port.addListener = vi.fn(async (_event: string, fn: typeof emit) => { emit = fn; return { remove: f.remove } }) as never
    f.port.download = vi.fn(() => new Promise(() => undefined)) as never // never settles, like the retrying worker
    ;(f.port as Record<string, unknown>).delete = vi.fn(async () => undefined)
    return { ...f, emit: (percent: number) => emit?.({ percent, bundle: f.b }) }
  }
  it('a restart that replays 0..30 % for 30 s fails with download and deletes the partial bundle', async () => {
    vi.useFakeTimers()
    try {
      const f = await stalled()
      const progress = vi.fn()
      const result = f.installer.downloadVerified(f.manifest, progress)
      result.catch(() => undefined)
      await vi.advanceTimersByTimeAsync(0)
      for (const p of [0, 10, 20, 30]) f.emit(p)
      await vi.advanceTimersByTimeAsync(10_000)
      for (const p of [0, 10, 20, 30]) f.emit(p) // retry: nothing new
      await vi.advanceTimersByTimeAsync(20_001)
      await expect(result).rejects.toMatchObject({ code: 'download' })
      expect(progress).toHaveBeenLastCalledWith(30)
      expect((f.port as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith({ id: 'b1' })
      expect(f.remove).toHaveBeenCalled()
      expect(f.port.next).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('a stray 0 % reading between normal percentages does not fail a healthy download', async () => {
    vi.useFakeTimers()
    try {
      const f = await stalled()
      let finish: ((b: typeof f.b) => void) | undefined
      f.port.download = vi.fn(() => new Promise((resolve) => { finish = resolve as never })) as never
      const result = f.installer.downloadVerified(f.manifest, () => undefined)
      await vi.advanceTimersByTimeAsync(0)
      f.emit(0); f.emit(5); f.emit(0)
      await vi.advanceTimersByTimeAsync(20_000)
      f.emit(40)
      await vi.advanceTimersByTimeAsync(20_000)
      f.emit(80)
      finish?.(f.b)
      await expect(result).resolves.toMatchObject({ version: f.manifest.version })
    } finally { vi.useRealTimers() }
  })
  it('30 s without any event fails with download', async () => {
    vi.useFakeTimers()
    try {
      const f = await stalled()
      const result = f.installer.downloadVerified(f.manifest, () => undefined)
      result.catch(() => undefined)
      await vi.advanceTimersByTimeAsync(29_000)
      f.emit(10)
      await vi.advanceTimersByTimeAsync(29_000) // the new highest re-armed the watchdog
      let settled = false
      result.then(() => { settled = true }, () => { settled = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(result).rejects.toMatchObject({ code: 'download' })
    } finally { vi.useRealTimers() }
  })
})
