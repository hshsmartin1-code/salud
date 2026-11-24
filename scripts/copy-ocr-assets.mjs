// Copies the Tesseract.js worker, WASM cores and Spanish model into public/ocr/ so OCR runs fully
// on the device (no CDN). Runs before `dev` and `build`. public/ocr/ is generated (gitignored).
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
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
  // V2.1 photo OCR is unavailable until a real-photo benchmark passes. Keep experimental code,
  // but do not ship its unused worker/model. Only these known generated files are removed.
  if (process.env.SALUD_EXPERIMENTAL_OCR_ASSETS !== '1') {
    const generated = join(out, to)
    if (existsSync(generated)) unlinkSync(generated)
    continue
  }
  if (!existsSync(src)) {
    console.error(`[ocr] falta ${from}; ejecuta npm install`)
    process.exit(1)
  }
  copyFileSync(src, join(out, to))
  total += statSync(src).size
}
console.log(`[assets] OCR experimental ${total ? 'incluido' : 'no incluido'} (${(total / 1048576).toFixed(1)} MB)`)

// Ship the same third-party notices with the website and the APK, including offline use.
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(root, 'public', 'THIRD_PARTY_NOTICES.txt'))
// The scientific methodology (formulas, assumptions, sources), linked from Ajustes → Cómo se calcula.
copyFileSync(join(root, 'docs', 'METODOLOGIA.md'), join(root, 'public', 'METODOLOGIA.txt'))
