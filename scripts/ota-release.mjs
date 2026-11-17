#!/usr/bin/env node
/** Offline release packaging only. No install, build, upload, private-key generation or publication. */
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { bundleConfigProblems, expectedBundleConfig, readAndroidEnv } from './ota-config.mjs'
import { assertExternalPath, REPOSITORY, signManifest } from './ota-sign.mjs'

export function args(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--') || result[argv[i].slice(2)] !== undefined) throw Error('Argumentos inválidos: usa --nombre valor')
    result[argv[i].slice(2)] = argv[i + 1]
  }
  return result
}
export const privateMedia = (path) => /(^|\/)private-media(\/|$)|\.private\.json$/i.test(path.replaceAll('\\', '/'))
const validNotes = (value) => typeof value === 'string' && value.length <= 2000 && !/[<>]/.test(value) && [...value].every((c) => {
  const code = c.charCodeAt(0)
  return code !== 127 && (code >= 32 || [9, 10, 13].includes(code))
})
export async function digest(bytes) { return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex') }
export function httpsUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Se requiere una URL HTTPS sin credenciales ni fragmento')
  return url.href
}
function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Standard ZIP, deflate, UTF-8 filenames, fixed DOS date, index.html at zip root. No shell/dependency. */
export function makeZip(files) {
  const local = [], central = []
  let offset = 0
  if (files.length > 65535) throw Error('ZIP64 no soportado')
  for (const { name, bytes } of files) {
    if (privateMedia(name) || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) throw Error(`Ruta de bundle rechazada: ${name}`)
    const filename = Buffer.from(name)
    const compressed = deflateRawSync(bytes)
    if (filename.length > 65535 || bytes.length > 0xffffffff || compressed.length > 0xffffffff || offset > 0xffffffff) throw Error('ZIP64 no soportado')
    const crc = crc32(bytes)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8); head.writeUInt16LE(33, 12)
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(filename.length, 26)
    local.push(head, filename, compressed)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(33, 14)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42)
    central.push(dir, filename)
    offset += head.length + filename.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

export function readAndroidDist(directory) {
  const files = []
  function walk(path) {
    const name = relative(directory, path).replaceAll('\\', '/')
    if (privateMedia(name)) throw Error(`Contenido privado prohibido: ${name}`)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw Error(`No se permiten enlaces/junctions en dist: ${name}`)
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) walk(resolve(path, child))
    else if (stat.isFile()) files.push({ name, bytes: readFileSync(path) })
    else throw Error(`Archivo no regular: ${name}`)
  }
  walk(directory)
  const html = files.find((f) => f.name === 'index.html')?.bytes.toString('utf8')
  if (!html || /(?:src|href)=["']\/(?!\/)/i.test(html) || files.some((f) => /(^|\/)(sw\.js|registerSW\.js|workbox-[^/]+\.js)$/.test(f.name))) throw Error('dist debe proceder del build Android: index.html relativo y sin service worker')
  return files
}

/** Versions the checkout declares (package.json and APP_VERSION in src/db/backup.ts) and the public OTA configuration of the Android build. */
export function releaseContext(root = REPOSITORY) {
  const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
  const appVersion = /export const APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(resolve(root, 'src/db/backup.ts'), 'utf8'))?.[1]
  return { packageVersion, appVersion, env: readAndroidEnv(root) }
}

export async function release(options, context = releaseContext()) {
  // Validate destination/key BEFORE reading dist or signing; never write a key or artifact in repo.
  const output = assertExternalPath(options.out)
  const keyFile = assertExternalPath(options['key-file'])
  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? '') || !['stable', 'beta'].includes(options.channel) || !/^[\w-]+$/.test(options['key-id'] ?? '')) throw Error('Faltan --version, --channel o --key-id válidos')
  // The version is announced to every installed app: it must be the one this checkout builds and reports about itself.
  if (options.version !== context.packageVersion || options.version !== context.appVersion) {
    throw Error(`--version ${options.version} no coincide con este código (package.json ${context.packageVersion}, APP_VERSION ${context.appVersion}); compila y empaqueta la misma versión`)
  }
  const minNative = Number(options['min-native'])
  if (!Number.isSafeInteger(minNative) || minNative < 1) throw Error('--min-native debe ser un entero positivo')
  const notes = options.notes ?? ''
  if (!validNotes(notes)) throw Error('Notas: texto plano, máximo 2000 caracteres')
  const source = resolve(options.dist ?? resolve(REPOSITORY, 'dist'))
  const files = readAndroidDist(source)
  // A bundle built without the OTA configuration (or for the other channel) would switch updates off, or move the install, for good.
  const problems = bundleConfigProblems(files, expectedBundleConfig(context.env, options.channel))
  if (problems.length) throw Error(`El dist no sirve para el canal ${options.channel}: ${problems.join('; ')}. Compílalo con scripts/ota-build.mjs`)
  const zip = makeZip(files)
  const schema = Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(readFileSync(resolve(REPOSITORY, 'src/db/schema.ts'), 'utf8'))?.[1])
  if (!Number.isSafeInteger(schema) || schema < 1) throw Error('No se pudo leer SCHEMA_VERSION')
  const manifest = { format: 'salud-ota-2', version: options.version, channel: options.channel, url: httpsUrl(options.url), sha256: await digest(zip), size: zip.length,
    minNativeVersionCode: minNative, schemaVersion: schema, createdAt: new Date().toISOString(), notes }
  if (options['native-file']) {
    const n = JSON.parse(readFileSync(options['native-file'], 'utf8'))
    if (!Number.isSafeInteger(n.versionCode) || n.versionCode < minNative || typeof n.versionName !== 'string' || !n.versionName || n.versionName.length > 100 || !/^[0-9a-f]{64}$/.test(n.apkSha256) || !validNotes(n.notes) || (n.mandatory !== undefined && typeof n.mandatory !== 'boolean')) throw Error('Canal nativo inválido')
    manifest.native = { versionCode: n.versionCode, versionName: n.versionName, apkUrl: httpsUrl(n.apkUrl), apkSha256: n.apkSha256, notes: n.notes, ...(n.mandatory === undefined ? {} : { mandatory: n.mandatory }) }
  }
  const privateJwk = JSON.parse(readFileSync(keyFile, 'utf8'))
  const signed = await signManifest(manifest, privateJwk, options['key-id'])
  mkdirSync(output, { recursive: true })
  // Refuse overwriting a release. ZIP basename agrees with its signed download URL.
  const filename = basename(new URL(manifest.url).pathname)
  if (!/^[\w.-]+\.zip$/.test(filename) || privateMedia(filename)) throw Error('La URL debe terminar en un nombre .zip seguro')
  writeFileSync(resolve(output, filename), zip, { flag: 'wx' })
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(signed, null, 2), { flag: 'wx' })
  return { version: manifest.version, size: zip.length, sha256: manifest.sha256, output }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  release(args(process.argv.slice(2))).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
