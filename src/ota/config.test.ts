import { describe, expect, it } from 'vitest'
import { readOtaConfig } from './config'
import { assertAllowedUrl, checkCompatibility, verifyManifest } from './manifest'
import { signedFixture, TEST_HOST } from './test-fixtures'

async function envFixture() {
  const f = await signedFixture()
  return { ...f, env: { VITE_OTA_ENABLED: '1', VITE_OTA_PUBLIC_KEYS: JSON.stringify(f.config.publicKeys), VITE_OTA_ALLOWED_HOSTS: JSON.stringify([TEST_HOST]), VITE_OTA_MANIFEST_URL: f.config.manifestUrl } }
}
describe('OTA build flags', () => {
  it('enables only a complete valid build configuration', async () => {
    const f = await envFixture()
    expect(readOtaConfig(f.env)).toMatchObject({ enabled: true, devHttp: false, distribution: 'sideload' })
    for (const field of Object.keys(f.env)) {
      const env: Record<string, unknown> = { ...f.env }; delete env[field]
      expect(readOtaConfig(env).enabled).toBe(false)
    }
    expect(readOtaConfig({ ...f.env, VITE_DISTRIBUTION: 'play' }).distribution).toBe('play')
  })
  it.each(['*', '*.example.test', 'https://updates.example.test', 'user@host', 'host/path'])('rejects a non-exact host %s', async (host) => {
    const f = await envFixture()
    expect(readOtaConfig({ ...f.env, VITE_OTA_ALLOWED_HOSTS: JSON.stringify([host]) }).enabled).toBe(false)
  })
  it('rejects malformed config and private-key material', async () => {
    const f = await envFixture()
    expect(readOtaConfig({ ...f.env, VITE_OTA_PUBLIC_KEYS: '{oops' }).enabled).toBe(false)
    expect(readOtaConfig({ ...f.env, VITE_OTA_PUBLIC_KEYS: JSON.stringify({ key: { ...f.config.publicKeys.test, d: 'private' } }) }).enabled).toBe(false)
    expect(readOtaConfig({ ...f.env, VITE_DISTRIBUTION: 'invalid' }).enabled).toBe(false)
  })
  it.each(['localhost:8080', '127.0.0.1:8080'])('permits loopback HTTP only in an explicit DEV build (%s)', async (host) => {
    const f = await envFixture()
    const env = { ...f.env, VITE_OTA_ALLOWED_HOSTS: JSON.stringify([host]), VITE_OTA_MANIFEST_URL: `http://${host}/manifest.json`, VITE_OTA_DEV_HTTP: '1' }
    expect(readOtaConfig({ ...env, DEV: false }).enabled).toBe(false)
    expect(readOtaConfig({ ...env, DEV: true, VITE_OTA_DEV_HTTP: '0' }).enabled).toBe(false)
    const dev = readOtaConfig({ ...env, DEV: true })
    expect(dev).toMatchObject({ enabled: true, devHttp: true })
    expect(() => assertAllowedUrl(`http://${host}/bundle.zip`, dev)).not.toThrow()
    expect(() => assertAllowedUrl(`http://${host}/bundle.zip`, { ...dev, devHttp: false })).toThrow()
    const signed = await f.sign({ ...f.manifest, url: `http://${host}/bundle.zip` })
    const m = await verifyManifest(signed, dev.publicKeys)
    expect(() => checkCompatibility(m, { ...dev, channel: 'beta', currentVersion: '3.0.0', nativeVersionCode: 10, schemaVersion: m.schemaVersion, blocked: [] })).not.toThrow()
  })
  it.each(['http://192.168.1.1:8080/x', 'http://localhost/x', 'http://127.0.0.2:8080/x', 'https://user:pass@updates.example.test/x'])('rejects non-loopback escape or credentials: %s', (url) => {
    expect(() => assertAllowedUrl(url, { allowedHosts: [new URL(url).host], devHttp: true })).toThrow()
  })
})
