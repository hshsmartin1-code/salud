/**
 * Public OTA configuration of the Android build, read from `.env.android`, and the values derived from it for each channel.
 * Shared by ota-build.mjs, ota-release.mjs and the Dev build tooling. Nothing here reads a private key or the network.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPOSITORY } from './ota-sign.mjs'

export const CHANNELS = ['stable', 'beta']
/** Variables a build for the Android shell sets explicitly, so nothing inherited from the shell can change them. */
export const OTA_ENV_NAMES = ['VITE_OTA_ENABLED', 'VITE_OTA_PUBLIC_KEYS', 'VITE_OTA_ALLOWED_HOSTS', 'VITE_OTA_MANIFEST_URL', 'VITE_OTA_CHANNEL', 'VITE_DISTRIBUTION']

/** KEY=value lines; surrounding single or double quotes are removed; `#` lines and blank lines are ignored. */
export function parseEnvFile(text) {
  const values = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) throw Error(`Línea no válida en el archivo de entorno: ${line.slice(0, 40)}`)
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) value = value.slice(1, -1)
    values[line.slice(0, eq).trim()] = value
  }
  return values
}

export function readAndroidEnv(root = REPOSITORY) {
  return parseEnvFile(readFileSync(resolve(root, '.env.android'), 'utf8'))
}

/** `https://github.com/<owner>/<repo>/releases/download/ota-stable/manifest.json` -> { owner, repo }. */
export function ownerRepo(stableManifestUrl) {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases\/download\/ota-stable\/manifest\.json$/.exec(stableManifestUrl ?? '')
  if (!m) throw Error('VITE_OTA_MANIFEST_URL de .env.android no tiene la forma https://github.com/<dueño>/<repo>/releases/download/ota-stable/manifest.json')
  return { owner: m[1], repo: m[2] }
}

export function manifestUrlFor(env, channel) {
  if (!CHANNELS.includes(channel)) throw Error('--channel debe ser stable o beta')
  const { owner, repo } = ownerRepo(env.VITE_OTA_MANIFEST_URL)
  return `https://github.com/${owner}/${repo}/releases/download/ota-${channel}/manifest.json`
}

export function zipUrlFor(env, channel, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error('Versión no válida')
  const { owner, repo } = ownerRepo(env.VITE_OTA_MANIFEST_URL)
  if (!CHANNELS.includes(channel)) throw Error('--channel debe ser stable o beta')
  return `https://github.com/${owner}/${repo}/releases/download/ota-${channel}/salud-${version}.zip`
}

/** The exact `VITE_OTA_*` set of a build for `channel`: stable is `.env.android` verbatim, beta only changes channel and manifest URL. */
export function channelEnv(env, channel) {
  const out = {}
  for (const name of OTA_ENV_NAMES) {
    if (env[name] === undefined) throw Error(`Falta ${name} en .env.android`)
    out[name] = env[name]
  }
  out.VITE_OTA_CHANNEL = channel
  out.VITE_OTA_MANIFEST_URL = manifestUrlFor(env, channel)
  if (channel === 'stable' && (env.VITE_OTA_CHANNEL !== 'stable' || out.VITE_OTA_MANIFEST_URL !== env.VITE_OTA_MANIFEST_URL)) throw Error('.env.android debe describir el canal stable')
  return out
}

/** Trusted public keys of the build: [{ id, x }]. The private member `d` is refused outright. */
export function trustedKeys(env) {
  const keys = JSON.parse(env.VITE_OTA_PUBLIC_KEYS ?? 'null')
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.keys(keys).length) throw Error('VITE_OTA_PUBLIC_KEYS vacío o inválido')
  return Object.entries(keys).map(([id, jwk]) => {
    if ('d' in jwk) throw Error('Una clave de VITE_OTA_PUBLIC_KEYS contiene parte privada')
    return { id, x: jwk.x }
  })
}

/** Everything `ota-release` expects to find baked into the bundle of a channel. */
export function expectedBundleConfig(env, channel) {
  return { manifestUrl: manifestUrlFor(env, channel), keys: trustedKeys(env) }
}

/** `versionCode` of the normal build in android/app/build.gradle (the first one, outside the Dev override). */
export function gradleVersionCode(gradleText) {
  const m = /^\s*versionCode\s+(\d+)\s*$/m.exec(gradleText)
  if (!m) throw Error('No se pudo leer versionCode de android/app/build.gradle')
  return Number(m[1])
}

/**
 * The bundle's JavaScript must carry the manifest URL of ITS channel and every trusted key (id and public x): a bundle built without
 * the OTA configuration would switch updates off for good once applied, and a bundle for the other channel would move the install to it.
 * Returns the list of problems (empty when it is right).
 */
export function bundleConfigProblems(files, expected) {
  const js = files.filter((f) => /\.m?js$/.test(f.name)).map((f) => Buffer.from(f.bytes).toString('utf8')).join('\n')
  const problems = []
  if (!js.includes(expected.manifestUrl)) problems.push(`el JavaScript no contiene la URL del manifiesto del canal (${expected.manifestUrl})`)
  for (const { id, x } of expected.keys) {
    if (!new RegExp(`${id}\\\\?"\\s*:`).test(js) || !js.includes(x)) problems.push(`el JavaScript no contiene la clave de confianza ${id}`)
  }
  return problems
}
