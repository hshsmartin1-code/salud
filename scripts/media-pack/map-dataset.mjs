// Maps Salud exercises to the ids of a public exercise dataset (TEXT metadata only, no network, no media).
//
//   node scripts/media-pack/map-dataset.mjs --dataset <path>/data/exercises.json --out docs/exercise-media-map.csv
//
// Reads the CSV at --out (when it exists) and public/data/exercises.json (override with --catalog), fills the
// columns datasetId, datasetName, matchRule, matchConfidence, needsReview with STRICT rules (see mapping.mjs)
// and writes the CSV back. A row you cleared by hand (needsReview = no, same datasetId) keeps your decision.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMapping, buildDatasetIndex, parseCsv, toCsv } from './mapping.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const datasetPath = arg('dataset')
const out = resolve(root, arg('out') ?? 'docs/exercise-media-map.csv')
const catalogPath = resolve(root, arg('catalog') ?? 'public/data/exercises.json')
if (!datasetPath) {
  process.stderr.write('Uso: node scripts/media-pack/map-dataset.mjs --dataset <ruta>/exercises.json --out docs/exercise-media-map.csv\n')
  process.exit(2)
}

const dataset = JSON.parse(readFileSync(resolve(datasetPath), 'utf8'))
if (!Array.isArray(dataset)) throw new Error('El dataset debe ser un array JSON.')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')).exercises
const catalogById = new Map(catalog.map((e) => [e.id, e]))
let csv
try {
  csv = parseCsv(readFileSync(out, 'utf8'))
} catch {
  csv = { header: ['exerciseId', 'name'], rows: catalog.map((e) => ({ exerciseId: e.id, name: e.nameEs })) }
}
const { header, rows, counts } = applyMapping(csv, catalogById, buildDatasetIndex(dataset))
writeFileSync(out, toCsv(header, rows))
process.stdout.write(
  `Filas: ${rows.length}\nAutomáticas (nombre + equipo + músculo): ${counts.automatic}\nPor revisar (solo nombre o ambiguas): ${counts.needsReview}\nSin candidato: ${counts.none}\nDecisiones manuales conservadas: ${counts.keptByHand}\n`,
)
