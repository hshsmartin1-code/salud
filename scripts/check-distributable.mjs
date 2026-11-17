// Fails when something that must stay on the owner's device could ship: a private media pack.
//
//   node scripts/check-distributable.mjs [--root <app folder>]
//
// Checks, under <root> (default: the app folder):
//   - dist/ and android/app/src/main/assets/ (every file), and every git-tracked path:
//       * a JSON file that is a media pack manifest with a "private-local" licence or record;
//       * a media file (image / video) under a path that has a "private" segment;
//       * a .zip whose name says "private";
//       * a file named like the exercise dataset's media (NNNN-xxxxxxx.jpg|gif): third-party media.
// Wire it before the APK build:  "android:apk": "node scripts/check-distributable.mjs && node scripts/android-apk.mjs"
// (and run it after `npm run build` for web deploys).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argRoot = process.argv.indexOf('--root')
const root = resolve(argRoot >= 0 ? process.argv[argRoot + 1] : join(here, '..'))

const MEDIA = /\.(jpe?g|png|webp|avif|gif|svg|mp4|webm|mov)$/i
const DATASET_MEDIA = /(^|[\\/])\d{4}-[A-Za-z0-9]{7}\.(jpe?g|gif)$/i
const MAX_JSON = 32 * 1024 * 1024

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function tracked() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean)
      .map((f) => join(root, f))
  } catch {
    return []
  }
}

const roots = [join(root, 'dist'), join(root, 'android', 'app', 'src', 'main', 'assets')]
const files = new Set([...roots.flatMap((d) => walk(d)), ...tracked().filter((f) => existsSync(f))])
const problems = []

for (const f of files) {
  const rel = relative(root, f).split(sep).join('/')
  const segments = rel.split('/')
  const inPrivate = segments.slice(0, -1).some((s) => /private/i.test(s))
  if (MEDIA.test(rel) && inPrivate) problems.push(`${rel}: archivo de medios bajo una ruta privada`)
  if (/private/i.test(segments.at(-1) ?? '') && /\.zip$/i.test(rel)) problems.push(`${rel}: paquete .zip privado`)
  if (DATASET_MEDIA.test(rel)) problems.push(`${rel}: medios de un dataset de terceros (no distribuibles)`)
  if (/\.(json|webmanifest)$/i.test(rel)) {
    let size = 0
    try {
      size = statSync(f).size
    } catch {
      continue
    }
    if (size > MAX_JSON) continue
    const text = readFileSync(f, 'utf8')
    if (!text.includes('pho-media-pack') && !text.includes('private-local')) continue
    try {
      const j = JSON.parse(text)
      const priv = j?.format === 'pho-media-pack' && (j?.pack?.license?.status === 'private-local' || Object.values(j?.records ?? {}).some((r) => r?.license?.status === 'private-local'))
      if (priv) problems.push(`${rel}: manifiesto de paquete privado (private-local)`)
    } catch {
      if (/"status"\s*:\s*"private-local"/.test(text)) problems.push(`${rel}: contiene registros private-local`)
    }
  }
}

if (problems.length) {
  process.stderr.write(`check-distributable: FALLO (${problems.length})\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`check-distributable: OK (${files.size} archivos revisados en dist/, assets de Android y rutas versionadas)\n`)
