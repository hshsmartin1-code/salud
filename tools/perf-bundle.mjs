// Bundle report for a production build: entry chunk raw/gzip, first-load JS (entry + modulepreload), PWA precache.
// Usage: node tools/perf-bundle.mjs <distDir>
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = process.argv[2] ?? 'dist'
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+)"/g)].map((m) => m[1])
const size = (f) => {
  const b = readFileSync(join(dist, f))
  return { raw: b.length, gz: gzipSync(b).length }
}
const kb = (n) => (n / 1024).toFixed(1) + ' kB'
const entry = refs.find((r) => /assets\/index-.*\.js$/.test(r))
const js = [...new Set(refs.filter((r) => r.endsWith('.js')))]
let raw = 0
let gz = 0
for (const f of js) {
  const s = size(f)
  raw += s.raw
  gz += s.gz
  console.log(`  first-load ${f}\t${kb(s.raw)}\t${kb(s.gz)} gzip`)
}
const e = size(entry)
console.log(`entry ${entry}\t${kb(e.raw)}\t${kb(e.gz)} gzip`)
console.log(`first-load JS total (${js.length} files)\t${kb(raw)}\t${kb(gz)} gzip`)
const all = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'))
console.log(`JS chunks: ${all.length}, total ${kb(all.reduce((a, f) => a + statSync(join(dist, 'assets', f)).size, 0))}`)
const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1])
const precache = urls.reduce((a, u) => {
  try {
    return a + statSync(join(dist, u)).size
  } catch {
    return a
  }
}, 0)
console.log(`precache: ${urls.length} entries, ${kb(precache)}`)
console.log(JSON.stringify({ entryRaw: e.raw, entryGz: e.gz, firstLoadRaw: raw, firstLoadGz: gz, files: js.length, precache }))
