/**
 * Local OCR for nutrition-label photos (Tesseract.js, Spanish model).
 * Everything runs in a Web Worker on this device: the worker, WASM core and model are served from
 * the app itself (public/ocr/, copied at build time) — the photo is never uploaded anywhere.
 * The result is untrusted text: the user always edits and confirms it before anything is saved.
 */
import type { Worker } from 'tesseract.js'

export interface OcrProgress {
  status: string
  progress: number
}

let workerPromise: Promise<Worker> | null = null

const STATUS_ES: Record<string, string> = {
  'loading tesseract core': 'Cargando el motor de reconocimiento',
  'initializing tesseract': 'Iniciando',
  'initialized tesseract': 'Iniciando',
  'loading language traineddata': 'Cargando el modelo en español',
  'loaded language traineddata': 'Modelo cargado',
  'initializing api': 'Preparando',
  'initialized api': 'Preparando',
  'recognizing text': 'Reconociendo texto',
}

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

async function getWorker(onProgress: (p: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js')
      const worker = await createWorker('spa', OEM.LSTM_ONLY, {
        workerPath: assetUrl('ocr/worker.min.js'),
        corePath: assetUrl('ocr/'),
        langPath: assetUrl('ocr/'),
        // Android's asset packager decompresses *.gz and drops the extension, so the APK ships
        // ocr/spa.traineddata; the web build serves the smaller spa.traineddata.gz.
        gzip: import.meta.env.MODE !== 'android',
        logger: (m: { status: string; progress: number }) => onProgressRef.current?.({ status: STATUS_ES[m.status] ?? m.status, progress: m.progress }),
      })
      // Uniform block of text keeps label rows together; keep spaces so columns stay apart.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' })
      return worker
    })()
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  onProgressRef.current = onProgress
  return workerPromise
}
const onProgressRef: { current: ((p: OcrProgress) => void) | null } = { current: null }

/** Grayscale + contrast stretch + upscale small photos: noticeably better OCR on glossy labels. */
export function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const maxSide = Math.max(source.width, source.height)
  const scale = maxSide < 1400 ? 1400 / maxSide : maxSide > 2600 ? 2600 / maxSide : 1
  const c = document.createElement('canvas')
  c.width = Math.round(source.width * scale)
  c.height = Math.round(source.height * scale)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return source
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const px = img.data
  let lo = 255
  let hi = 0
  const gray = new Uint8ClampedArray(px.length / 4)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!
    gray[j] = g
    if (g < lo) lo = g
    if (g > hi) hi = g
  }
  const span = Math.max(1, hi - lo)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((gray[j]! - lo) / span) * 255
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export async function recognizeLabel(canvas: HTMLCanvasElement, onProgress: (p: OcrProgress) => void): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker(onProgress)
  const { data } = await worker.recognize(preprocessForOcr(canvas))
  return { text: data.text, confidence: data.confidence }
}

/** Free the worker (≈ 30–60 MB) when the label screen closes. */
export async function releaseOcr(): Promise<void> {
  const p = workerPromise
  workerPromise = null
  onProgressRef.current = null
  if (p) {
    try {
      await (await p).terminate()
    } catch {
      /* already gone */
    }
  }
}
