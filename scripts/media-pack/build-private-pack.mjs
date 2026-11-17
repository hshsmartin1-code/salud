// Builds the .zip that the in-app "Paquete de medios privado" importer reads, from media files YOU hold the
// rights to. The zip is for your own device only: it must never be committed, bundled or distributed.
//
//   node scripts/media-pack/build-private-pack.mjs --media <folder> --map docs/exercise-media-map.csv \
//        --attribution "<text shown wherever the media is shown>" --out <folder OUTSIDE the repository> \
//        [--id mi-paquete] [--style "Mi estilo"] [--attribution-url https://...] [--video-size 320x320]
//
// File names in --media (extension decides the kind):
//   <datasetId>.<ext>  or  <saludId with ":" written "_">.<ext>      e.g. 0001.webp, fedb_Barbell_Squat.mp4
//   jpg / jpeg / png / webp / avif -> one still image;  mp4 / webm / gif -> animation (needs <name>-poster.<image>)
//   <name>-start.<image> and <name>-peak.<image> -> the two poses (instead of a single still)
// Only rows of the map whose match is CONFIRMED are used: needsReview = "no" with a single datasetId
// (automatic matches, or rows you cleared by hand). Everything else is skipped and reported.
import { deflateRawSync, crc32 } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './mapping.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const fail = (msg) => {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

const mediaDir = arg('media')
const mapPath = arg('map')
const attribution = arg('attribution')
const outDir = arg('out')
if (!mediaDir || !mapPath || !attribution || !outDir) {
  process.stderr.write('Uso: node scripts/media-pack/build-private-pack.mjs --media <carpeta> --map <csv> --attribution "<texto>" --out <carpeta fuera del repositorio>\n')
  process.exit(2)
}
const out = resolve(outDir)
// Never write inside the repository (or any folder under a git work tree).
const inside = (p, base) => p === base || p.startsWith(base + sep)
let probe = out
for (;;) {
  if (existsSync(join(probe, '.git')) || inside(out, root)) fail(`--out (${out}) está dentro de un repositorio. Elige una carpeta fuera.`)
  const up = dirname(probe)
  if (up === probe) break
  probe = up
}

const id = arg('id') ?? 'private-' + new Date().toISOString().slice(0, 10)
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === 'repdb-free') fail('--id no es válido (minúsculas, números y guiones; máximo 40).')
const style = arg('style') ?? 'Paquete privado'
const attributionUrl = arg('attribution-url')
const [vw, vh] = (arg('video-size') ?? '320x320').split('x').map(Number)
if (!vw || !vh) fail('--video-size debe ser AnchoxAlto, p. ej. 320x320.')

const STILL = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp', '.avif': 'avif' }
const ANIM = { '.mp4': 'mp4', '.webm': 'webm', '.gif': 'gif' }
const MIME_OK = new Set([...Object.keys(STILL), ...Object.keys(ANIM)])

// ───────────── image size (png, jpeg, webp, gif) ─────────────
function imageSize(buf, ext) {
  try {
    if (ext === '.png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    if (ext === '.gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
    if (ext === '.jpg' || ext === '.jpeg') {
      let i = 2
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null
        const m = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        i += 2 + len
      }
      return null
    }
    if (ext === '.webp') {
      const kind = buf.toString('ascii', 12, 16)
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
      }
      if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
    }
  } catch {
    /* fall through */
  }
  return null
}

// ───────────── collect files ─────────────
if (!existsSync(mediaDir) || !statSync(mediaDir).isDirectory()) fail(`--media no es una carpeta: ${mediaDir}`)
const files = new Map() // lowercased stem -> { path, ext }
for (const f of readdirSync(mediaDir)) {
  const ext = extname(f).toLowerCase()
  if (!MIME_OK.has(ext)) continue
  files.set(basename(f, extname(f)).toLowerCase(), { path: join(mediaDir, f), ext })
}

const csv = parseCsv(readFileSync(resolve(mapPath), 'utf8'))
const records = {}
const entries = new Map() // zip path -> Buffer
const report = { used: 0, skippedUnconfirmed: 0, noFile: 0, incomplete: [] }

const stillRef = (zipPath, buf, ext, pose) => {
  const sz = imageSize(buf, ext)
  if (!sz) return null
  return { src: zipPath, width: sz.w, height: sz.h, format: STILL[ext], ...(pose ? { pose } : {}) }
}

for (const row of csv.rows) {
  const confirmed = row.datasetId && !row.datasetId.includes('|') && row.needsReview === 'no'
  if (!confirmed) {
    if (row.datasetId) report.skippedUnconfirmed++
    continue
  }
  const stems = [row.datasetId, row.exerciseId.replace(/:/g, '_')].map((s) => s.toLowerCase())
  const stem = stems.find((s) => files.has(s) || files.has(`${s}-start`) || files.has(`${s}-poster`))
  if (!stem) {
    report.noFile++
    continue
  }
  const dir = `m/${stem.replace(/[^a-z0-9_-]/g, '_')}`
  const take = (name) => {
    const f = files.get(name)
    if (!f) return null
    const buf = readFileSync(f.path)
    return { buf, ext: f.ext }
  }
  let thumb = null
  const images = []
  let animation
  const main = files.get(stem)
  if (main && ANIM[main.ext]) {
    const a = take(stem)
    const poster = ['-poster'].map((s) => take(stem + s)).find(Boolean)
    if (!poster || !STILL[poster.ext]) {
      report.incomplete.push(`${row.exerciseId}: la animación necesita ${stem}-poster.<imagen>`)
      continue
    }
    const aPath = `${dir}/clip${main.ext}`
    const pPath = `${dir}/poster${poster.ext}`
    const sz = main.ext === '.gif' ? imageSize(a.buf, '.gif') : { w: vw, h: vh }
    const posterRef = stillRef(pPath, poster.buf, poster.ext)
    if (!sz || !posterRef) {
      report.incomplete.push(`${row.exerciseId}: no se pudo leer el tamaño`)
      continue
    }
    entries.set(aPath, a.buf)
    entries.set(pPath, poster.buf)
    animation = { src: aPath, format: ANIM[main.ext], width: sz.w, height: sz.h, poster: pPath }
    thumb = posterRef
  } else {
    const parts = [['start', `${stem}-start`], ['peak', `${stem}-peak`]]
    const poses = parts.map(([pose, name]) => [pose, take(name)]).filter(([, t]) => t && STILL[t.ext])
    const list = poses.length ? poses : main && STILL[main.ext] ? [['main', take(stem)]] : []
    if (!list.length) {
      report.incomplete.push(`${row.exerciseId}: sin imagen utilizable`)
      continue
    }
    let bad = false
    for (const [pose, t] of list) {
      const p = `${dir}/${pose}${t.ext}`
      const ref = stillRef(p, t.buf, t.ext, pose)
      if (!ref) {
        bad = true
        break
      }
      entries.set(p, t.buf)
      images.push(ref)
    }
    if (bad) {
      report.incomplete.push(`${row.exerciseId}: no se pudo leer el tamaño de una imagen`)
      continue
    }
    thumb = { ...images[0] }
    delete thumb.pose
  }
  records[row.exerciseId] = {
    exerciseId: row.exerciseId,
    thumb,
    images,
    ...(animation ? { animation } : {}),
    source: id,
    license: { status: 'private-local' },
    version: 1,
    availability: 'bundled',
    label: row.name,
  }
  report.used++
}

if (!report.used) fail('Ninguna fila confirmada tiene archivos en --media. Nada que empaquetar.')

const manifest = {
  format: 'pho-media-pack',
  version: 1,
  pack: { id, style, attribution, ...(attributionUrl ? { attributionUrl } : {}), license: { status: 'private-local' }, version: 1, basePath: '' },
  records,
}

// ───────────── zip writer ─────────────
function zip(items) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of items) {
    const nameBuf = Buffer.from(name, 'utf8')
    const comp = deflateRawSync(data)
    const useDeflate = comp.length < data.length
    const body = useDeflate ? comp : data
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6) // UTF-8 names
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    parts.push(lh, nameBuf, body)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

mkdirSync(out, { recursive: true })
const items = [['manifest.json', Buffer.from(JSON.stringify(manifest, null, 1), 'utf8')], ...entries]
const target = join(out, `${id}.zip`)
const buf = zip(items)
writeFileSync(target, buf)
process.stdout.write(
  `Paquete: ${target}\nEjercicios: ${report.used}\nArchivos: ${items.length - 1}\nTamaño: ${(buf.length / 1048576).toFixed(1)} MB\n` +
    `Filas con coincidencia sin confirmar (omitidas): ${report.skippedUnconfirmed}\nFilas confirmadas sin archivo en --media: ${report.noFile}\n` +
    (report.incomplete.length ? `Incompletas:\n  ${report.incomplete.join('\n  ')}\n` : '') +
    `Importa el .zip desde Ajustes > Paquete de medios privado. No lo subas al repositorio.\n`,
)
