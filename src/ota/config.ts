import type { OtaChannel } from './manifest'

export interface OtaConfig {
  enabled: boolean
  publicKeys: Record<string, JsonWebKey>
  allowedHosts: string[]
  manifestUrl: string
  channel: OtaChannel
  distribution: 'sideload' | 'play'
  devHttp: boolean
  configurationError?: string
}

/** Build input only. No localStorage flag, remote configuration or UI switch. */
export function readOtaConfig(env: Record<string, unknown>): OtaConfig {
  const off: OtaConfig = { enabled: false, publicKeys: {}, allowedHosts: [], manifestUrl: '', channel: 'stable', distribution: env.VITE_DISTRIBUTION === 'play' ? 'play' : 'sideload', devHttp: false }
  if (env.VITE_OTA_ENABLED !== '1') return off
  try {
    const keys: unknown = JSON.parse(String(env.VITE_OTA_PUBLIC_KEYS ?? ''))
    const hosts: unknown = JSON.parse(String(env.VITE_OTA_ALLOWED_HOSTS ?? ''))
    if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.keys(keys).length) throw Error('Faltan claves públicas')
    for (const key of Object.values(keys) as JsonWebKey[]) {
      if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || !/^[\w-]{43}$/.test(key.x ?? '') || !/^[\w-]{43}$/.test(key.y ?? '') || 'd' in key || (key.key_ops && !key.key_ops.includes('verify'))) throw Error('Clave pública P-256 inválida')
    }
    if (!Array.isArray(hosts) || !hosts.length || !hosts.every((h: unknown) => typeof h === 'string' && !!h && new URL(`https://${h}`).host === h && !/[\s/@*?#\\]/.test(h))) throw Error('Lista de hosts inválida')
    const channel = env.VITE_OTA_CHANNEL ?? 'stable'
    if (channel !== 'stable' && channel !== 'beta') throw Error('Canal inválido')
    if (env.VITE_DISTRIBUTION !== undefined && env.VITE_DISTRIBUTION !== 'play' && env.VITE_DISTRIBUTION !== 'sideload') throw Error('Distribución inválida')
    const devHttp = env.DEV === true && env.VITE_OTA_DEV_HTTP === '1'
    const url = new URL(String(env.VITE_OTA_MANIFEST_URL ?? ''))
    const local = devHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !!url.port
    if ((!local && url.protocol !== 'https:') || !hosts.includes(url.host) || url.username || url.password || url.hash) throw Error('URL del manifiesto no permitida')
    return { enabled: true, publicKeys: keys as Record<string, JsonWebKey>, allowedHosts: hosts, manifestUrl: url.href, channel, distribution: off.distribution, devHttp }
  } catch (error) {
    return { ...off, configurationError: error instanceof Error ? error.message : 'Configuración OTA inválida' }
  }
}

export const OTA_BUILD = readOtaConfig(import.meta.env)
for (const key of Object.values(OTA_BUILD.publicKeys)) Object.freeze(key)
Object.freeze(OTA_BUILD.publicKeys)
Object.freeze(OTA_BUILD.allowedHosts)
Object.freeze(OTA_BUILD)
export const OTA_ENABLED = OTA_BUILD.enabled
