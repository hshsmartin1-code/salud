/**
 * The one component every exercise-media surface goes through (`ExerciseThumb` and `ExerciseIllustration`
 * are thin wrappers). Every thumbnail is the same anatomical close-up (AnatomyThumb), whatever the pack.
 * The detail variant shows the ACTIVE pack's media (an animation, or the two poses Inicio / Final) and,
 * when the pack has nothing for the exercise or a file is missing or broken, the large anatomical view.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from '../../../ui/Icon'
import { Sheet } from '../../../ui/kit'
import { loadExerciseCatalog } from '../exercises'
import { AnatomyThumb } from './AnatomyThumb'
import { type TileExercise } from './Placeholder'
import { packUrl } from './manifest'
import { privateFileUrl } from './privateStore'
import type { ExerciseMedia, ExerciseMediaFile } from './store'
import type { ExerciseMediaRecord, MediaAnimation, MediaPack, PoseKey, StillImage } from './types'

export const POSE_LABEL: Record<PoseKey, string> = { start: 'Inicio', peak: 'Final', main: 'Posición' }
const PLATE = 'bg-[rgb(var(--media-plate))]'
const BASE = () => import.meta.env.BASE_URL

export interface ExerciseMediaViewProps {
  variant: 'thumb' | 'detail'
  media: ExerciseMediaFile | null
  /** Catalog id. Resolved through the alias map; when omitted the id of `item` is used. */
  exerciseId?: string
  /** Legacy lookup result (`media.items[id]`), kept so existing call sites work unchanged. */
  item?: ExerciseMedia
  /** Thumb: side in px. */
  size?: number
  exercise?: TileExercise
  muscle?: string
  equipment?: string
}

// ───────────── small hooks ─────────────
function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(query)
    const h = () => setOn(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return on
}
const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')

function usePageVisible(): boolean {
  const [v, setV] = useState(() => (typeof document === 'undefined' ? true : !document.hidden))
  useEffect(() => {
    const h = () => setV(!document.hidden)
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])
  return v
}

function useInView(ref: React.RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return inView
}

// ───────────── muscles of an exercise known only by id ─────────────
type MuscleSet = { primary: readonly string[]; secondary: readonly string[] }
let catalogMuscles: Map<string, MuscleSet> | null = null
let catalogAsked = false
const catalogListeners = new Set<() => void>()
function askCatalog() {
  if (catalogAsked) return
  catalogAsked = true
  void loadExerciseCatalog()
    .then((c) => {
      catalogMuscles = new Map(c.list.map((e) => [e.id, { primary: e.primaryMuscles, secondary: e.secondaryMuscles }]))
      for (const l of catalogListeners) l()
    })
    .catch(() => {
      catalogAsked = false
    })
}
const subscribeCatalog = (l: () => void) => {
  catalogListeners.add(l)
  askCatalog()
  return () => catalogListeners.delete(l)
}

// ───────────── thumb: always the anatomical close-up ─────────────
function LookupThumb({ id, size }: { id: string | undefined; size: number }) {
  const m = useSyncExternalStore(subscribeCatalog, () => catalogMuscles, () => null)
  const found = id ? m?.get(id) : undefined
  return <AnatomyThumb primaryMuscles={found?.primary} secondaryMuscles={found?.secondary} size={size} />
}

function Thumb({ size, exercise, id }: { size: number; exercise?: TileExercise; id?: string }) {
  if (exercise?.primaryMuscles) return <AnatomyThumb primaryMuscles={exercise.primaryMuscles} secondaryMuscles={exercise.secondaryMuscles} size={size} />
  // Callers that only know the id (history rows) get the muscles from the catalog. Custom exercises always carry theirs.
  return <LookupThumb id={id} size={size} />
}

// ───────────── detail: placeholder, poses, player ─────────────
/** No media from the active pack for this exercise (or it failed): the large anatomical view with the muscles. */
function DetailPlaceholder({ exercise, muscle, equipment, note }: { exercise?: TileExercise; muscle?: string; equipment?: string; note?: string }) {
  return (
    <div className="flex items-center gap-4" data-testid="exercise-illustration-fallback">
      <AnatomyThumb primaryMuscles={exercise?.primaryMuscles} secondaryMuscles={exercise?.secondaryMuscles} size={112} testId="exercise-tile" />
      <div className="min-w-0 text-label text-muted">
        <p className="text-body font-medium text-ink">{[muscle, equipment].filter(Boolean).join(' · ')}</p>
        <p className="mt-0.5">{note ?? 'Sin ilustración en el paquete activo. Guíate por las instrucciones y el mapa muscular.'}</p>
      </div>
    </div>
  )
}

/** Resolves a file of the active pack to a URL: bundled files are plain URLs, private ones come from the private cache. */
function useAsset(pack: MediaPack, path: string, priv: boolean): { url: string | null; missing: boolean } {
  const direct = priv ? null : packUrl(pack, path, BASE())
  const [state, setState] = useState<{ path: string; url: string | null; done: boolean }>({ path: '', url: null, done: false })
  useEffect(() => {
    if (!priv) return
    let alive = true
    void privateFileUrl(path).then((u) => alive && setState({ path, url: u, done: true }))
    return () => {
      alive = false
    }
  }, [priv, path])
  if (!priv) return { url: direct, missing: false }
  const mine = state.path === path
  return { url: mine ? state.url : null, missing: mine && state.done && state.url === null }
}

function PoseImage({ img, pack, priv, label, onFail }: { img: StillImage; pack: MediaPack; priv: boolean; label: string; onFail: () => void }) {
  const { url, missing } = useAsset(pack, img.src, priv)
  useEffect(() => {
    if (missing) onFail()
  }, [missing, onFail])
  return (
    <div className={`overflow-hidden rounded-xl ${PLATE}`}>
      {url ? (
        <img
          src={url}
          alt={`${POSE_LABEL[img.pose ?? 'main']}: ilustración de ${label}`}
          width={img.width}
          height={img.height}
          loading="lazy"
          decoding="async"
          className="block aspect-square w-full object-contain"
          onError={onFail}
        />
      ) : (
        <div className="aspect-square w-full" />
      )}
      <div className="bg-surface px-2 py-1 text-label font-medium text-muted">{POSE_LABEL[img.pose ?? 'main']}</div>
    </div>
  )
}

function Poses({ record, pack, priv, onAllFailed }: { record: ExerciseMediaRecord; pack: MediaPack; priv: boolean; onAllFailed: () => void }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const allFailed = record.images.length === 0 || record.images.every((i) => failed[i.src])
  useEffect(() => {
    if (allFailed) onAllFailed()
  }, [allFailed, onAllFailed])
  return (
    <div className={`grid gap-2 ${record.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1 sm:w-1/2'}`} data-testid="exercise-poses">
      {record.images.map((img) =>
        failed[img.src] ? null : <PoseImage key={img.src} img={img} pack={pack} priv={priv} label={record.label ?? 'el ejercicio'} onFail={() => setFailed((f) => (f[img.src] ? f : { ...f, [img.src]: true }))} />,
      )}
    </div>
  )
}

const OVERLAY_BTN =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full bg-[rgb(8_12_16/0.66)] px-3 text-label font-medium text-white outline-none hover:bg-[rgb(8_12_16/0.8)] focus-visible:ring-2 focus-visible:ring-accent'

function AnimationPlayer({ anim, pack, priv, label, suspended = false, onZoom, onBroken }: { anim: MediaAnimation; pack: MediaPack; priv: boolean; label: string; suspended?: boolean; onZoom?: () => void; onBroken?: () => void }) {
  const reduced = useReducedMotion()
  const pageVisible = usePageVisible()
  const box = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inView = useInView(box)
  const [wants, setWants] = useState(!reduced)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (reduced) setWants(false)
  }, [reduced])
  const active = wants && inView && pageVisible && !suspended
  const isVideo = anim.format === 'mp4' || anim.format === 'webm'
  const srcAsset = useAsset(pack, anim.src, priv)
  const posterAsset = useAsset(pack, anim.poster, priv)
  const src = srcAsset.url ?? ''
  const poster = posterAsset.url ?? ''
  const ready = !!srcAsset.url && !!posterAsset.url
  const broken = srcAsset.missing || posterAsset.missing
  // A private pack never shows a broken player: the screen falls back to the anatomical view.
  useEffect(() => {
    if (priv && broken) onBroken?.()
  }, [priv, broken, onBroken])

  useEffect(() => {
    if (!isVideo) {
      if (active) setPhase((p) => (p === 'ready' || p === 'error' ? p : 'loading'))
      return
    }
    const v = videoRef.current
    if (!v) return
    if (active) {
      setPhase((p) => (p === 'ready' || p === 'error' ? p : 'loading'))
      v.play().catch((reason: unknown) => {
        // Ignore a rejected promise from an element replaced by Retry or a normal pause.
        if (v !== videoRef.current) return
        const name = reason && typeof reason === 'object' && 'name' in reason ? reason.name : undefined
        if (name === 'AbortError') return
        if (name === 'NotAllowedError') {
          setPhase((p) => p === 'error' ? p : 'idle')
          setWants(false)
        } else {
          // A missing or unsupported source may reject play before the media error event arrives.
          setPhase('error')
          setVideoPlaying(false)
        }
      })
    } else v.pause()
  }, [active, isVideo, attempt, ready])

  const retry = () => {
    setPhase('idle')
    setVideoPlaying(false)
    setAttempt((a) => a + 1)
    setWants(true)
  }
  const error = phase === 'error'
  const playing = isVideo ? active && videoPlaying : active && phase === 'ready'
  const status = playing ? 'Animación en reproducción' : 'Animación en pausa'
  return (
    <div
      ref={box}
      className={`relative mx-auto w-full overflow-hidden rounded-xl ${PLATE}`}
      style={{ aspectRatio: `${anim.width} / ${anim.height}`, maxWidth: 'min(100%, 28rem)' }}
      data-testid="exercise-animation"
      data-playing={playing && !error ? 'true' : 'false'}
    >
      {!ready ? (
        <div role="status" className="skeleton absolute inset-0 opacity-60">
          <span className="sr-only">Cargando animación</span>
        </div>
      ) : isVideo ? (
        <video
          key={attempt}
          ref={videoRef}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          width={anim.width}
          height={anim.height}
          aria-label={`Animación de ${label}`}
          className="block h-full w-full object-contain"
          onPlaying={() => { setPhase('ready'); setVideoPlaying(true) }}
          onPause={() => setVideoPlaying(false)}
          onWaiting={() => { setPhase((p) => (p === 'error' ? p : 'loading')); setVideoPlaying(false) }}
          onError={() => { setPhase('error'); setVideoPlaying(false); if (priv) onBroken?.() }}
        />
      ) : (
        <img
          key={attempt}
          src={active ? src : poster}
          alt={`Animación de ${label}`}
          width={anim.width}
          height={anim.height}
          decoding="async"
          className="block h-full w-full object-contain"
          onLoad={() => setPhase((p) => (p === 'error' ? p : 'ready'))}
          onError={() => { setPhase('error'); if (priv) onBroken?.() }}
        />
      )}
      {phase === 'loading' && !error ? (
        <div role="status" className="skeleton absolute inset-0 opacity-60" data-testid="exercise-animation-loading">
          <span className="sr-only">Cargando animación</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/90 px-4 text-center" data-testid="exercise-animation-error">
          <p className="text-label text-ink">No se pudo cargar la animación.</p>
          <button type="button" onClick={retry} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-4 text-label font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <Icon name="refresh" size={16} />
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="absolute bottom-1.5 left-1.5">
            <button
              type="button"
              className={OVERLAY_BTN}
              aria-label={wants ? 'Pausar animación' : 'Reproducir animación'}
              onClick={() => setWants((w) => !w)}
              data-testid="exercise-animation-toggle"
            >
              <Icon name={wants ? 'pause' : 'play'} size={18} />
            </button>
          </div>
          {onZoom ? (
            <div className="absolute right-1.5 top-1.5">
              <button type="button" className={OVERLAY_BTN} onClick={onZoom} data-testid="exercise-animation-zoom">
                Ampliar
              </button>
            </div>
          ) : null}
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}

function Detail({ record, pack, priv, exercise, muscle, equipment }: { record: ExerciseMediaRecord | null; pack: MediaPack | null; priv: boolean; exercise?: TileExercise; muscle?: string; equipment?: string }) {
  const [zoom, setZoom] = useState(false)
  const [posesFailed, setPosesFailed] = useState(false)
  const [broken, setBroken] = useState(false)
  const failAll = useCallback(() => setPosesFailed(true), [])
  const onBroken = useCallback(() => setBroken(true), [])
  if (priv && broken) return <DetailPlaceholder exercise={exercise} muscle={muscle} equipment={equipment} note="No se pudo leer un archivo del paquete privado. Se muestra el mapa muscular." />
  if (!record || !pack) return <DetailPlaceholder exercise={exercise} muscle={muscle} equipment={equipment} note={priv ? 'El paquete privado activo no incluye este ejercicio. Guíate por las instrucciones y el mapa muscular.' : undefined} />
  const anim = record.animation
  if (!anim && (posesFailed || record.images.length === 0)) return <DetailPlaceholder exercise={exercise} muscle={muscle} equipment={equipment} note={priv ? 'No se pudo leer un archivo del paquete privado. Se muestra el mapa muscular.' : undefined} />
  const label = record.label ?? 'el ejercicio'
  const attribution = record.license.attribution ?? pack.attribution
  return (
    <figure className="space-y-1.5" data-testid="exercise-illustration">
      {anim ? <AnimationPlayer anim={anim} pack={pack} priv={priv} label={label} suspended={zoom} onZoom={() => setZoom(true)} onBroken={onBroken} /> : <Poses record={record} pack={pack} priv={priv} onAllFailed={failAll} />}
      <figcaption className="text-micro text-muted" data-testid="exercise-attribution">
        {record.approximate ? 'Ilustración de un ejercicio equivalente. ' : ''}
        {pack.attributionUrl ? (
          <a href={pack.attributionUrl} target="_blank" rel="noopener nofollow" className="hit-44 underline underline-offset-2 hover:text-ink">
            {attribution}
          </a>
        ) : (
          attribution
        )}
      </figcaption>
      {anim ? (
        <Sheet open={zoom} onClose={() => setZoom(false)} title="Ilustración del ejercicio" wide>
          <div className="space-y-2 pb-2" data-testid="exercise-animation-large">
            <AnimationPlayer anim={anim} pack={pack} priv={priv} label={label} />
            <p className="text-micro text-muted">{attribution}</p>
          </div>
        </Sheet>
      ) : null}
    </figure>
  )
}

export function ExerciseMediaView({ variant, media, exerciseId, item, size = 44, exercise, muscle, equipment }: ExerciseMediaViewProps) {
  const id = exerciseId ?? item?.exerciseId
  if (variant === 'thumb') return <Thumb size={size} exercise={exercise} id={id} />
  const index = media?.index
  const record = index && id ? index.lookup(id) : null
  const pack = index?.pack ?? null
  return <Detail key={`${id ?? 'none'}:${pack?.id ?? ''}`} record={record} pack={pack} priv={index?.privateCache === true} exercise={exercise} muscle={muscle} equipment={equipment} />
}
