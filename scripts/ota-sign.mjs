#!/usr/bin/env node
/**
 * Signs OTA manifests for Salud (ECDSA P-256 / SHA-256, WebCrypto, same algorithm the app verifies).
 *
 *   node scripts/ota-sign.mjs keygen [keyId] --out-dir ABSOLUTE_EXTERNAL_DIRECTORY
 *       Writes a private JWK OUTSIDE the repository and prints its public half for build inputs.
 *
 *   node scripts/ota-sign.mjs sign --bundle bundle.zip --version 2.2.1 --channel beta \
 *        --min-native 4 --url https://updates.example.com/salud/2.2.1.zip --key keyId --key-file ABSOLUTE_EXTERNAL_FILE --out ABSOLUTE_EXTERNAL_FILE
 *       Reads the Dexie schema version from src/db/schema.ts, hashes the zip and writes the signed
 *       manifest. Upload the zip and the manifest yourself; this script never uploads anything.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ALG = { name: 'ECDSA', namedCurve: 'P-256' }
export const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (root, target) => { const rel = relative(root, target); return !rel || (!(rel === '..' || rel.startsWith(`..${sep}`)) && !isAbsolute(rel)) }
function physicalPath(path) {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  if (parent === path) throw Error('No se pudo resolver la ruta')
  return resolve(physicalPath(parent), relative(parent, path))
}
/** Check lexical and physical paths so junctions/symlinks cannot hide an in-repo key or output. */
export function assertExternalPath(path) {
  if (!path || !isAbsolute(path)) throw Error('La ruta debe ser absoluta y estar FUERA del repositorio')
  const resolved = resolve(path)
  if (inside(REPOSITORY, resolved) || inside(realpathSync(REPOSITORY), physicalPath(resolved))) throw Error('La clave y la salida deben estar FUERA del repositorio')
  return resolved
}

export async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])
  return { privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey), publicJwk: await crypto.subtle.exportKey('jwk', kp.publicKey) }
}

export async function signManifest(manifest, privateJwk, keyId) {
  const text = JSON.stringify(manifest)
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(text)))
  return { manifest: text, signature: Buffer.from(sig).toString('base64'), keyId }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'keygen') {
    const keyId = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
    if (!/^[a-zA-Z0-9_-]+$/.test(keyId)) throw Error('keyId inválido')
    const directory = assertExternalPath(arg('out-dir'))
    const { privateJwk, publicJwk } = await generateKeyPair()
    mkdirSync(directory, { recursive: true })
    const keyFile = resolve(directory, `${keyId}.private.jwk`)
    writeFileSync(keyFile, JSON.stringify(privateJwk), { mode: 0o600, flag: 'wx' })
    const pub = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }
    console.log(`Private key: ${keyFile} (keep it offline; never commit it)`)
    console.log(`VITE_OTA_PUBLIC_KEYS=${JSON.stringify({ [keyId]: pub })}`)
    return
  }
  if (cmd === 'sign') {
    const bundle = arg('bundle')
    const version = arg('version')
    const channel = arg('channel', 'beta')
    const url = arg('url')
    const minNative = Number(arg('min-native'))
    const keyId = arg('key')
    if (!bundle || !version || !url || !Number.isInteger(minNative) || !keyId) throw new Error('Faltan --bundle, --version, --url, --min-native o --key')
    const schema = Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(readFileSync('src/db/schema.ts', 'utf8'))?.[1])
    const bytes = readFileSync(bundle)
    const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
    const manifest = { format: 'salud-ota-1', version, channel, url, sha256, size: bytes.byteLength, minNativeVersionCode: minNative, schemaVersion: schema, createdAt: new Date().toISOString() }
    const privateJwk = JSON.parse(readFileSync(assertExternalPath(arg('key-file')), 'utf8'))
    const signed = await signManifest(manifest, privateJwk, keyId)
    const out = assertExternalPath(arg('out'))
    writeFileSync(out, JSON.stringify(signed, null, 2))
    console.log(`Manifest written to ${out} (schema ${schema}, ${bytes.byteLength} bytes)`)
    return
  }
  console.log('Uso: node scripts/ota-sign.mjs keygen [keyId] | sign --bundle … --version … --channel … --min-native … --url … --key …')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
