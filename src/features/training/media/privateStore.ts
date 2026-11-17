/**
 * Device-private media pack. ONE Cache Storage cache (`salud-private-media`) holds the validated manifest,
 * the media files and two small bookkeeping entries (`state.json`, `meta.json`). Nothing goes to Dexie,
 * so nothing is synced or backed up; the cache survives app updates and works offline (Android WebView
 * included). Files are shown through short-lived blob URLs made from the cache.
 *
 * Import order: the old cache is dropped, the files are written, the manifest is written LAST. A cache
 * without a manifest is not a pack, so an interrupted import leaves nothing usable behind.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_ZIP_LIMITS, readZipDirectory, readZipEntry, ZipError, type ZipEntry, type ZipLimits, type ZipSource } from './zip'
import { disallowedEntries, MAX_MANIFEST_BYTES, mimeOf, PRIVATE_MANIFEST_NAME, validatePrivateManifest, type PrivateValidation } from './privateManifest'
import type { MediaPack } from './types'

export const PRIVATE_CACHE = 'salud-private-media'
const ROOT = '/__salud-private__/'
const STATE_KEY = 'state.json'
const META_KEY = 'meta.json'

export type PrivateStatus = 'none' | 'ready' | 'corrupt' | 'unavailable'
export interface PrivateSnapshot {
  /** false until the cache has been read once. */
  loaded: boolean
  status: PrivateStatus
  pack: MediaPack | null
  /** Switched on by the person: the store then serves ONLY this pack. */
  active: boolean
  /** Why the pack is disabled (corrupt manifest) or unavailable. */
  error: string | null
  bytes: number
  files: number
}
const EMPTY: PrivateSnapshot = { loaded: false, status: 'none', pack: null, active: false, error: null, bytes: 0, files: 0 }

let snap: PrivateSnapshot = EMPTY
const listeners = new Set<() => void>()
function set(next: Partial<PrivateSnapshot>) {
  snap = { ...snap, ...next }
  for (const l of listeners) l()
}
export const subscribePrivate = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getPrivateSnapshot = (): PrivateSnapshot => snap
export const usePrivatePack = (): PrivateSnapshot => useSyncExternalStore(subscribePrivate, getPrivateSnapshot, getPrivateSnapshot)

const cacheKey = (path: string) => new Request(new URL(ROOT + path.split('/').map(encodeURIComponent).join('/'), self.location.origin).href)
export const cacheAvailable = () => typeof caches !== 'undefined' && typeof caches.open === 'function'

async function readJson(cache: Cache, name: string): Promise<unknown> {
  const res = await cache.match(cacheKey(name))
  if (!res) return undefined
  return res.json() as Promise<unknown>
}
const putJson = (cache: Cache, name: string, value: unknown) =>
  cache.put(cacheKey(name), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))

let loading: Promise<PrivateSnapshot> | null = null
/** Reads the private cache once (and again after `refresh`). Never throws: a failure becomes `status`. */
export function loadPrivateState(refresh = false): Promise<PrivateSnapshot> {
  if (loading && !refresh) return loading
  loading = (async () => {
    if (!cacheAvailable()) {
      set({ ...EMPTY, loaded: true, status: 'unavailable', error: 'Este dispositivo no permite guardar medios privados.' })
      return snap
    }
    try {
      if (!(await caches.has(PRIVATE_CACHE))) {
        set({ ...EMPTY, loaded: true })
        return snap
      }
      const cache = await caches.open(PRIVATE_CACHE)
      const rawManifest = await readJson(cache, PRIVATE_MANIFEST_NAME).catch(() => null)
      if (rawManifest === undefined) {
        set({ ...EMPTY, loaded: true })
        return snap
      }
      const v = rawManifest === null ? null : validatePrivateManifest(rawManifest, null)
      const wanted = ((await readJson(cache, STATE_KEY).catch(() => null)) as { active?: boolean } | null | undefined)?.active === true
      const meta = (await readJson(cache, META_KEY).catch(() => null)) as { bytes?: number; files?: number } | null | undefined
      if (!v || !v.ok) {
        set({ loaded: true, status: 'corrupt', pack: null, active: false, error: v ? v.error : 'El manifiesto del paquete está dañado.', bytes: meta?.bytes ?? 0, files: meta?.files ?? 0 })
        return snap
      }
      set({ loaded: true, status: 'ready', pack: v.pack, active: wanted, error: null, bytes: meta?.bytes ?? 0, files: meta?.files ?? v.files.length })
    } catch (e) {
      set({ ...EMPTY, loaded: true, status: 'unavailable', error: e instanceof Error ? e.message : 'No se pudo leer el almacenamiento privado.' })
    }
    return snap
  })()
  return loading
}

/** Switches the private pack on or off (it stays on the device either way). */
export async function setPrivateActive(active: boolean): Promise<void> {
  if (snap.status !== 'ready' || !cacheAvailable()) return
  const cache = await caches.open(PRIVATE_CACHE)
  await putJson(cache, STATE_KEY, { active })
  set({ active })
}

/** Deletes the private pack and everything in its cache. */
export async function removePrivatePack(): Promise<void> {
  revokeAll()
  if (cacheAvailable()) await caches.delete(PRIVATE_CACHE)
  set({ ...EMPTY, loaded: true })
}

// ───────────── import ─────────────
export interface PackInspection {
  validation: PrivateValidation
  entries: ZipEntry[]
  /** Uncompressed bytes of the files that will be stored (manifest excluded). */
  bytes: number
  /** Files in the archive the manifest does not use (they are ignored, not stored). */
  ignored: number
}

/** Reads the archive's directory and manifest and validates everything against it; writes nothing. */
export async function inspectPackZip(file: ZipSource, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<PackInspection> {
  const entries = await readZipDirectory(file, limits)
  const names = entries.map((e) => e.name)
  const wrong = disallowedEntries(names)
  if (wrong.length) throw new ZipError('bad-path', `El ZIP contiene archivos que no son imagen ni vídeo: ${wrong.slice(0, 3).join(', ')}${wrong.length > 3 ? '…' : ''}`)
  const manifestEntry = entries.find((e) => e.name === PRIVATE_MANIFEST_NAME)
  if (!manifestEntry) throw new ZipError('corrupt', 'El ZIP no contiene manifest.json en la raíz.')
  if (manifestEntry.size > MAX_MANIFEST_BYTES) throw new ZipError('file-too-large', 'El manifiesto es demasiado grande.')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readZipEntry(file, manifestEntry, limits)))
  } catch (e) {
    if (e instanceof ZipError) throw e
    throw new ZipError('corrupt', 'manifest.json no es un JSON válido.')
  }
  const v = validatePrivateManifest(raw, new Set(names))
  if (!v.ok) throw new ZipError('corrupt', v.error)
  const used = new Set(v.files)
  const bytes = entries.filter((e) => used.has(e.name)).reduce((n, e) => n + e.size, 0)
  return { validation: v, entries, bytes, ignored: entries.filter((e) => e.name !== PRIVATE_MANIFEST_NAME && !used.has(e.name)).length }
}

export interface ImportProgress {
  done: number
  total: number
  bytes: number
}

/** Writes an inspected pack into the private cache. On any failure the cache is deleted. */
export async function importPackZip(file: ZipSource, insp: PackInspection, onProgress?: (p: ImportProgress) => void, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<void> {
  if (!cacheAvailable()) throw new Error('Este dispositivo no permite guardar medios privados.')
  revokeAll()
  await caches.delete(PRIVATE_CACHE)
  const cache = await caches.open(PRIVATE_CACHE)
  try {
    const used = new Set(insp.validation.files)
    const todo = insp.entries.filter((e) => used.has(e.name))
    let bytes = 0
    for (const [i, entry] of todo.entries()) {
      const data = await readZipEntry(file, entry, limits)
      await cache.put(cacheKey(entry.name), new Response(data as BodyInit, { headers: { 'Content-Type': mimeOf(entry.name), 'Content-Length': String(data.byteLength) } }))
      bytes += data.byteLength
      onProgress?.({ done: i + 1, total: todo.length, bytes })
    }
    const manifestEntry = insp.entries.find((e) => e.name === PRIVATE_MANIFEST_NAME)!
    const manifestBytes = await readZipEntry(file, manifestEntry, limits)
    await putJson(cache, META_KEY, { bytes, files: todo.length, importedAt: Date.now() })
    await putJson(cache, STATE_KEY, { active: false })
    // The manifest goes in last: without it the cache is not a pack.
    await cache.put(cacheKey(PRIVATE_MANIFEST_NAME), new Response(manifestBytes as BodyInit, { headers: { 'Content-Type': 'application/json' } }))
  } catch (e) {
    await caches.delete(PRIVATE_CACHE).catch(() => undefined)
    set({ ...EMPTY, loaded: true })
    throw e
  }
  await loadPrivateState(true)
}

// ───────────── files as blob URLs ─────────────
const urls = new Map<string, Promise<string | null>>()
const MAX_URLS = 24

function revokeAll() {
  for (const p of urls.values()) void p.then((u) => u && URL.revokeObjectURL(u))
  urls.clear()
}

/** Blob URL of a file of the private pack, or null when it is not in the cache. Cached (small LRU). */
export function privateFileUrl(path: string): Promise<string | null> {
  const hit = urls.get(path)
  if (hit) {
    urls.delete(path)
    urls.set(path, hit)
    return hit
  }
  const p = (async () => {
    if (!cacheAvailable()) return null
    try {
      const cache = await caches.open(PRIVATE_CACHE)
      const res = await cache.match(cacheKey(path))
      if (!res) return null
      return URL.createObjectURL(await res.blob())
    } catch {
      return null
    }
  })()
  urls.set(path, p)
  if (urls.size > MAX_URLS) {
    const [oldest] = urls.keys()
    const old = urls.get(oldest!)
    urls.delete(oldest!)
    void old?.then((u) => u && URL.revokeObjectURL(u))
  }
  return p
}
