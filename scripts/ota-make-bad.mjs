#!/usr/bin/env node
/** Derive intentionally bad device fixtures. Signature/transport variants never modify the good release. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertExternalPath, signManifest } from './ota-sign.mjs'
import { args } from './ota-release.mjs'

export function badVariants(manifest, zip) {
  const corrupted = Buffer.from(zip)
  if (!corrupted.length) throw Error('ZIP vacío')
  corrupted[Math.floor(corrupted.length / 2)] ^= 1
  return [
    { name: 'wrong-signature', manifest: { ...manifest }, zip, wrongSignature: true },
    { name: 'corrupted-zip', manifest: { ...manifest }, zip: corrupted },
    { name: 'wrong-size', manifest: { ...manifest, size: manifest.size + 1 }, zip },
    { name: 'future-schema', manifest: { ...manifest, schemaVersion: manifest.schemaVersion + 1 }, zip },
    { name: 'too-new-native', manifest: { ...manifest, minNativeVersionCode: Math.max(999999, manifest.minNativeVersionCode + 1) }, zip },
    { name: 'downgrade', manifest: { ...manifest, version: '0.0.0' }, zip },
    { name: 'http-url', manifest: { ...manifest, url: manifest.url.replace(/^https:/, 'http:') }, zip },
    { name: 'foreign-host', manifest: { ...manifest, url: 'https://foreign.invalid/bundle.zip' }, zip },
  ]
}

async function main(options) {
  const output = assertExternalPath(options.out)
  const keyFile = assertExternalPath(options['key-file'])
  const signed = JSON.parse(readFileSync(options.manifest, 'utf8'))
  const manifest = JSON.parse(signed.manifest)
  const zip = readFileSync(options.bundle)
  const privateJwk = JSON.parse(readFileSync(keyFile, 'utf8'))
  for (const variant of badVariants(manifest, zip)) {
    const next = await signManifest(variant.manifest, privateJwk, signed.keyId)
    if (variant.wrongSignature) {
      const signature = Buffer.from(next.signature, 'base64'); signature[0] ^= 1; next.signature = signature.toString('base64')
    }
    const directory = assertExternalPath(resolve(output, variant.name))
    mkdirSync(directory, { recursive: true })
    writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(next, null, 2), { flag: 'wx' })
    writeFileSync(resolve(directory, 'bundle.zip'), variant.zip, { flag: 'wx' })
  }
  console.log(`8 fixtures escritas en ${output}. Sirve cada bundle.zip en la URL firmada (servidor de prueba); no publiques estos fixtures.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(args(process.argv.slice(2))).catch((error) => { console.error(error.message); process.exitCode = 1 })
