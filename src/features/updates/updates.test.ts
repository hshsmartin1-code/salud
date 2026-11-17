import { describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from '../../db/schema'
import { OtaError, OTA_FORMAT, verifyManifest } from '../../ota/manifest'
import { FakeInstaller, MemoryStorage, signedFixture } from '../../ota/test-fixtures'
import { createUpdateService, OTA_STORAGE_KEY } from './service'
import { UPDATE_REASONS, updateReducer, type UpdateState } from './state'

async function setup(overrides: Parameters<typeof signedFixture>[0] = {}) {
  const fixture = await signedFixture(overrides)
  const installer = new FakeInstaller(fixture.signed)
  const storage = new MemoryStorage()
  const options = { config: fixture.config, installer, storage, appInfo: vi.fn(async () => ({ build: '10', version: '3.0.0' })),
    builtInVersion: '3.0.0', schemaVersion: SCHEMA_VERSION, platform: 'native' as 'native' | 'web' }
  return { ...fixture, installer, storage, options, service: createUpdateService(options) }
}
const healthy = { rendered: true, databaseOpened: true } as const

describe('update service', () => {
  it('checks, downloads with progress, restarts and confirms only after render and DB open', async () => {
    const f = await setup()
    const seen: UpdateState[] = []
    const unsubscribe = f.service.subscribe(() => seen.push(f.service.getState()))
    expect(await f.service.check()).toMatchObject({ status: 'available', kind: 'web' })
    expect(f.installer.calls).toEqual(['boot', 'fetch'])
    expect(f.service.releaseNotes()).toBe('Mejoras de estabilidad.')
    expect(await f.service.download()).toMatchObject({ status: 'ready-to-restart' })
    expect(seen).toContainEqual({ status: 'downloading', progress: 45, releaseNotes: 'Mejoras de estabilidad.' })
    expect(f.installer.calls).not.toContain('next')
    await f.service.apply()
    expect(f.installer.calls.slice(-2)).toEqual(['next', 'apply'])
    expect(f.installer.calls).not.toContain('healthy')
    const restarted = createUpdateService(f.options)
    await restarted.start()
    expect(restarted.otaState().trial?.version).toBe('3.1.0')
    await restarted.reportHealthy(healthy)
    expect(restarted.getState()).toEqual({ status: 'applied', version: '3.1.0' })
    expect(restarted.otaState().trial).toBeNull()
    expect(await restarted.currentVersion()).toEqual({ webVersion: '3.1.0', nativeVersionCode: 10, nativeVersionName: '3.0.0' })
    unsubscribe()
  })

  it.each([new OtaError('download', 'failed'), new Error('connection lost mid-download')])('handles rejected downloads without staging or activation (%s)', async (failure) => {
    const f = await setup(); f.installer.failure = failure
    await f.service.check()
    expect(await f.service.download()).toMatchObject({ status: 'error', code: 'download' })
    expect(f.installer.next).toBeNull()
    expect(f.service.otaState().active).toBe('3.0.0')
  })

  it('rejects a corrupted zip through the installer checksum contract', async () => {
    const f = await setup(); f.installer.bytes = f.installer.bytes.slice(); f.installer.bytes[0] ^= 1
    await f.service.check()
    expect(await f.service.download()).toMatchObject({ status: 'error', code: 'integrity' })
    expect(f.installer.downloaded).toEqual([])
  })

  it('reverifies the signed envelope before download even if a UI consumer mutated the offered manifest', async () => {
    const f = await setup()
    const state = await f.service.check()
    if (state.status !== 'available' || state.kind !== 'web') throw Error('Expected web offer')
    state.manifest.url = 'https://foreign.invalid/mutated.zip'
    state.manifest.sha256 = 'f'.repeat(64)
    const download = vi.spyOn(f.installer, 'downloadVerified')
    expect(await f.service.download()).toMatchObject({ status: 'ready-to-restart' })
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: f.manifest.url, sha256: f.manifest.sha256 }), expect.any(Function))
  })

  it('offers a signed native release for too-new minNativeVersionCode, without APK handling', async () => {
    const f = await setup({ minNativeVersionCode: 11, native: { versionCode: 11, versionName: '3.2.0', apkUrl: 'https://updates.example.test/app.apk', apkSha256: 'a'.repeat(64), notes: 'Nuevas funciones nativas.', mandatory: true } })
    expect(await f.service.check()).toMatchObject({ status: 'available', kind: 'native', native: { route: 'apk', apkUrl: 'https://updates.example.test/app.apk', mandatory: true } })
    await f.service.download(); await f.service.apply()
    expect(f.installer.calls).toEqual(['boot', 'fetch'])
  })

  it('never exposes an APK URL in a Play offer', async () => {
    const f = await setup({ minNativeVersionCode: 11, native: { versionCode: 11, versionName: '3.2.0', apkUrl: 'https://updates.example.test/app.apk', apkSha256: 'a'.repeat(64), notes: 'Mejoras.' } })
    f.options.config.distribution = 'play'
    const state = await f.service.check()
    expect(state).toMatchObject({ status: 'available', kind: 'native', native: { route: 'play' } })
    expect(JSON.stringify(state)).not.toContain('apkUrl')
  })

  it.each([
    [{ minNativeVersionCode: 11 }, 'native'],
    [{ schemaVersion: SCHEMA_VERSION + 1 }, 'schema'],
    [{ version: '2.9.0' }, 'downgrade'],
    [{ url: 'http://updates.example.test/x.zip' }, 'host'],
    [{ url: 'https://foreign.invalid/x.zip' }, 'host'],
    [{ channel: 'stable' as const }, 'channel'],
  ] as const)('rejects incompatible manifest %j with %s', async (override, code) => {
    const f = await setup(override)
    expect(await f.service.check()).toMatchObject({ code })
    expect(f.installer.calls).not.toContain('download')
  })

  it.each(['signature', 'unknown-key'] as const)('rejects %s before any download', async (code) => {
    const f = await setup()
    f.installer.manifest = code === 'signature' ? { ...f.signed, signature: 'AAAA' } : { ...f.signed, keyId: 'unknown' }
    expect(await f.service.check()).toMatchObject({ status: 'error', code })
    expect(f.installer.calls).not.toContain('download')
  })

  it('rolls back after a boot without health, persists the block, and refuses that version', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    const trial = createUpdateService(f.options)
    await trial.start() // New bundle rendered no health signal; process then died.
    f.installer.restartWithoutHealth()
    const restored = createUpdateService(f.options)
    await restored.start()
    expect(restored.getState()).toMatchObject({ status: 'rolled-back', version: '3.0.0', failedVersions: ['3.1.0'] })
    expect(restored.otaState().blocked).toContain('3.1.0')
    expect(await restored.check()).toMatchObject({ status: 'incompatible', code: 'blocked' })
    expect(f.storage.values.size).toBe(1)
    expect([...f.storage.values.keys()]).toEqual([OTA_STORAGE_KEY])
  })

  it('keeps the rollback notice when the plugin reports the restored bundle as pending (found on a device)', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    f.installer.restartWithoutHealth()
    f.installer.active = { ...f.installer.active, status: 'pending' } // the real plugin marks the reverted bundle pending
    const restored = createUpdateService(f.options)
    await restored.start()
    expect(restored.getState()).toMatchObject({ status: 'rolled-back', failedVersions: ['3.1.0'] })
    await restored.reportHealthy(healthy)
    expect(restored.getState()).toMatchObject({ status: 'rolled-back', version: '3.0.0', failedVersions: ['3.1.0'] })
    expect(restored.otaState().blocked).toContain('3.1.0')
  })

  it('checking again while a bundle is ready keeps it ready for the same version and never downloads twice', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download()
    expect(await f.service.check()).toMatchObject({ status: 'ready-to-restart', version: '3.1.0' })
    expect(f.installer.calls.filter((c) => c === 'download')).toHaveLength(1)
    f.installer.manifest = null
    expect(await f.service.check()).toMatchObject({ status: 'ready-to-restart' })
  })

  it('restores readiness from the journal plus the native retained bundle after a restart', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download()
    const restarted = createUpdateService(f.options)
    await restarted.start()
    expect(restarted.getState()).toMatchObject({ status: 'ready-to-restart', version: '3.1.0' })
    await restarted.apply()
    expect(f.installer.active.version).toBe('3.1.0')
  })

  it('does not trust a tampered persisted manifest or a missing retained native bundle', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download()
    f.installer.downloaded = []
    const restarted = createUpdateService(f.options)
    await restarted.start()
    expect(restarted.getState()).toMatchObject({ status: 'available' })
    await restarted.apply()
    expect(f.installer.calls).not.toContain('next')
    const journal = JSON.parse(f.storage.getItem(OTA_STORAGE_KEY)!)
    journal.staged.signature = 'AAAA'; f.storage.setItem(OTA_STORAGE_KEY, JSON.stringify(journal))
    const tampered = createUpdateService(f.options)
    await expect(tampered.start()).rejects.toMatchObject({ code: 'signature' })
  })

  it('reads active bundle and failure evidence from native even without a local journal', async () => {
    const f = await setup()
    f.installer.active = { id: 'downloaded', version: '3.0.1', status: 'success' }
    f.installer.failed = ['3.0.2']
    await f.service.start()
    expect(f.service.otaState()).toMatchObject({ active: '3.0.1', blocked: ['3.0.2'] })
  })

  it('does not report health from the old context or misclassify a still-queued bundle as a rollback', async () => {
    const f = await setup()
    f.installer.apply = async () => {} // reload has been requested but native context has not changed.
    await f.service.check(); await f.service.download(); await f.service.apply()
    await expect(f.service.reportHealthy(healthy)).rejects.toMatchObject({ code: 'installer' })
    expect(f.installer.calls).not.toContain('healthy')
    const restarted = createUpdateService(f.options)
    await restarted.start()
    expect(restarted.getState()).toMatchObject({ status: 'ready-to-restart' })
    expect(restarted.otaState().blocked).toEqual([])
  })

  it('recovers native-confirmed success if persisting the health acknowledgement failed', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    const restarted = createUpdateService(f.options)
    await restarted.start()
    const setItem = f.storage.setItem.bind(f.storage)
    f.storage.setItem = () => { throw Error('quota') }
    await expect(restarted.reportHealthy(healthy)).rejects.toMatchObject({ code: 'storage' })
    f.storage.setItem = setItem
    const recovered = createUpdateService(f.options)
    await recovered.start()
    expect(recovered.getState()).toEqual({ status: 'applied', version: '3.1.0' })
    expect(recovered.otaState().trial).toBeNull()
  })

  it('resets trial state on a native build upgrade using the built-in bundle', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    f.options.appInfo.mockResolvedValue({ build: '11', version: '3.2.0' })
    f.installer.active = { id: 'builtin', version: '3.2.0', status: 'success', builtin: true }
    const upgraded = createUpdateService({ ...f.options, builtInVersion: '3.2.0' })
    await upgraded.start()
    expect(upgraded.otaState()).toMatchObject({ active: '3.2.0', trial: null, blocked: [] })
  })

  it('disabled checks have zero network/native calls', async () => {
    const f = await setup(); f.options.config.enabled = false
    expect(await f.service.check()).toMatchObject({ status: 'none', code: 'disabled' })
    expect(f.installer.calls).toEqual([])
    expect(f.options.appInfo).not.toHaveBeenCalled()
  })

  it('web defers to the existing service-worker prompt, never loads native plugins', async () => {
    const f = await setup(); f.options.platform = 'web'
    const service = createUpdateService(f.options)
    expect(await service.check()).toMatchObject({ status: 'none', code: 'browser', reason: expect.stringContaining('navegador') })
    await service.download(); await service.apply(); await service.reportHealthy(healthy)
    expect(await service.currentVersion()).toEqual({ webVersion: '3.0.0', nativeVersionCode: null, nativeVersionName: null })
    expect(f.installer.calls).toEqual([])
  })

  it('still accepts manifest v1', async () => {
    const f = await setup({ format: OTA_FORMAT, notes: undefined })
    expect(await f.service.check()).toMatchObject({ status: 'available', kind: 'web' })
  })

  it('handles no update, fetch failure and refuses concurrent operations', async () => {
    const f = await setup(); f.installer.manifest = null
    expect(await f.service.check()).toMatchObject({ status: 'none', code: 'no-update' })
    f.installer.fetchManifest = vi.fn(async () => { throw Error('offline') })
    expect(await f.service.check()).toMatchObject({ status: 'error', code: 'network' })
    let resolveFetch!: (value: typeof f.signed) => void
    f.installer.fetchManifest = vi.fn(() => new Promise<typeof f.signed>((resolve) => { resolveFetch = resolve }))
    const pending = f.service.check()
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'))
    await f.service.check()
    expect(f.installer.fetchManifest).toHaveBeenCalledTimes(1)
    resolveFetch(f.signed); await pending
  })

  it('fails closed if persistence is unavailable or malformed', async () => {
    const f = await setup()
    f.storage.setItem(OTA_STORAGE_KEY, '{bad')
    expect(await f.service.check()).toMatchObject({ status: 'error', code: 'storage' })
    expect(f.installer.calls).not.toContain('fetch')
    const g = await setup(); g.storage.setItem = () => { throw Error('quota') }
    expect(await g.service.check()).toMatchObject({ status: 'error', code: 'storage' })
  })

  it('blocks checking a trial before health and rejects a false health proof', async () => {
    const f = await setup(); f.installer.active = { id: 'trial', version: '3.0.1', status: 'pending' }
    expect(await f.service.check()).toMatchObject({ code: 'trial-in-progress' })
    await expect(f.service.reportHealthy({ rendered: false, databaseOpened: true } as unknown as typeof healthy)).rejects.toMatchObject({ code: 'installer' })
    expect(f.installer.calls).not.toContain('healthy')
  })

  it('notes and native fields are covered by the signature and constrained as plain text', async () => {
    const f = await setup()
    await expect(verifyManifest({ ...f.signed, manifest: f.signed.manifest.replace('estabilidad', 'espionaje') }, f.config.publicKeys)).rejects.toMatchObject({ code: 'signature' })
    for (const notes of ['<script>bad</script>', 'x'.repeat(2001), '\u0000']) {
      await expect(verifyManifest(await f.sign({ ...f.manifest, notes }), f.config.publicKeys)).rejects.toMatchObject({ code: 'format' })
    }
  })

  it('exposes Spanish reasons and clamps progress monotonically', () => {
    expect(Object.values(UPDATE_REASONS).every((s) => s.length > 20)).toBe(true)
    const s: UpdateState = { status: 'downloading', progress: 40, releaseNotes: '' }
    expect(updateReducer(s, { type: 'progress', percent: 10 })).toEqual(s)
    expect(updateReducer(s, { type: 'progress', percent: 400 })).toMatchObject({ progress: 100 })
    expect(updateReducer({ status: 'idle' }, { type: 'progress', percent: 40 })).toEqual({ status: 'idle' })
  })
})
