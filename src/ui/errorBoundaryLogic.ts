/**
 * Pure helpers for the React error boundaries (src/ui/ErrorBoundary.tsx).
 * A lazy chunk that fails to load (after an app update the old hashed files 404) is not a data
 * problem: one automatic reload fetches the new index and fixes it. It is guarded so a chunk that
 * stays broken can never put the app in a reload loop.
 */
export const CHUNK_RELOAD_KEY = 'salud-chunk-reload-at'
/** A second automatic reload inside this window is refused (loop guard). */
export const CHUNK_RELOAD_WINDOW_MS = 30_000

const CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
  /Loading (?:CSS )?chunk [\w-]+ failed/i,
]

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown; message?: unknown }
  const text = `${typeof e.name === 'string' ? e.name : ''}: ${typeof e.message === 'string' ? e.message : ''}`
  return CHUNK_PATTERNS.some((p) => p.test(text))
}

type FlagStore = Pick<Storage, 'getItem' | 'setItem'>

/**
 * True (and records the attempt) when this chunk error should trigger one automatic reload.
 * Storage may be unavailable (private mode): then we do NOT reload, since the loop could not be guarded.
 */
export function claimChunkReload(error: unknown, store: FlagStore | null, now = Date.now()): boolean {
  if (!isChunkLoadError(error) || !store) return false
  try {
    const last = Number(store.getItem(CHUNK_RELOAD_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false
    store.setItem(CHUNK_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}
