import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Icon } from '../../ui/Icon'
import { recognizeLabel, releaseOcr, type OcrProgress } from './ocr'

type Rect = { x: number; y: number; w: number; h: number } // normalised 0..1 in the rotated image

const MAX_WORK = 2400

/** Draw `img` rotated by `rot` degrees into a new canvas, limited to MAX_WORK px on the long side. */
function rotatedCanvas(img: ImageBitmap | HTMLImageElement, rot: number): HTMLCanvasElement {
  const w0 = img.width
  const h0 = img.height
  const s = Math.min(1, MAX_WORK / Math.max(w0, h0))
  const w = Math.round(w0 * s)
  const h = Math.round(h0 * s)
  const swap = rot % 180 !== 0
  const c = document.createElement('canvas')
  c.width = swap ? h : w
  c.height = swap ? w : h
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  return c
}

function cropCanvas(src: HTMLCanvasElement, r: Rect | null): HTMLCanvasElement {
  if (!r || r.w < 0.05 || r.h < 0.05) return src
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * r.w)
  c.height = Math.round(src.height * r.h)
  c.getContext('2d')!.drawImage(src, src.width * r.x, src.height * r.y, c.width, c.height, 0, 0, c.width, c.height)
  return c
}

/** Small JPEG kept with the food (≤ 1000 px), so it fits in JSON backups. */
export function toStoredPhoto(src: HTMLCanvasElement): { dataUrl: string; width: number; height: number; bytes: number } {
  const s = Math.min(1, 1000 / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * s)
  c.height = Math.round(src.height * s)
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  const dataUrl = c.toDataURL('image/jpeg', 0.72)
  return { dataUrl, width: c.width, height: c.height, bytes: Math.round((dataUrl.length - 23) * 0.75) }
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/**
 * Photo → optional rotate/crop → local OCR. Calls `onText` with the recognised text; nothing is saved
 * here. `onPhoto` receives the cropped image so the caller can keep it with the food if the user wants.
 */
export function LabelCapture({ onText, onPhoto }: { onText: (text: string, confidence: number) => void; onPhoto: (c: HTMLCanvasElement | null) => void }) {
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null)
  const [rot, setRot] = useState(0)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState<OcrProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const work = useRef<HTMLCanvasElement | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => void releaseOcr(), [])

  useEffect(() => {
    if (!img) {
      work.current = null
      onPhoto(null)
      return
    }
    const c = rotatedCanvas(img, rot)
    work.current = c
    const p = previewRef.current
    if (p) {
      p.width = c.width
      p.height = c.height
      p.getContext('2d')!.drawImage(c, 0, 0)
    }
    onPhoto(cropCanvas(c, crop))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, rot, crop])

  async function pick(file: File | undefined) {
    setError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('El archivo no es una imagen.')
      return
    }
    try {
      setImg(await loadImage(file))
      setRot(0)
      setCrop(null)
    } catch {
      setError('No se pudo abrir la imagen. Prueba con otra foto.')
    }
  }

  const point = (e: RPointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }
  }

  async function run() {
    if (!work.current) return
    setError(null)
    setBusy({ status: 'Preparando', progress: 0 })
    try {
      const { text, confidence } = await recognizeLabel(cropCanvas(work.current, crop), setBusy)
      if (!text.trim()) setError('No se reconoció texto. Recorta solo la tabla, mejora la luz o escribe los valores.')
      else onText(text, confidence)
    } catch {
      setError('El reconocimiento falló en este dispositivo. Puedes pegar o escribir los valores.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} data-testid="label-photo-camera" />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} data-testid="label-photo-file" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={() => camRef.current?.click()}>
          <Icon name="camera" size={18} /> Tomar foto
        </button>
        <button type="button" className="btn-secondary" onClick={() => galRef.current?.click()}>
          <Icon name="image" size={18} /> Elegir imagen
        </button>
      </div>

      {img ? (
        <>
          <div
            className="relative touch-none select-none overflow-hidden rounded-xl border border-line bg-surface2"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const p = point(e)
              setDrag(p)
              setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
            }}
            onPointerMove={(e) => {
              if (!drag) return
              const p = point(e)
              setCrop({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) })
            }}
            onPointerUp={() => {
              setDrag(null)
              setCrop((c) => (c && (c.w < 0.05 || c.h < 0.05) ? null : c))
            }}
            aria-label="Vista previa: arrastra para recortar la tabla nutricional"
            role="img"
          >
            <canvas ref={previewRef} className="block max-h-[55vh] w-full object-contain" />
            {crop && crop.w > 0 && crop.h > 0 ? (
              <div
                className="pointer-events-none absolute border-2 border-accent shadow-[0_0_0_9999px_rgb(8_12_16/0.45)]"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="chip" onClick={() => { setRot((r) => (r + 270) % 360); setCrop(null) }} aria-label="Girar a la izquierda">
              <Icon name="rotateCcw" size={14} /> Girar
            </button>
            <button type="button" className="chip" onClick={() => { setRot((r) => (r + 90) % 360); setCrop(null) }} aria-label="Girar a la derecha">
              <Icon name="rotateCw" size={14} /> Girar
            </button>
            {crop ? (
              <button type="button" className="chip" onClick={() => setCrop(null)}>
                <Icon name="x" size={14} /> Usar foto completa
              </button>
            ) : (
              <span className="text-xs text-muted">Arrastra sobre la foto para recortar solo la tabla.</span>
            )}
          </div>
          <button type="button" className="btn-primary w-full" disabled={!!busy} onClick={() => void run()} data-testid="run-ocr">
            <Icon name="scan" size={18} /> {busy ? 'Reconociendo…' : 'Reconocer texto'}
          </button>
          {busy ? (
            <div aria-live="polite">
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>{busy.status}</span>
                <span className="num">{Math.round(busy.progress * 100)} %</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-faint">La primera vez se descarga el modelo en español (≈ 6 MB) desde esta misma app; luego funciona sin conexión.</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">
          La foto se procesa solo en este dispositivo y no se envía a ningún servidor. Encuadra la tabla nutricional de frente y con buena luz.
        </p>
      )}
      {error ? (
        <p className="flex gap-1.5 text-sm text-bad">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}
    </div>
  )
}
