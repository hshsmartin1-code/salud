/**
 * Exercise media model (stage A). One record per exercise id, grouped in ONE media pack. The app renders
 * media from exactly one active pack, never a mix of styles. See the project notes.
 */
export type MediaAvailability = 'bundled' | 'remote' | 'missing'
/** `private-local`: media the owner holds on the device only (Cache Storage); never bundled, never distributed. */
export type LicenseStatus = 'licensed' | 'free-with-attribution' | 'pending' | 'unlicensed' | 'private-local'
export type StillFormat = 'webp' | 'png' | 'jpg' | 'avif' | 'svg'
export type AnimationFormat = 'mp4' | 'webm' | 'webp' | 'gif'
export type PoseKey = 'start' | 'peak' | 'main'

export interface MediaLicense {
  status: LicenseStatus
  attribution?: string
  url?: string
}

export interface StillImage {
  /** Path relative to the pack's basePath. */
  src: string
  width: number
  height: number
  format: StillFormat
  pose?: PoseKey
}

export interface MediaAnimation {
  /** Path relative to the pack's basePath. */
  src: string
  format: AnimationFormat
  width: number
  height: number
  durationMs?: number
  /** Still shown before play, with reduced motion and while loading. Relative to basePath. */
  poster: string
}

export interface ExerciseMediaRecord {
  exerciseId: string
  /** Square thumbnail used by every list surface (thumbnails are always static). */
  thumb: StillImage
  /** One or two stills (start / end poses). Empty when the record is animation-only. */
  images: StillImage[]
  animation?: MediaAnimation
  /** Pack id this record belongs to. A record whose source is not the active pack is treated as missing. */
  source: string
  license: MediaLicense
  version: number
  availability: MediaAvailability
  /** Accessible description base (English name of the movement). */
  label?: string
  /** True when the illustration shows an equivalent exercise, not exactly this one. */
  approximate?: boolean
}

export interface MediaPack {
  id: string
  style: string
  /** Pack level attribution, shown wherever the detail variant shows media. */
  attribution: string
  attributionUrl?: string
  license: MediaLicense
  version: number
  /** Folder (relative to the app base) that every record path hangs from. */
  basePath: string
  records: Record<string, ExerciseMediaRecord>
}

/** Native on-disk format for a stage B pack (public/data/exercise-media.json or a remote manifest). */
export interface MediaPackFile {
  format: 'pho-media-pack'
  version: 1
  pack: Omit<MediaPack, 'records'>
  records: Record<string, ExerciseMediaRecord>
}
