import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../db/schema'
import { OTA_ALLOWED_HOSTS, OTA_PUBLIC_KEYS } from './keys'
import { checkCompatibility, compareVersions, OTA_ENABLED, OTA_FORMAT, OtaError, sha256Hex, verifyBundle, verifyManifest, type OtaManifest, type SignedManifest } from './manifest'
import { checkForUpdate, initialOtaState, otaReducer, type BundleInstaller, type OtaState } from './updater'

interface SignScript {
  generateKeyPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }>
  signManifest(m: unknown, privateJwk: JsonWebKey, keyId: string): Promise<SignedManifest>
}
// The real signing script (WebCrypto in Node), so the CLI and the app stay compatible.
const script = (await import('../../scripts/ota-sign.mjs' as string)) as SignScript

const bundle = new TextEncoder().encode('fake bundle bytes for tests')
const HOST = 'updates.example.test'

async function fixture(over: Partial<OtaManifest> = {}) {
  const keys = await script.generateKeyPair()
  const m: OtaManifest = {
    format: OTA_FORMAT,
    version: '2.2.1',
    channel: 'beta',
    url: `https://${HOST}/salud/2.2.1.zip`,
    sha256: await sha256Hex(bundle),
    size: bundle.byteLength,
    minNativeVersionCode: 4,
    schemaVersion: SCHEMA_VERSION,
    createdAt: '2026-11-15T00:00:00Z',
    ...over,
  }
  const signed = await script.signManifest(m, keys.privateJwk, 'k1')
  return { keys: { k1: keys.publicJwk }, signed, m }
}
const env = { channel: 'beta' as const, currentVersion: '2.2.0', nativeVersionCode: 4, schemaVersion: SCHEMA_VERSION, allowedHosts: [HOST], blocked: [] as string[] }

describe('safe defaults', () => {
  it('ships disabled, with no trusted key and no allowed host', () => {
    expect(OTA_ENABLED).toBe(false)
    expect(Object.keys(OTA_PUBLIC_KEYS)).toHaveLength(0)
    expect(OTA_ALLOWED_HOSTS).toHaveLength(0)
  })
})

describe('manifest signature', () => {
  it('accepts a manifest signed by a bundled key', async () => {
    const { keys, signed } = await fixture()
    expect((await verifyManifest(signed, keys)).version).toBe('2.2.1')
  })

  it('rejects tampering, foreign keys and unknown key ids', async () => {
    const { keys, signed } = await fixture()
    const tampered = { ...signed, manifest: signed.manifest.replace('2.2.1.zip', 'evil.zip') }
    await expect(verifyManifest(tampered, keys)).rejects.toMatchObject({ code: 'signature' })
    const other = await fixture()
    await expect(verifyManifest(signed, other.keys)).rejects.toMatchObject({ code: 'signature' })
    await expect(verifyManifest({ ...signed, keyId: 'nope' }, keys)).rejects.toMatchObject({ code: 'unknown-key' })
    await expect(verifyManifest({ ...signed, signature: 'AAAA' }, keys)).rejects.toMatchObject({ code: 'signature' })
  })

  it('rejects malformed manifests even when signed', async () => {
    const { keys, signed } = await fixture({ sha256: 'xyz' })
    await expect(verifyManifest(signed, keys)).rejects.toMatchObject({ code: 'format' })
  })
})

describe('compatibility', () => {
  const code = (fn: () => void) => {
    try {
      fn()
      return null
    } catch (e) {
      return (e as OtaError).code
    }
  }
  it('refuses everything that could break the installed app or its data', async () => {
    const { m } = await fixture()
    expect(code(() => checkCompatibility(m, env))).toBeNull()
    expect(code(() => checkCompatibility(m, { ...env, channel: 'stable' }))).toBe('channel')
    expect(code(() => checkCompatibility(m, { ...env, currentVersion: '2.2.1' }))).toBe('downgrade')
    expect(code(() => checkCompatibility(m, { ...env, currentVersion: '2.10.0' }))).toBe('downgrade')
    expect(code(() => checkCompatibility(m, { ...env, nativeVersionCode: 3 }))).toBe('native')
    expect(code(() => checkCompatibility({ ...m, schemaVersion: SCHEMA_VERSION + 1 }, env))).toBe('schema')
    expect(code(() => checkCompatibility({ ...m, url: 'http://updates.example.test/x.zip' }, env))).toBe('host')
    expect(code(() => checkCompatibility({ ...m, url: 'https://evil.example.test/x.zip' }, env))).toBe('host')
    expect(code(() => checkCompatibility(m, { ...env, blocked: ['2.2.1'] }))).toBe('blocked')
  })

  it('compares versions numerically', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1)
    expect(compareVersions('2.2.0', '2.2.0')).toBe(0)
    expect(() => compareVersions('2.2', '2.2.0')).toThrow(OtaError)
  })

  it('checks bundle integrity', async () => {
    const { m } = await fixture()
    await expect(verifyBundle(bundle, m)).resolves.toBeUndefined()
    const bad = new Uint8Array(bundle)
    bad[0] = bad[0]! ^ 1
    await expect(verifyBundle(bad, m)).rejects.toMatchObject({ code: 'integrity' })
    await expect(verifyBundle(bundle.slice(1), m)).rejects.toMatchObject({ code: 'integrity' })
  })
})

describe('trial install and automatic rollback', () => {
  it('commits a bundle that reports ready', () => {
    let s = initialOtaState('2.2.0')
    s = otaReducer(s, { type: 'installed', version: '2.2.1' })
    s = otaReducer(s, { type: 'boot' })
    s = otaReducer(s, { type: 'ready' })
    expect(s).toEqual({ active: '2.2.1', previous: '2.2.0', trial: null, blocked: [] })
  })

  it('rolls back and blocks a bundle that never becomes ready', () => {
    let s: OtaState = otaReducer(initialOtaState('2.2.0'), { type: 'installed', version: '2.2.1' })
    s = otaReducer(s, { type: 'boot' }) // crashed before ready
    s = otaReducer(s, { type: 'boot' })
    expect(s.active).toBe('2.2.0')
    expect(s.blocked).toEqual(['2.2.1'])
    expect(otaReducer(s, { type: 'installed', version: '2.2.1' })).toBe(s)
  })

  function installer(signed: SignedManifest | null, bytes = bundle, native = 4) {
    const log: string[] = []
    const inst: BundleInstaller = {
      nativeVersionCode: async () => native,
      fetchManifest: async () => signed,
      download: async () => bytes,
      stage: async (v) => void log.push(`stage ${v}`),
      activateOnNextStart: async (v) => void log.push(`activate ${v}`),
      revertToPrevious: async () => void log.push('revert'),
    }
    return { inst, log }
  }
  const e2 = { channel: 'beta' as const, schemaVersion: SCHEMA_VERSION, allowedHosts: [HOST] }

  it('stages only after every check passes', async () => {
    const { keys, signed } = await fixture()
    const ok = installer(signed)
    expect((await checkForUpdate(ok.inst, initialOtaState('2.2.0'), e2, keys, true)).installed?.version).toBe('2.2.1')
    expect(ok.log).toEqual(['stage 2.2.1', 'activate 2.2.1'])

    const corrupt = installer(signed, new TextEncoder().encode('tampered bundle bytes!!!!!!'))
    expect((await checkForUpdate(corrupt.inst, initialOtaState('2.2.0'), e2, keys, true)).reason).toBe('integrity')
    expect(corrupt.log).toEqual([])

    const oldNative = installer(signed, bundle, 3)
    expect((await checkForUpdate(oldNative.inst, initialOtaState('2.2.0'), e2, keys, true)).reason).toBe('native')
    expect(oldNative.log).toEqual([])
  })

  it('does nothing while disabled', async () => {
    const { keys, signed } = await fixture()
    const i = installer(signed)
    expect((await checkForUpdate(i.inst, initialOtaState('2.2.0'), e2, keys)).reason).toBe('disabled')
    expect(i.log).toEqual([])
  })
})
