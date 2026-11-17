import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../../db/schema'
import { FakeInstaller, MemoryStorage, signedFixture } from '../../ota/test-fixtures'
import { createUpdateService } from './service'

describe('notes belong to the running interface', () => {
  it('does not show the queued version notes while reload has not replaced the old context', async () => {
    const fixture = await signedFixture({ notes: 'Novedades del paquete nuevo.' })
    const installer = new FakeInstaller(fixture.signed)
    installer.apply = async () => { throw Error('reload failed after next was queued') }
    const service = createUpdateService({ config: fixture.config, installer, storage: new MemoryStorage(),
      appInfo: async () => ({ build: '10', version: '3.0.0' }), builtInVersion: '3.0.0', schemaVersion: SCHEMA_VERSION, platform: 'native' })
    await service.check()
    await service.download()
    await service.apply()
    expect(installer.active.version).toBe('3.0.0')
    expect(service.getState()).toMatchObject({ status: 'error', code: 'installer' })
    expect(service.installedNotes()).toBe('')
    expect((await service.currentVersion()).webVersion).toBe('3.0.0')
  })
})
