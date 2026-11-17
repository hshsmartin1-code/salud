/**
 * Bottom bars fixed above the mobile navigation publish their height here; the sum goes to
 * `--dock-inset` on <html> (the toast host adds it to its bottom offset, see index.css), and the
 * "Sesión en curso" bar's own height to `--session-bar-inset` (a DockBar stacks above it).
 * The global update notice ('update') sits above every other bar: it adds to `--dock-inset` (toasts rise above it) but
 * not to `--dock-inset-base` (where it stands itself), and its height alone goes to `--update-banner-inset`, which
 * the page padding adds so the last line of a page is never hidden behind it.
 * A source of 0/null is removed; with nothing registered all the variables are cleared.
 */
export type DockSource = 'dock' | 'session' | 'update'
const parts = new Map<string, number>()

function apply() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  let sum = 0
  for (const v of parts.values()) sum += v
  const banner = parts.get('update') ?? 0
  if (sum > 0) root.style.setProperty('--dock-inset', `${sum}px`)
  else root.style.removeProperty('--dock-inset')
  if (sum - banner > 0) root.style.setProperty('--dock-inset-base', `${sum - banner}px`)
  else root.style.removeProperty('--dock-inset-base')
  if (banner > 0) root.style.setProperty('--update-banner-inset', `${banner}px`)
  else root.style.removeProperty('--update-banner-inset')
  const session = parts.get('session') ?? 0
  if (session > 0) root.style.setProperty('--session-bar-inset', `${session}px`)
  else root.style.removeProperty('--session-bar-inset')
}

export function setDockInset(source: DockSource, px: number | null): void {
  if (px && px > 0) parts.set(source, Math.round(px))
  else parts.delete(source)
  apply()
}

/** Keeps `source` equal to the element's rendered height (0 while hidden, e.g. lg:hidden). */
export function observeDockInset(source: DockSource, node: HTMLElement): () => void {
  const set = () => setDockInset(source, node.offsetHeight)
  set()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
  ro?.observe(node)
  const mq = typeof window !== 'undefined' ? window.matchMedia?.('(min-width: 1024px)') : undefined
  mq?.addEventListener?.('change', set)
  return () => {
    ro?.disconnect()
    mq?.removeEventListener?.('change', set)
    setDockInset(source, null)
  }
}
