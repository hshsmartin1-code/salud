// Copies the Tesseract.js worker, WASM cores and Spanish model into public/ocr/ so OCR runs fully
// on the device (no CDN). Runs before `dev` and `build`. public/ocr/ is generated (gitignored).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
mkdirSync(out, { recursive: true })

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // tessdata "best_int" Spanish model (Apache-2.0), gzip-compressed.
  ['node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'spa.traineddata.gz'],
]

let total = 0
for (const [from, to] of files) {
  const src = join(root, from)
  if (!existsSync(src)) {
    console.error(`[ocr] falta ${from}; ejecuta npm install`)
    process.exit(1)
  }
  copyFileSync(src, join(out, to))
  total += statSync(src).size
}
console.log(`[ocr] ${files.length} archivos copiados a public/ocr (${(total / 1048576).toFixed(1)} MB)`)
