#!/usr/bin/env node
/**
 * Builds the web bundle of ONE channel and packages and signs it. Nothing here contacts the network, publishes, runs `cap sync` or touches android/.
 *
 *   node scripts/ota-build.mjs --channel stable|beta --out <external dir> --key-file <external private key file> --key-id <id> --notes "<text>"
 *        [--native-file <json>] [--min-native <versionCode>] [--allow-dirty] [--no-sync]
 *
 * The bundle carries its OWN OTA configuration, and that is what rules after it is applied: stable = exactly `.env.android`; beta = the same
 * keys and hosts with `VITE_OTA_CHANNEL=beta` and the `ota-beta` manifest URL. Version = package.json; `--min-native` defaults to the
 * versionCode in android/app/build.gradle. It prints the two files to upload and their SHA-256.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { channelEnv, CHANNELS, gradleVersionCode, OTA_ENV_NAMES, readAndroidEnv, trustedKeys, zipUrlFor } from './ota-config.mjs'
import { digest, release } from './ota-release.mjs'
import { assertExternalPath, REPOSITORY } from './ota-sign.mjs'

const BOOLEAN_FLAGS = ['allow-dirty', 'no-sync']
/**
 * --no-sync: a bundle for the test channel is published where anyone can download it, so it carries NO Firebase web configuration at all:
 * sync is switched off and every value that .env.local would inline is replaced (process environment wins over .env files; a non-empty
 * placeholder because Windows drops empty variables).
 */
export const NO_SYNC_ENV = { VITE_SYNC_DISABLED: '1', VITE_FIREBASE_API_KEY: 'off', VITE_FIREBASE_AUTH_DOMAIN: 'off', VITE_FIREBASE_PROJECT_ID: 'off',
  VITE_FIREBASE_APP_ID: 'off', VITE_FIREBASE_MESSAGING_SENDER_ID: 'off' }
/** Google API keys start with AIza followed by 35 URL-safe characters. */
export const hasGoogleApiKey = (text) => /AIza[0-9A-Za-z_-]{35}/.test(text)
const VALUE_FLAGS = ['channel', 'out', 'key-file', 'key-id', 'notes', 'native-file', 'min-native']

export function parseBuildArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith('--')) throw Error(`Argumento inesperado: ${flag}`)
    const name = flag.slice(2)
    if (options[name] !== undefined) throw Error(`--${name} repetido`)
    if (BOOLEAN_FLAGS.includes(name)) { options[name] = true; continue }
    if (!VALUE_FLAGS.includes(name)) throw Error(`Opción desconocida: ${flag}`)
    const value = argv[++i]
    if (value === undefined || (value.startsWith('--') && name !== 'notes')) throw Error(`--${name} necesita un valor`)
    options[name] = value
  }
  return options
}

/**
 * Validates everything that can be validated without building, and returns what to run. `ctx` is injectable so the refusals are testable:
 * { root, env (parsed .env.android), packageVersion, gradleText, dirty, hasLocalEnv }.
 */
export function planBuild(options, ctx) {
  const channel = options.channel
  if (!CHANNELS.includes(channel)) throw Error('--channel debe ser stable o beta')
  for (const name of ['out', 'key-file', 'key-id', 'notes']) if (!options[name]) throw Error(`Falta --${name}`)
  if (!/^[\w-]+$/.test(options['key-id'])) throw Error('--key-id no válido')
  const out = assertExternalPath(options.out)
  const keyFile = assertExternalPath(options['key-file'])
  const nativeFile = options['native-file'] ? resolve(options['native-file']) : undefined
  if (!/^\d+\.\d+\.\d+$/.test(ctx.packageVersion ?? '')) throw Error('package.json no tiene una versión semver')
  const keys = trustedKeys(ctx.env)
  if (!keys.some((k) => k.id === options['key-id'])) throw Error(`--key-id ${options['key-id']} no es una clave de confianza de la app (${keys.map((k) => k.id).join(', ')})`)
  const gradleCode = gradleVersionCode(ctx.gradleText)
  const minNative = options['min-native'] === undefined ? gradleCode : Number(options['min-native'])
  if (!Number.isSafeInteger(minNative) || minNative < 1) throw Error('--min-native debe ser un entero positivo')
  if (ctx.dirty && !options['allow-dirty']) throw Error('El árbol de trabajo tiene cambios sin confirmar: confirma o descarta, o usa --allow-dirty si sabes lo que haces')
  // Firebase's public web configuration lives in .env.local; a bundle built without it would turn account sync off once applied.
  if (!ctx.hasLocalEnv && !options['no-sync']) throw Error('Falta .env.local (configuración pública de Firebase): sin ella el paquete apagaría la sincronización. Construye donde esté o usa --no-sync')
  return {
    channel, out, keyFile, nativeFile, minNative, version: ctx.packageVersion, keyId: options['key-id'], notes: options.notes,
    zipUrl: zipUrlFor(ctx.env, channel, ctx.packageVersion),
    env: { ...channelEnv(ctx.env, channel), ...(options['no-sync'] ? NO_SYNC_ENV : {}) },
    noSync: options['no-sync'] === true,
    steps: [['npx', ['tsc', '-b']], ['node', ['scripts/copy-ocr-assets.mjs']], ['npx', ['vite', 'build', '--mode', 'android']]],
  }
}

/** Process environment for the build: nothing inherited may change the OTA configuration or the build mode. */
export function buildEnvironment(base, plan) {
  const env = { ...base }
  for (const name of Object.keys(env)) if (/^VITE_OTA_/.test(name) || name === 'VITE_DISTRIBUTION' || name === 'SALUD_DEV' || name === 'VITE_SYNC_DISABLED' || name === 'NODE_ENV') delete env[name]
  for (const name of OTA_ENV_NAMES) if (plan.env[name] === undefined) throw Error(`Falta ${name}`)
  return { ...env, ...plan.env }
}

/** The packaged manifest must verify with the PUBLIC key the app trusts for that id: a mismatched private key makes a bundle no install accepts. */
export async function verifySignedManifest(signedText, publicKeys) {
  const signed = JSON.parse(signedText)
  const jwk = Object.hasOwn(publicKeys, signed.keyId) ? publicKeys[signed.keyId] : undefined
  if (!jwk) throw Error(`La clave ${signed.keyId} no es de confianza`)
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const bytes = Uint8Array.from(Buffer.from(signed.signature, 'base64'))
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, new TextEncoder().encode(signed.manifest)))) {
    throw Error('La firma no verifica con la clave pública de confianza: el archivo de clave no corresponde a --key-id')
  }
}

function gitDirty(root) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw Error('No se pudo consultar git status')
  return r.stdout.trim().length > 0
}

export async function runBuild(options, root = REPOSITORY) {
  const env = readAndroidEnv(root)
  const plan = planBuild(options, {
    root, env, packageVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    gradleText: readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8'), dirty: gitDirty(root), hasLocalEnv: existsSync(resolve(root, '.env.local')),
  })
  const buildEnv = buildEnvironment(process.env, plan)
  console.log(`[ota-build] canal ${plan.channel}, versión ${plan.version}, minNative ${plan.minNative}`)
  console.log(`[ota-build] manifiesto del bundle: ${plan.env.VITE_OTA_MANIFEST_URL}`)
  for (const [cmd, args] of plan.steps) {
    console.log(`[ota-build] ${cmd} ${args.join(' ')}`)
    const r = spawnSync(cmd, args, { cwd: root, env: buildEnv, stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0) throw Error(`Falló: ${cmd} ${args.join(' ')}`)
  }
  if (plan.noSync) {
    const dist = resolve(root, 'dist')
    const leaked = readdirSync(dist, { recursive: true }).filter((f) => /\.(js|html|json|css)$/.test(String(f)) && hasGoogleApiKey(readFileSync(resolve(dist, String(f)), 'utf8')))
    if (leaked.length) throw Error(`--no-sync: el dist todavía contiene una clave de API (${leaked[0]}); no se empaqueta`)
  }
  const options2 = { dist: resolve(root, 'dist'), version: plan.version, channel: plan.channel, 'min-native': String(plan.minNative), url: plan.zipUrl,
    notes: plan.notes, 'key-id': plan.keyId, 'key-file': plan.keyFile, out: plan.out, ...(plan.nativeFile ? { 'native-file': plan.nativeFile } : {}) }
  const result = await release(options2)
  const zip = resolve(plan.out, new URL(plan.zipUrl).pathname.split('/').at(-1))
  const manifest = resolve(plan.out, 'manifest.json')
  await verifySignedManifest(readFileSync(manifest, 'utf8'), JSON.parse(env.VITE_OTA_PUBLIC_KEYS))
  console.log('\nSube a la release ota-%s, en este orden (primero el ZIP, el manifiesto al final):', plan.channel)
  for (const file of [zip, manifest]) console.log(`  ${file}\n    SHA-256 ${await digest(readFileSync(file))}  (${statSync(file).size} bytes)`)
  console.log(`\nVersión ${result.version}, ZIP firmado en el manifiesto: ${result.sha256}\nNo se ha publicado nada.`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBuild(parseBuildArgs(process.argv.slice(2))).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
