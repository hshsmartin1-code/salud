import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../../db/schema'
import type { OtaManifest } from '../../ota/manifest'
import { FakeInstaller, MemoryStorage, signedFixture } from '../../ota/test-fixtures'
import { createUpdateService } from './service'

async function check(overrides: Partial<OtaManifest>) {
  const f = await signedFixture({ version: '3.0.0', ...overrides })
  const installer = new FakeInstaller(f.signed)
  const service = createUpdateService({ config: f.config, installer, storage: new MemoryStorage(), builtInVersion: '3.0.0',
    schemaVersion: SCHEMA_VERSION, platform: 'native', appInfo: async () => ({ build: '10', version: '3.0.0' }) })
  return { state: await service.check(), installer }
}

describe('an installed-version match only skips the version comparison', () => {
  it.each<[Partial<OtaManifest>, string]>([
    [{ schemaVersion: SCHEMA_VERSION + 1 }, 'schema'],
    [{ url: 'https://foreign.invalid/bundle.zip' }, 'host'],
    [{ minNativeVersionCode: 11 }, 'native'],
  ])('still rejects incompatible metadata %j', async (overrides, code) => {
    const f = await check(overrides)
    expect(f.state).toMatchObject({ code })
    expect(f.installer.calls).not.toContain('download')
  })

  it('still offers a required native update when its web version is already installed', async () => {
    const f = await check({ minNativeVersionCode: 11, native: {
      versionCode: 11, versionName: '3.1.0', apkUrl: 'https://updates.example.test/app.apk', apkSha256: 'a'.repeat(64), notes: 'Nueva app.',
    } })
    expect(f.state).toMatchObject({ status: 'available', kind: 'native', native: { versionCode: 11 } })
    expect(f.installer.calls).not.toContain('download')
  })
})
