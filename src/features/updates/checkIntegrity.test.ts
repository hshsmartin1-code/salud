import { describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from '../../db/schema'
import { initialOtaState } from '../../ota/updater'
import { FakeInstaller, MemoryStorage, signedFixture } from '../../ota/test-fixtures'
import { AUTO_CHECK_KEY, createAutoChecker } from './autoCheck'
import { createUpdateService, OTA_STORAGE_KEY } from './service'

async function setup(version = '3.0.0', channel: 'stable' | 'beta' = 'beta', blocked: string[] = []) {
  const fixture = await signedFixture({ version, channel })
  const installer = new FakeInstaller(fixture.signed)
  const storage = new MemoryStorage()
  storage.setItem(OTA_STORAGE_KEY, JSON.stringify({ format: 1, nativeBuild: 10, ota: { ...initialOtaState('3.0.0'), blocked }, staged: null }))
  const service = createUpdateService({ config: fixture.config, installer, storage, builtInVersion: '3.0.0',
    schemaVersion: SCHEMA_VERSION, platform: 'native', appInfo: async () => ({ build: '10', version: '3.0.0' }) })
  await service.start()
  return { service, installer, storage }
}

describe('automatic and manual check integrity', () => {
  it.each([
    ['3.0.0', 'stable', [], 'channel'],
    ['3.0.0', 'beta', ['3.0.0'], 'blocked'],
    ['2.9.9', 'beta', [], 'downgrade'],
  ] as const)('does not let installed-version handling bypass %s / %s / %j', async (version, channel, blocked, code) => {
    const f = await setup(version, channel, [...blocked])
    expect(await f.service.check()).toMatchObject({ status: 'incompatible', code })
    expect(f.installer.calls).not.toContain('download')
  })

  it('the six-hour automatic stamp never blocks an immediate manual check', async () => {
    const f = await setup()
    const checker = createAutoChecker({ service: f.service, storage: f.storage, now: () => 1_800_000_000_000, online: () => true })
    await checker.run()
    expect(f.storage.getItem(AUTO_CHECK_KEY)).toBeTruthy()
    await f.service.check()
    expect(f.installer.calls.filter((c) => c === 'fetch')).toHaveLength(2)
  })

  it('a silent check cannot run while apply is in flight, and acknowledge preserves an actual error', async () => {
    const f = await setup('3.1.0')
    await f.service.check()
    await f.service.download()
    let finish!: () => void
    f.installer.apply = () => new Promise((resolve) => { finish = resolve })
    const apply = f.service.apply()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const state = f.service.getState()
    const journal = f.storage.getItem(OTA_STORAGE_KEY)
    const calls = [...f.installer.calls]
    await f.service.check({ silent: true })
    expect(f.service.getState()).toBe(state)
    expect(f.storage.getItem(OTA_STORAGE_KEY)).toBe(journal)
    expect(f.installer.calls).toEqual(calls)
    finish()
    await apply

    const g = await setup()
    g.installer.fetchManifest = async () => { throw Error('offline') }
    await g.service.check()
    const error = g.service.getState()
    expect(error).toMatchObject({ status: 'error', code: 'network' })
    g.service.acknowledge()
    expect(g.service.getState()).toBe(error)
  })
})
