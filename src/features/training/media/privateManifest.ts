/**
 * Validation of a private media pack (pure). A private pack is a `pho-media-pack` manifest whose licence
 * status is `private-local`; it is stored only in the device's Cache Storage and shown only from there.
 * Everything here is strict: anything the manifest does not declare, or that is not an image / video file,
 * is rejected. See the project notes.
 */
import { LEGACY_PACK_ID } from './manifest'
import type { AnimationFormat, ExerciseMediaRecord, MediaAnimation, MediaPack, StillFormat, StillImage } from './types'

export const PRIVATE_MANIFEST_NAME = 'manifest.json'
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024
export const MAX_RECORDS = 5000

const STILL_EXT: Record<string, StillFormat> = { webp: 'webp', png: 'png', jpg: 'jpg', jpeg: 'jpg', avif: 'avif' }
const ANIM_EXT: Record<string, AnimationFormat> = { mp4: 'mp4', webm: 'webm', webp: 'webp', gif: 'gif' }
const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export const extOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase()
/** Media type for a stored file (empty for anything that is not an accepted image / video). */
export const mimeOf = (path: string): string => MIME[extOf(path)] ?? ''
export const isMediaPath = (path: string): boolean => path.includes('.') && extOf(path) in MIME

export interface PrivateValidation {
  ok: true
  pack: MediaPack
  /** Every file the manifest references (relative to the pack root), each present in the archive. */
  files: string[]
  summary: { name: string; style: string; attribution: string; attributionUrl?: string; exercises: number; files: number }
}
export interface PrivateInvalid {
  ok: false
  error: string
}

const bad = (error: string): PrivateInvalid => ({ ok: false, error })
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const dim = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 8192

/**
 * Checks a parsed manifest against the list of files present in the archive.
 * `available` is the set of archive paths; the manifest may reference only those. `null` skips the presence check
 * (a stored pack: a file missing from the cache is handled when it is shown, not by disabling the pack).
 */
export function validatePrivateManifest(raw: unknown, available: ReadonlySet<string> | null): PrivateValidation | PrivateInvalid {
  if (!isObj(raw) || raw.format !== 'pho-media-pack' || raw.version !== 1) return bad('El manifiesto no tiene el formato pho-media-pack versión 1.')
  const pack = raw.pack
  const records = raw.records
  if (!isObj(pack) || !isObj(records)) return bad('Al manifiesto le faltan «pack» o «records».')
  if (!str(pack.id, 40) || !/^[a-z0-9][a-z0-9-]*$/.test(pack.id)) return bad('El id del paquete no es válido (minúsculas, números y guiones).')
  if (pack.id === LEGACY_PACK_ID) return bad('El id del paquete coincide con el del paquete incluido.')
  if (!str(pack.style, 120)) return bad('Falta el estilo del paquete.')
  if (!str(pack.attribution, 600)) return bad('Falta la atribución del paquete.')
  if (pack.attributionUrl !== undefined && (typeof pack.attributionUrl !== 'string' || !/^https?:\/\//.test(pack.attributionUrl) || pack.attributionUrl.length > 300)) return bad('La URL de atribución no es válida.')
  if (typeof pack.version !== 'number' || !Number.isFinite(pack.version)) return bad('Falta la versión del paquete.')
  if (pack.basePath !== '') return bad('El paquete privado debe declarar basePath vacío.')
  const lic = pack.license
  if (!isObj(lic) || lic.status !== 'private-local') return bad('La licencia del paquete debe ser «private-local».')

  const ids = Object.keys(records)
  if (ids.length === 0) return bad('El paquete no contiene ejercicios.')
  if (ids.length > MAX_RECORDS) return bad('El paquete tiene demasiados ejercicios.')

  const used = new Set<string>()
  const claimFile = (path: unknown, allowed: Record<string, unknown>, what: string): string | PrivateInvalid => {
    if (typeof path !== 'string' || !path) return bad(`${what}: falta la ruta.`)
    if (available && !available.has(path)) return bad(`${what}: el archivo «${path}» no está en el ZIP.`)
    if (!(extOf(path) in allowed)) return bad(`${what}: tipo de archivo no permitido («${path}»).`)
    used.add(path)
    return path
  }
  const still = (v: unknown, what: string): StillImage | PrivateInvalid => {
    if (!isObj(v)) return bad(`${what}: imagen inválida.`)
    const src = claimFile(v.src, STILL_EXT, what)
    if (typeof src !== 'string') return src
    if (!dim(v.width) || !dim(v.height)) return bad(`${what}: medidas no válidas.`)
    if (v.format !== STILL_EXT[extOf(src)]) return bad(`${what}: el formato no coincide con la extensión.`)
    const pose = v.pose
    if (pose !== undefined && pose !== 'start' && pose !== 'peak' && pose !== 'main') return bad(`${what}: pose no válida.`)
    return { src, width: v.width, height: v.height, format: v.format as StillFormat, ...(pose ? { pose } : {}) }
  }

  const out: Record<string, ExerciseMediaRecord> = {}
  for (const id of ids) {
    const r = records[id]
    const at = `Registro ${id}`
    if (!/^[A-Za-z0-9:_.-]{1,120}$/.test(id) || !isObj(r)) return bad(`${at}: id o contenido no válido.`)
    if (r.exerciseId !== id) return bad(`${at}: exerciseId no coincide.`)
    if (r.source !== pack.id) return bad(`${at}: source no coincide con el paquete.`)
    if (!isObj(r.license) || r.license.status !== 'private-local') return bad(`${at}: la licencia debe ser «private-local».`)
    if (r.availability !== 'bundled') return bad(`${at}: availability debe ser «bundled» (local).`)
    if (typeof r.version !== 'number') return bad(`${at}: falta la versión.`)
    if (r.label !== undefined && !str(r.label, 200)) return bad(`${at}: etiqueta no válida.`)
    const thumb = still(r.thumb, `${at} (miniatura)`)
    if ('ok' in thumb) return thumb
    if (!Array.isArray(r.images) || r.images.length > 2) return bad(`${at}: images debe tener 0, 1 o 2 imágenes.`)
    const images: StillImage[] = []
    for (const [i, img] of r.images.entries()) {
      const s = still(img, `${at} (imagen ${i + 1})`)
      if ('ok' in s) return s
      images.push(s)
    }
    let animation: MediaAnimation | undefined
    if (r.animation !== undefined) {
      const a = r.animation
      if (!isObj(a)) return bad(`${at}: animación inválida.`)
      const src = claimFile(a.src, ANIM_EXT, `${at} (animación)`)
      if (typeof src !== 'string') return src
      const poster = claimFile(a.poster, STILL_EXT, `${at} (póster)`)
      if (typeof poster !== 'string') return poster
      if (!dim(a.width) || !dim(a.height)) return bad(`${at}: medidas de animación no válidas.`)
      if (a.format !== ANIM_EXT[extOf(src)]) return bad(`${at}: el formato de la animación no coincide con la extensión.`)
      if (a.durationMs !== undefined && (typeof a.durationMs !== 'number' || a.durationMs < 0 || a.durationMs > 600000)) return bad(`${at}: duración no válida.`)
      animation = { src, poster, format: a.format as AnimationFormat, width: a.width, height: a.height, ...(typeof a.durationMs === 'number' ? { durationMs: a.durationMs } : {}) }
    }
    if (!animation && images.length === 0) return bad(`${at}: sin imágenes ni animación.`)
    out[id] = {
      exerciseId: id,
      thumb,
      images,
      ...(animation ? { animation } : {}),
      source: pack.id,
      license: { status: 'private-local', ...(typeof r.license.attribution === 'string' && r.license.attribution.length <= 600 ? { attribution: r.license.attribution } : {}) },
      version: r.version,
      availability: 'bundled',
      ...(typeof r.label === 'string' ? { label: r.label } : {}),
      ...(r.approximate === true ? { approximate: true } : {}),
    }
  }
  const result: MediaPack = {
    id: pack.id,
    style: pack.style,
    attribution: pack.attribution,
    ...(typeof pack.attributionUrl === 'string' ? { attributionUrl: pack.attributionUrl } : {}),
    license: { status: 'private-local' },
    version: pack.version,
    basePath: '',
    records: out,
  }
  return { ok: true, pack: result, files: [...used].sort(), summary: { name: pack.id, style: pack.style, attribution: pack.attribution, ...(result.attributionUrl ? { attributionUrl: result.attributionUrl } : {}), exercises: ids.length, files: used.size } }
}

/** Entry names of an archive that are neither the manifest nor an accepted image / video file. */
export function disallowedEntries(names: readonly string[]): string[] {
  return names.filter((n) => n !== PRIVATE_MANIFEST_NAME && !isMediaPath(n))
}
