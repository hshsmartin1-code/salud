/**
 * Over-the-air (OTA) web-bundle updates: verification core.
 *
 * V3.1 supplies a manual native installer behind this verification layer. The committed build
 * defaults remain disabled with no trusted key, host or manifest URL. Only explicit build inputs
 * can enable update traffic. See the project notes for integration and remaining native limits.
 *
 * Trust model: a manifest is accepted only if it is signed (ECDSA P-256 / SHA-256) by a key whose
 * PUBLIC half ships inside the installed app. The bundle must match the manifest's SHA-256 and size.
 * A bundle may never change the data schema: Dexie migrations ship only in native (Play) updates, so
 * an OTA bundle must declare exactly the schema version the installed app already uses.
 */

export const OTA_FORMAT = 'salud-ota-1'
export { OTA_ENABLED } from './config'
export const OTA_FORMAT_V2 = 'salud-ota-2'
export const MAX_RELEASE_NOTES = 2000

export type OtaChannel = 'stable' | 'beta'

export interface OtaManifest {
  format: typeof OTA_FORMAT | typeof OTA_FORMAT_V2
  /** Web bundle version (semver). */
  version: string
  channel: OtaChannel
  /** HTTPS URL of the zipped bundle. */
  url: string
  /** Lower-case hex SHA-256 of the zip. */
  sha256: string
  size: number
  /** Lowest native versionCode that can run this bundle (plugins, permissions, Kotlin). */
  minNativeVersionCode: number
  /** Dexie schema version the bundle expects; must equal the installed one. */
  schemaVersion: number
  createdAt: string
  notes?: string
  native?: NativeRelease
}

export interface NativeRelease {
  versionCode: number
  versionName: string
  apkUrl: string
  apkSha256: string
  notes: string
  mandatory?: boolean
}

export interface SignedManifest {
  /** Exact JSON text that was signed. */
  manifest: string
  /** Base64 IEEE-P1363 (r||s) ECDSA P-256 signature over the UTF-8 bytes of `manifest`. */
  signature: string
  keyId: string
}

export type OtaErrorCode = 'disabled' | 'format' | 'signature' | 'unknown-key' | 'channel' | 'downgrade' | 'native' | 'schema' | 'host' | 'integrity' | 'blocked' | 'network' | 'download' | 'installer' | 'storage' | 'busy' | 'trial-in-progress'

export class OtaError extends Error {
  readonly code: OtaErrorCode
  constructor(code: OtaErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'OtaError'
  }
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
export const isBundleVersion = (v: unknown): v is string => typeof v === 'string' && SEMVER.test(v) && v.split('.').every((n) => Number.isSafeInteger(Number(n)))
const positiveInteger = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const notesValid = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_RELEASE_NOTES && !/[<>]/.test(v) && [...v].every((c) => {
  const code = c.charCodeAt(0)
  return code !== 127 && (code >= 32 || [9, 10, 13].includes(code))
})

export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) throw new OtaError('format', 'Versión no válida')
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d) return Math.sign(d)
  }
  return 0
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function parseManifest(text: string): OtaManifest {
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    throw new OtaError('format', 'El manifiesto no es JSON')
  }
  const o = m as Record<string, unknown>
  const ok =
    !!o &&
    (o.format === OTA_FORMAT || o.format === OTA_FORMAT_V2) &&
    isBundleVersion(o.version) &&
    (o.channel === 'stable' || o.channel === 'beta') &&
    typeof o.url === 'string' &&
    typeof o.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(o.sha256) &&
    positiveInteger(o.size) &&
    positiveInteger(o.minNativeVersionCode) &&
    positiveInteger(o.schemaVersion) &&
    typeof o.createdAt === 'string' && Number.isFinite(Date.parse(o.createdAt)) &&
    (o.notes === undefined || notesValid(o.notes)) &&
    (o.native === undefined || validNative(o.native))
  if (!ok) throw new OtaError('format', 'Manifiesto con campos inválidos')
  return o as unknown as OtaManifest
}

function validNative(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const n = value as Record<string, unknown>
  return positiveInteger(n.versionCode) && typeof n.versionName === 'string' && n.versionName.length > 0 && n.versionName.length <= 100 &&
    typeof n.apkUrl === 'string' && typeof n.apkSha256 === 'string' && /^[0-9a-f]{64}$/.test(n.apkSha256) &&
    notesValid(n.notes) && (n.mandatory === undefined || typeof n.mandatory === 'boolean')
}

/** Verifies the signature with the public keys bundled in the app, then parses the manifest. */
export async function verifyManifest(signed: SignedManifest, publicKeys: Record<string, JsonWebKey>): Promise<OtaManifest> {
  if (!signed || typeof signed.manifest !== 'string' || signed.manifest.length > 32768 || typeof signed.signature !== 'string' || typeof signed.keyId !== 'string') throw new OtaError('format', 'Sobre firmado inválido')
  if (!Object.hasOwn(publicKeys, signed.keyId)) throw new OtaError('unknown-key', 'Clave de firma desconocida')
  const jwk = publicKeys[signed.keyId]
  if (!jwk) throw new OtaError('unknown-key', 'Clave de firma desconocida')
  let valid = false
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64ToBytes(signed.signature), new TextEncoder().encode(signed.manifest))
  } catch {
    valid = false
  }
  if (!valid) throw new OtaError('signature', 'Firma inválida')
  return parseManifest(signed.manifest)
}

export interface OtaEnvironment {
  channel: OtaChannel
  currentVersion: string
  nativeVersionCode: number
  schemaVersion: number
  allowedHosts: string[]
  blocked: string[]
  devHttp?: boolean
}

/** Exact hosts (including port), no credentials, wildcards or protocol downgrade. */
export function assertAllowedUrl(value: string, policy: Pick<OtaEnvironment, 'allowedHosts' | 'devHttp'>): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new OtaError('host', 'URL inválida') }
  const loopback = policy.devHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !!url.port
  if (url.username || url.password || url.hash || (!loopback && url.protocol !== 'https:') || !policy.allowedHosts.includes(url.host)) throw new OtaError('host', 'Origen no permitido')
  return url
}

/** Every reason a verified manifest must still be refused on this install. */
export function checkCompatibility(m: OtaManifest, env: OtaEnvironment, allowCurrentVersion = false): void {
  if (m.channel !== env.channel) throw new OtaError('channel', `Canal ${m.channel}, esta app usa ${env.channel}`)
  if (env.blocked.includes(m.version)) throw new OtaError('blocked', 'Esta versión falló antes y se revirtió')
  const versionOrder = compareVersions(m.version, env.currentVersion)
  if (versionOrder < 0 || (versionOrder === 0 && !allowCurrentVersion)) throw new OtaError('downgrade', 'No es más nueva que la instalada')
  assertAllowedUrl(m.url, env)
  if (m.native) assertAllowedUrl(m.native.apkUrl, env)
  if (m.minNativeVersionCode > env.nativeVersionCode) throw new OtaError('native', 'Requiere una actualización de la app desde la tienda')
  if (m.schemaVersion !== env.schemaVersion) throw new OtaError('schema', 'Cambia la base de datos: solo puede llegar como actualización nativa')
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyBundle(bytes: Uint8Array<ArrayBuffer>, m: OtaManifest): Promise<void> {
  if (bytes.byteLength !== m.size) throw new OtaError('integrity', 'Tamaño distinto al del manifiesto')
  if ((await sha256Hex(bytes)) !== m.sha256) throw new OtaError('integrity', 'El contenido no coincide con la firma')
}
