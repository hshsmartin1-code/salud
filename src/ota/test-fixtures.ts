import { SCHEMA_VERSION } from '../db/schema'
import { OTA_FORMAT_V2, sha256Hex, verifyBundle, type OtaManifest, type SignedManifest } from './manifest'
import type { OtaConfig } from './config'
import type { InstalledBundle, NativeBundleInstaller } from './updater'

const signing = await import('../../scripts/ota-sign.mjs' as string) as {
  generateKeyPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }>
  signManifest(m: unknown, privateJwk: JsonWebKey, keyId: string): Promise<SignedManifest>
}
export const TEST_HOST = 'updates.example.test'
export const TEST_BYTES = new TextEncoder().encode('bundle fixture; no personal data')
export async function signedFixture(overrides: Partial<OtaManifest> = {}) {
  const pair = await signing.generateKeyPair() // Ephemeral memory only; never write a private key.
  const manifest: OtaManifest = { format: OTA_FORMAT_V2, version: '3.1.0', channel: 'beta', url: `https://${TEST_HOST}/bundle.zip`, sha256: await sha256Hex(TEST_BYTES),
    size: TEST_BYTES.length, minNativeVersionCode: 10, schemaVersion: SCHEMA_VERSION, createdAt: '2026-11-16T00:00:00Z', notes: 'Mejoras de estabilidad.', ...overrides }
  const sign = (value: unknown) => signing.signManifest(value, pair.privateJwk, 'test')
  const signed = await sign(manifest)
  const config: OtaConfig = { enabled: true, publicKeys: { test: pair.publicJwk }, allowedHosts: [TEST_HOST], manifestUrl: `https://${TEST_HOST}/manifest.json`, channel: 'beta', distribution: 'sideload', devHttp: false }
  return { manifest, signed, sign, config }
}

export class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

/** Contract fake: native checksum before staging, next separate from reload, unconfirmed boot rollback. */
export class FakeInstaller implements NativeBundleInstaller {
  manifest: SignedManifest | null
  bytes = TEST_BYTES
  active: InstalledBundle = { id: 'builtin', version: '3.0.0', status: 'success', builtin: true }
  previous = this.active
  next: InstalledBundle | null = null
  downloaded: InstalledBundle[] = []
  failed: string[] = []
  calls: string[] = []
  failure: Error | null = null
  constructor(signed: SignedManifest | null) { this.manifest = signed }
  async nativeVersionCode() { return 10 }
  async fetchManifest() { this.calls.push('fetch'); return this.manifest }
  async downloadVerified(m: OtaManifest, progress: (percent: number) => void) {
    this.calls.push('download')
    progress(0); progress(45)
    if (this.failure) throw this.failure
    await verifyBundle(this.bytes, m)
    const b: InstalledBundle = { id: 'downloaded', version: m.version, status: 'pending', checksum: m.sha256 }
    this.downloaded = [b]
    progress(100)
    return b
  }
  async activateOnNextStart(version: string) {
    this.calls.push('next')
    const bundle = this.downloaded.find((b) => b.version === version)
    if (!bundle) throw Error('Missing bundle')
    this.next = bundle
  }
  async apply() {
    this.calls.push('apply')
    if (!this.next) throw Error('Missing next')
    this.previous = this.active; this.active = this.next; this.next = null
  }
  async revertToPrevious() { this.active = this.previous }
  async reportHealthy() { this.calls.push('healthy'); this.active = { ...this.active, status: 'success' } }
  async boot() { this.calls.push('boot'); return structuredClone({ active: this.active, next: this.next, failed: this.failed, downloaded: this.downloaded }) }
  restartWithoutHealth() {
    if (this.active.status === 'pending') {
      this.failed.push(this.active.version)
      this.downloaded = this.downloaded.map((b) => b.version === this.active.version ? { ...b, status: 'error' } : b)
      this.active = this.previous
    }
  }
}
