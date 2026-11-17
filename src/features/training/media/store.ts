/**
 * Loads the media manifest once (on first use, never at app start) and exposes it in the shape the
 * existing call sites already consume (`media.items[id]`), plus the pack index that does the real
 * resolution (aliases, licence, active pack).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { loadExerciseAliases, type ExerciseAliases } from '../exerciseKnowledge'
import { createMediaIndex, packFromManifest, type MediaIndex } from './manifest'
import { getPrivateSnapshot, loadPrivateState, subscribePrivate, type PrivateSnapshot } from './privateStore'
import type { PoseKey } from './types'

export interface ExerciseMedia {
  /** Catalog id of the exercise this item belongs to (set by the loader). */
  exerciseId?: string
  repdbId: string
  confidence: 'high' | 'medium'
  thumb: string
  images: string[]
  poses: PoseKey[]
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
  /** Only records that are allowed to render (active pack, licensed). */
  items: Record<string, ExerciseMedia>
  /** The single active pack and its lookup. */
  index?: MediaIndex
}

/** Projects the active pack to the legacy shape so existing call sites keep working unchanged. */
export function toExerciseMediaFile(index: MediaIndex): ExerciseMediaFile {
  const { pack } = index
  const items: Record<string, ExerciseMedia> = {}
  for (const id of Object.keys(pack.records)) {
    const r = index.lookup(id)
    if (!r) continue
    items[id] = {
      exerciseId: id,
      repdbId: id,
      confidence: r.approximate ? 'medium' : 'high',
      thumb: r.thumb.src,
      images: r.images.map((i) => i.src),
      poses: r.images.map((i) => i.pose ?? 'main'),
      nameEn: r.label ?? '',
    }
  }
  return {
    format: 'pho-exercise-media',
    version: pack.version,
    attribution: pack.attribution,
    attributionUrl: pack.attributionUrl ?? '',
    licenseUrl: pack.license.url ?? '',
    sourceCommit: '',
    basePath: pack.basePath,
    items,
    index,
  }
}

// ───────────── the ONE active pack ─────────────
// The private pack when it is imported AND switched on; otherwise the bundled one. Never a mix: while the
// private pack is active an exercise it does not cover gets the anatomical view, not a bundled illustration.
let bundled: ExerciseMediaFile | null = null
let aliasesCache: ExerciseAliases = {}
let active: ExerciseMediaFile | null = null
let activeKey = ''
const listeners = new Set<() => void>()

/** Pure: which pack is active for a given private state (exported for tests). */
export function pickActiveSource(priv: Pick<PrivateSnapshot, 'status' | 'pack' | 'active'>): 'private' | 'bundled' {
  return priv.status === 'ready' && priv.pack && priv.active ? 'private' : 'bundled'
}

function recompute() {
  const priv = getPrivateSnapshot()
  const source = pickActiveSource(priv)
  const key = `${source}:${source === 'private' ? priv.pack?.id : bundled?.index?.pack.id}:${bundled ? 1 : 0}`
  if (key === activeKey) return
  activeKey = key
  active = source === 'private' && priv.pack ? toExerciseMediaFile(createMediaIndex(priv.pack, aliasesCache, { privateCache: true })) : bundled
  for (const l of listeners) l()
}
subscribePrivate(recompute)

let mediaPromise: Promise<ExerciseMediaFile | null> | null = null

/** Loads the bundled manifest and the private cache once (on first use, never at app start). Resolves to the active pack. */
export function loadExerciseMedia(): Promise<ExerciseMediaFile | null> {
  if (!mediaPromise) {
    const base = import.meta.env.BASE_URL
    const priv = loadPrivateState()
    mediaPromise = fetch(`${base}data/exercise-media.json`)
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then(async (raw) => {
        const pack = packFromManifest(raw)
        aliasesCache = await loadExerciseAliases(base)
        bundled = pack ? toExerciseMediaFile(createMediaIndex(pack, aliasesCache)) : null
        await priv
        activeKey = ''
        recompute()
        return active
      })
      .catch(async () => {
        // Offline before the first load of the bundled manifest: the private pack can still be served.
        await priv
        activeKey = ''
        recompute()
        if (!active) mediaPromise = null // try again next time
        return active
      })
  }
  return mediaPromise
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Media of the active pack (null while loading or when unavailable: callers show the anatomical view). */
export function useExerciseMedia(): ExerciseMediaFile | null {
  const m = useSyncExternalStore(subscribe, () => active, () => null)
  useEffect(() => {
    if (!mediaPromise) void loadExerciseMedia()
  }, [])
  return m
}
