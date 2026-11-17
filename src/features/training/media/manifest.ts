/**
 * Pure helpers: adapt the legacy `pho-exercise-media` file to the pack model, parse native packs, and
 * resolve an exercise id (through the alias map) to a record that is allowed to render.
 */
import { resolveExerciseId, type ExerciseAliases } from '../exerciseKnowledge'
import type { ExerciseMediaRecord, MediaPack, MediaPackFile, PoseKey, StillImage } from './types'

export const LEGACY_PACK_ID = 'repdb-free'

/** Shape of today's `public/data/exercise-media.json` (kept readable as is). */
export interface LegacyItem {
  repdbId: string
  confidence: 'high' | 'medium'
  thumb: string
  images: string[]
  poses: PoseKey[]
  nameEn: string
  instructionsEs?: string[]
}
export interface LegacyFile {
  format: 'pho-exercise-media'
  version: number
  attribution: string
  attributionUrl: string
  licenseUrl: string
  basePath: string
  items: Record<string, LegacyItem>
}

const still = (src: string, size: number, pose?: PoseKey): StillImage => ({ src, width: size, height: size, format: 'webp', ...(pose ? { pose } : {}) })

/** Today's file -> pack `repdb-free` (160 px thumbnails, 512 px stills, free tier with attribution). */
export function adaptLegacyMedia(file: LegacyFile): MediaPack {
  const license = { status: 'free-with-attribution' as const, attribution: file.attribution, url: file.licenseUrl }
  const records: Record<string, ExerciseMediaRecord> = {}
  for (const [id, it] of Object.entries(file.items)) {
    records[id] = {
      exerciseId: id,
      thumb: still(it.thumb, 160),
      images: it.images.map((src, i) => still(src, 512, it.poses[i] ?? 'main')),
      source: LEGACY_PACK_ID,
      license,
      version: file.version,
      availability: 'bundled',
      label: it.nameEn,
      approximate: it.confidence === 'medium',
    }
  }
  return { id: LEGACY_PACK_ID, style: 'RepDB flat (free tier)', attribution: file.attribution, attributionUrl: file.attributionUrl, license, version: file.version, basePath: file.basePath, records }
}

/** Validates a native pack file; null when it is not one or is malformed. */
export function parsePackFile(raw: unknown): MediaPack | null {
  const f = raw as Partial<MediaPackFile> | null
  if (!f || f.format !== 'pho-media-pack' || !f.pack || typeof f.pack.id !== 'string' || !f.records || typeof f.records !== 'object') return null
  if (typeof f.pack.basePath !== 'string' || typeof f.pack.attribution !== 'string') return null
  return { ...f.pack, records: f.records }
}

/** Any supported manifest -> the single pack it declares. */
export function packFromManifest(raw: unknown): MediaPack | null {
  const f = raw as { format?: string } | null
  if (f?.format === 'pho-exercise-media') return adaptLegacyMedia(raw as LegacyFile)
  if (f?.format === 'pho-media-pack') return parsePackFile(raw)
  return null
}

/** Licences that allow showing the media. `pending` and `unlicensed` never render; `private-local` only from the private cache. */
export function licenseAllowsRender(status: ExerciseMediaRecord['license']['status'], fromPrivateCache = false): boolean {
  if (status === 'private-local') return fromPrivateCache
  return status === 'licensed' || status === 'free-with-attribution'
}

export interface MediaIndex {
  pack: MediaPack
  aliases: ExerciseAliases
  /** True when the pack lives in the device-private cache (the only place private-local records may render from). */
  privateCache: boolean
  /** The record to render for `id`, or null (neutral placeholder): unknown, other pack, unlicensed, missing. */
  lookup(id: string | null | undefined): ExerciseMediaRecord | null
}

/** Active pack + alias map -> lookup. Resolution goes through `resolveExerciseId`, then the active pack only. */
export function createMediaIndex(pack: MediaPack, aliases: ExerciseAliases = {}, opts: { privateCache?: boolean } = {}): MediaIndex {
  const privateCache = opts.privateCache === true
  const lookup = (id: string | null | undefined): ExerciseMediaRecord | null => {
    if (!id) return null
    const rec = pack.records[resolveExerciseId(id, aliases)] ?? pack.records[id]
    if (!rec) return null
    if (rec.source !== pack.id) return null
    if (rec.availability === 'missing') return null
    if (!licenseAllowsRender(rec.license.status, privateCache) || !licenseAllowsRender(pack.license.status, privateCache)) return null
    // A private pack renders only from the private cache, and the private cache only holds private records.
    if (privateCache !== (rec.license.status === 'private-local')) return null
    return rec
  }
  return { pack, aliases, privateCache, lookup }
}

/** Absolute URL of a path inside the pack. Absolute http(s) paths (a remote pack) pass through. */
export function packUrl(pack: Pick<MediaPack, 'basePath'>, path: string, baseUrl: string): string {
  if (/^https?:\/\//.test(path)) return path
  const base = /^https?:\/\//.test(pack.basePath) ? pack.basePath : `${baseUrl}${pack.basePath}`
  return `${base}${path}`
}

/** Count of records that would render (what Settings may show as "N ejercicios con imagen"). */
export function renderableCount(index: MediaIndex): number {
  return Object.keys(index.pack.records).filter((id) => index.lookup(id)).length
}
