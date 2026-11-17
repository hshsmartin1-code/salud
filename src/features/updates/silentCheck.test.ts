import { describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from '../../db/schema'
import { FakeInstaller, MemoryStorage, signedFixture } from '../../ota/test-fixtures'
import { createUpdateService, OTA_STORAGE_KEY } from './service'
import type { UpdateState } from './state'

async function setup(overrides: Parameters<typeof signedFixture>[0] = {}, schemaVersion = SCHEMA_VERSION) {
  const fixture = await signedFixture(overrides)
  const installer = new FakeInstaller(fixture.signed)
  const storage = new MemoryStorage()
  const options = { config: fixture.config, installer, storage, appInfo: vi.fn(async () => ({ build: '10', version: '3.0.0' })),
    builtInVersion: '3.0.0', schemaVersion, platform: 'native' as 'native' | 'web' }
  return { ...fixture, installer, storage, options, service: createUpdateService(options) }
}
type Fixture = Awaited<ReturnType<typeof setup>>
const healthy = { rendered: true, databaseOpened: true } as const
const states = (f: Fixture) => { const seen: UpdateState[] = []; f.service.subscribe(() => seen.push(f.service.getState())); return seen }

describe('silent (automatic) check', () => {
  it('publishes an offer like a manual check, without a "checking" state in between', async () => {
    const f = await setup(); const seen = states(f)
    expect(await f.service.check({ silent: true })).toMatchObject({ status: 'available', kind: 'web' })
    expect(seen.map((s) => s.status)).toEqual(['available'])
    expect(await f.service.download()).toMatchObject({ status: 'ready-to-restart' }) // the offer is fully usable
  })

  it('publishes a signed native offer', async () => {
    const f = await setup({ minNativeVersionCode: 11, native: { versionCode: 11, versionName: '3.2.0', apkUrl: 'https://updates.example.test/app.apk', apkSha256: 'a'.repeat(64), notes: 'Nueva.' } })
    expect(await f.service.check({ silent: true })).toMatchObject({ status: 'available', kind: 'native' })
  })

  it.each<[string, (f: Fixture) => void, number?]>([
    ['nothing new', (f) => { f.installer.manifest = null }],
    ['offline', (f) => { f.installer.fetchManifest = vi.fn(async () => { throw Error('offline') }) }],
    ['bad signature', (f) => { f.installer.manifest = { ...f.signed, signature: 'AAAA' } }],
    ['unknown key', (f) => { f.installer.manifest = { ...f.signed, keyId: 'unknown' } }],
    ['schema change', () => undefined, SCHEMA_VERSION + 1],
  ])('leaves no trace when the result is %s', async (_name, arrange, schema) => {
    const f = await setup({}, schema)
    arrange(f)
    const seen = states(f)
    expect(await f.service.check({ silent: true })).toEqual({ status: 'idle' })
    expect(seen).toEqual([])
    expect(f.service.getState()).toEqual({ status: 'idle' })
  })

  it('does not overwrite an earlier manual result on failure', async () => {
    const f = await setup(); f.installer.manifest = null
    await f.service.check()
    const before = f.service.getState()
    f.installer.fetchManifest = vi.fn(async () => { throw Error('offline') })
    await f.service.check({ silent: true })
    expect(f.service.getState()).toBe(before)
  })

  it('a failure is not persisted: the journal is unchanged and the next manual check starts clean', async () => {
    const f = await setup()
    await f.service.start()
    const journal = f.storage.getItem(OTA_STORAGE_KEY)
    f.installer.fetchManifest = vi.fn(async () => { throw Error('offline') })
    await f.service.check({ silent: true })
    expect(f.storage.getItem(OTA_STORAGE_KEY)).toBe(journal)
    f.installer.fetchManifest = vi.fn(async () => f.signed)
    expect(await f.service.check()).toMatchObject({ status: 'available' })
  })

  it('is a no-op while ready to restart or offering, and makes no network call then', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download()
    const calls = [...f.installer.calls]
    expect(await f.service.check({ silent: true })).toMatchObject({ status: 'ready-to-restart' })
    expect(f.installer.calls).toEqual(calls)
    const g = await setup(); await g.service.check()
    await g.service.check({ silent: true })
    expect(g.installer.calls.filter((c) => c === 'fetch')).toHaveLength(1)
  })

  it('does not hide the one-time notice after a restart; acknowledging returns to idle', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    const restarted = createUpdateService(f.options)
    await restarted.start(); await restarted.reportHealthy(healthy)
    expect(await restarted.check({ silent: true })).toEqual({ status: 'applied', version: '3.1.0' })
    restarted.acknowledge()
    expect(restarted.getState()).toEqual({ status: 'idle' })
  })

  it('is a no-op, with no native or network call, when OTA is off or in the browser', async () => {
    const off = await setup(); off.options.config.enabled = false
    expect(await off.service.check({ silent: true })).toEqual({ status: 'idle' })
    expect(off.installer.calls).toEqual([])
    const web = await setup(); web.options.platform = 'web'
    expect(await createUpdateService(web.options).check({ silent: true })).toEqual({ status: 'idle' })
    expect(web.installer.calls).toEqual([])
  })

  it('stays quiet while the current version has not confirmed its start (trial)', async () => {
    const f = await setup(); f.installer.active = { id: 'trial', version: '3.0.1', status: 'pending' }
    expect(await f.service.check({ silent: true })).toEqual({ status: 'idle' })
    expect(f.installer.calls).not.toContain('fetch')
  })

  it('serialises with a running manual check', async () => {
    const f = await setup()
    let resolveFetch!: (value: typeof f.signed) => void
    f.installer.fetchManifest = vi.fn(() => new Promise<typeof f.signed>((resolve) => { resolveFetch = resolve }))
    const manual = f.service.check()
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'))
    await f.service.check({ silent: true })
    expect(f.installer.fetchManifest).toHaveBeenCalledTimes(1)
    resolveFetch(f.signed); await manual
  })
})

describe('installed bundle: steady state and notes', () => {
  it('a manifest equal to the installed version means "up to date", not an incompatibility', async () => {
    const f = await setup(); await f.service.check(); await f.service.download(); await f.service.apply()
    const restarted = createUpdateService(f.options)
    await restarted.start(); await restarted.reportHealthy(healthy)
    restarted.acknowledge()
    expect(await restarted.check()).toMatchObject({ status: 'none', code: 'no-update' })
  })

  it('persists the signed notes at apply time inside the journal and shows them once the bundle runs', async () => {
    const f = await setup()
    await f.service.start()
    expect(f.service.installedNotes()).toBe('') // built-in interface: no notes
    await f.service.check(); await f.service.download(); await f.service.apply()
    expect(JSON.parse(f.storage.getItem(OTA_STORAGE_KEY)!).notes).toEqual({ version: '3.1.0', text: 'Mejoras de estabilidad.' })
    const restarted = createUpdateService(f.options)
    await restarted.start()
    expect(restarted.installedNotes()).toBe('Mejoras de estabilidad.')
    await restarted.reportHealthy(healthy)
    expect(restarted.installedNotes()).toBe('Mejoras de estabilidad.')
    const later = createUpdateService(f.options) // a plain relaunch keeps them
    await later.start()
    expect(later.installedNotes()).toBe('Mejoras de estabilidad.')
  })

  it('has no notes after a rollback, after a new APK, or when the bundle has none', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    const trial = createUpdateService(f.options); await trial.start()
    f.installer.restartWithoutHealth()
    const rolledBack = createUpdateService(f.options); await rolledBack.start()
    expect(rolledBack.getState()).toMatchObject({ status: 'rolled-back' })
    expect(rolledBack.installedNotes()).toBe('')
    expect(JSON.parse(f.storage.getItem(OTA_STORAGE_KEY)!).notes).toBeNull()

    const g = await setup()
    await g.service.check(); await g.service.download(); await g.service.apply()
    g.options.appInfo.mockResolvedValue({ build: '11', version: '3.2.0' })
    g.installer.active = { id: 'builtin', version: '3.2.0', status: 'success', builtin: true }
    const upgraded = createUpdateService({ ...g.options, builtInVersion: '3.2.0' }); await upgraded.start()
    expect(upgraded.installedNotes()).toBe('')

    const h = await setup({ notes: undefined })
    await h.service.check(); await h.service.download(); await h.service.apply()
    const quiet = createUpdateService(h.options); await quiet.start()
    expect(quiet.installedNotes()).toBe('')
  })

  it('keeps the previous notes when apply fails before scheduling', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download()
    f.installer.activateOnNextStart = async () => { throw Error('plugin') }
    await f.service.apply()
    expect(f.service.installedNotes()).toBe('')
    expect(JSON.parse(f.storage.getItem(OTA_STORAGE_KEY)!).notes).toBeNull()
  })

  it('still loads a journal written by 3.1.0 (no notes field) and ignores a malformed notes field', async () => {
    // Shape written by the 3.1.0 service: format, nativeBuild, ota, staged. Nothing else.
    const v310 = { format: 1, nativeBuild: 7, ota: { active: '3.1.0', previous: null, trial: null, blocked: ['3.0.9'] }, staged: null }
    const f = await setup()
    f.options.appInfo.mockResolvedValue({ build: '7', version: '3.1.0' })
    f.installer.active = { id: 'builtin', version: '3.1.0', status: 'success', builtin: true }
    f.storage.setItem(OTA_STORAGE_KEY, JSON.stringify(v310))
    const service = createUpdateService({ ...f.options, builtInVersion: '3.1.0' })
    await service.start()
    expect(service.otaState()).toMatchObject({ active: '3.1.0', blocked: ['3.0.9'] })
    expect(service.installedNotes()).toBe('')
    expect(JSON.parse(f.storage.getItem(OTA_STORAGE_KEY)!)).toMatchObject({ format: 1, nativeBuild: 7, notes: null })
    // An older reader only validates format/nativeBuild/ota/staged, so the extra field cannot break a rollback to 3.1.0.
    for (const bad of [{ version: '3.1.0' }, { version: 'x', text: 'a' }, { version: '3.1.0', text: 5 }, 'text', 7]) {
      f.installer.active = { id: 'downloaded', version: '3.1.0', status: 'success' }
      f.storage.setItem(OTA_STORAGE_KEY, JSON.stringify({ ...v310, notes: bad }))
      const s = createUpdateService({ ...f.options, builtInVersion: '3.0.0' })
      await s.start()
      expect(s.installedNotes()).toBe('')
    }
  })

  it('acknowledge only clears the one-time notices', async () => {
    const f = await setup()
    await f.service.check()
    f.service.acknowledge()
    expect(f.service.getState()).toMatchObject({ status: 'available' })
  })
})

describe('notes after a rollback (found on a device)', () => {
  it('a failed second bundle leaves the notes of the bundle that is running again', async () => {
    const f = await setup()
    await f.service.check(); await f.service.download(); await f.service.apply()
    const first = createUpdateService(f.options)
    await first.start(); await first.reportHealthy(healthy)
    expect(first.installedNotes()).toBe('Mejoras de estabilidad.')
    // 3.1.1 is offered, applied and never reports healthy.
    f.installer.manifest = await f.sign({ ...f.manifest, version: '3.1.1', notes: 'Solo para 3.1.1.' })
    first.acknowledge()
    await first.check(); await first.download(); await first.apply()
    const trial = createUpdateService(f.options); await trial.start()
    expect(trial.installedNotes()).toBe('Solo para 3.1.1.')
    f.installer.restartWithoutHealth()
    const rolledBack = createUpdateService(f.options); await rolledBack.start()
    expect(rolledBack.getState()).toMatchObject({ status: 'rolled-back', version: '3.1.0' })
    expect(rolledBack.installedNotes()).toBe('Mejoras de estabilidad.')
    const later = createUpdateService(f.options); await later.start()
    expect(later.installedNotes()).toBe('Mejoras de estabilidad.')
  })
})
