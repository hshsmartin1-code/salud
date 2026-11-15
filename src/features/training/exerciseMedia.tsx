/**
 * Exercise illustrations (RepDB, free tier: in-app use with visible attribution). Image metadata lives in
 * its own file (public/data/exercise-media.json), keyed by our `fedb:` ids, so the exercise catalog and
 * its ids are untouched. Only conservative matches are shipped; anything else shows a neutral fallback.
 */
import { useEffect, useState } from 'react'
import { Icon } from '../../ui/Icon'

export interface ExerciseMedia {
  repdbId: string
  confidence: 'high' | 'medium'
  thumb: string
  images: string[]
  poses: ('start' | 'peak' | 'main')[]
  nameEn: string
  instructionsEs?: string[]
}

export interface ExerciseMediaFile {
  format: 'pho-exercise-media'
  version: number
  attribution: string
  attributionUrl: string
  licenseUrl: string
  sourceCommit: string
  basePath: string
  items: Record<string, ExerciseMedia>
}

export const REPDB_ATTRIBUTION = 'Exercise data by RepDB (repdb.co)'
export const REPDB_URL = 'https://repdb.co'
export const POSE_LABEL: Record<'start' | 'peak' | 'main', string> = { start: 'Inicio', peak: 'Final del movimiento', main: 'Posición' }

let mediaPromise: Promise<ExerciseMediaFile | null> | null = null
let mediaCache: ExerciseMediaFile | null = null

export function loadExerciseMedia(): Promise<ExerciseMediaFile | null> {
  if (!mediaPromise) {
    mediaPromise = fetch(`${import.meta.env.BASE_URL}data/exercise-media.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ExerciseMediaFile>) : null))
      .then((f) => {
        mediaCache = f && f.format === 'pho-exercise-media' ? f : null
        return mediaCache
      })
      .catch(() => {
        mediaPromise = null // offline before first load: try again next time
        return null
      })
  }
  return mediaPromise
}

/** Media index (null while loading or when unavailable: callers show the fallback). */
export function useExerciseMedia(): ExerciseMediaFile | null {
  const [m, setM] = useState<ExerciseMediaFile | null>(mediaCache)
  useEffect(() => {
    if (mediaCache) return
    let alive = true
    void loadExerciseMedia().then((f) => {
      if (alive) setM(f)
    })
    return () => {
      alive = false
    }
  }, [])
  return m
}

export function mediaSrc(file: ExerciseMediaFile, name: string): string {
  return `${import.meta.env.BASE_URL}${file.basePath}${name}`
}

/** Square thumbnail; neutral icon tile when there is no illustration or it fails to load. */
export function ExerciseThumb({ media, item, size = 44 }: { media: ExerciseMediaFile | null; item: ExerciseMedia | undefined; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size }
  if (!media || !item || failed) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-surface2 text-faint" style={style} data-testid="exercise-thumb-fallback" aria-hidden>
        <Icon name="dumbbell" size={Math.round(size * 0.45)} />
      </span>
    )
  }
  return (
    <img
      src={mediaSrc(media, item.thumb)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-lg bg-[#dbe9f5] object-cover"
      style={style}
      data-testid="exercise-thumb"
    />
  )
}

/** Start / end poses (or a single pose) with the required RepDB credit; fallback panel otherwise. */
export function ExerciseIllustration({ media, item }: { media: ExerciseMediaFile | null; item: ExerciseMedia | undefined }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  if (!media || !item || item.images.every((i) => failed[i])) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-3 text-sm text-muted" data-testid="exercise-illustration-fallback">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface2 text-faint">
          <Icon name="image" size={20} />
        </span>
        Sin ilustración verificada para este ejercicio. Guíate por las instrucciones.
      </div>
    )
  }
  return (
    <figure className="space-y-1.5" data-testid="exercise-illustration">
      <div className={`grid gap-2 ${item.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1 sm:w-1/2'}`}>
        {item.images.map((img, i) =>
          failed[img] ? null : (
            <div key={img} className="overflow-hidden rounded-xl border border-line bg-[#dbe9f5]">
              <img
                src={mediaSrc(media, img)}
                alt={`${POSE_LABEL[item.poses[i] ?? 'main']}: ilustración de ${item.nameEn}`}
                width={512}
                height={512}
                loading="lazy"
                decoding="async"
                className="block aspect-square w-full object-contain"
                onError={() => setFailed((f) => ({ ...f, [img]: true }))}
              />
              <div className="border-t border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted">{POSE_LABEL[item.poses[i] ?? 'main']}</div>
            </div>
          ),
        )}
      </div>
      <figcaption className="text-[11px] text-faint">
        {item.confidence === 'medium' ? 'Ilustración de un ejercicio equivalente. ' : ''}
        <a href={REPDB_URL} target="_blank" rel="noopener nofollow" className="underline underline-offset-2 hover:text-ink">
          {REPDB_ATTRIBUTION}
        </a>
      </figcaption>
    </figure>
  )
}
