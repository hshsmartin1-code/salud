import type { PhotoPose } from '../../db/types'

export const MAX_PHOTO_PX = 1280
export const MAX_THUMB_PX = 240
export const PHOTO_QUALITY = 0.8
export const THUMB_QUALITY = 0.7

export const POSES: readonly { value: PhotoPose; label: string }[] = [
  { value: 'front', label: 'Frente' },
  { value: 'side', label: 'Perfil' },
  { value: 'back', label: 'Espalda' },
  { value: 'other', label: 'Otra' },
]
export const POSE_LABEL: Record<PhotoPose, string> = { front: 'Frente', side: 'Perfil', back: 'Espalda', other: 'Otra' }

/**
 * Size that fits inside a max x max box, keeping the aspect ratio. Never upscales; each side is at
 * least 1 px. Pure so it can be tested without a canvas.
 */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(max > 0)) return { width: 1, height: 1 }
  const s = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** Approximate decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export interface ProcessedPhoto {
  dataUrl: string
  thumbUrl: string
  width: number
  height: number
  bytes: number
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
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

function render(src: ImageBitmap | HTMLImageElement, max: number, quality: number) {
  const { width, height } = fitWithin(src.width, src.height, max)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible')
  ctx.drawImage(src, 0, 0, width, height)
  return { dataUrl: c.toDataURL('image/jpeg', quality), width, height }
}

/** Downscale on device: ≤1280 px JPEG (q 0.8) plus a ≤240 px thumbnail. Nothing leaves the device. */
export async function processPhotoFile(file: Blob): Promise<ProcessedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.')
  const src = await decode(file)
  try {
    const full = render(src, MAX_PHOTO_PX, PHOTO_QUALITY)
    const thumb = render(src, MAX_THUMB_PX, THUMB_QUALITY)
    return { dataUrl: full.dataUrl, thumbUrl: thumb.dataUrl, width: full.width, height: full.height, bytes: dataUrlBytes(full.dataUrl) }
  } finally {
    if ('close' in src) src.close()
  }
}
