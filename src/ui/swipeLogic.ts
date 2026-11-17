/**
 * Pure horizontal-swipe recogniser (no DOM). Fed with pointer samples, it says when a gesture is a swipe.
 * - Direction locks after ~10 px of travel: horizontal only when |dx| > 1.5 x |dy|, otherwise the gesture is
 *   vertical (scrolling) and is ignored until the pointer lifts.
 * - Fires on release: at >= 64 px, or a fast flick (>= 0.5 px/ms over at least 30 px).
 * - Ignores mice, gestures that start within 24 px of either screen edge (the Android back gesture) and gestures
 *   the caller marks as blocked (inputs, horizontally scrollable areas, [data-no-swipe]).
 * - A cancelled pointer never fires.
 */
export interface SwipeConfig {
  lockPx: number
  ratio: number
  distancePx: number
  flickPxPerMs: number
  flickMinPx: number
  edgePx: number
}
export const SWIPE: SwipeConfig = { lockPx: 10, ratio: 1.5, distancePx: 64, flickPxPerMs: 0.5, flickMinPx: 30, edgePx: 24 }

export type SwipeDirection = 'next' | 'prev'
export type SwipeState =
  | { phase: 'idle' }
  | { phase: 'tracking'; x0: number; y0: number; t0: number; lock: 'none' | 'h' | 'v' }

export type SwipeEvent =
  | { type: 'down'; x: number; y: number; t: number; pointerType: string; blocked: boolean; viewportWidth: number }
  | { type: 'move'; x: number; y: number; t: number }
  | { type: 'up'; x: number; y: number; t: number }
  | { type: 'cancel' }

export const IDLE: SwipeState = { phase: 'idle' }

/** One step: the next state and, on release, the direction to navigate (swipe left = next, right = previous). */
export function swipeStep(state: SwipeState, e: SwipeEvent, cfg: SwipeConfig = SWIPE): { state: SwipeState; fire: SwipeDirection | null } {
  if (e.type === 'cancel') return { state: IDLE, fire: null }
  if (e.type === 'down') {
    const ok = e.pointerType !== 'mouse' && !e.blocked && e.x >= cfg.edgePx && e.x <= e.viewportWidth - cfg.edgePx
    return { state: ok ? { phase: 'tracking', x0: e.x, y0: e.y, t0: e.t, lock: 'none' } : IDLE, fire: null }
  }
  if (state.phase !== 'tracking') return { state, fire: null }
  const dx = e.x - state.x0
  const dy = e.y - state.y0
  if (e.type === 'move') {
    if (state.lock !== 'none') return { state, fire: null }
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cfg.lockPx) return { state, fire: null }
    return { state: { ...state, lock: Math.abs(dx) > cfg.ratio * Math.abs(dy) ? 'h' : 'v' }, fire: null }
  }
  // up
  let lock = state.lock
  if (lock === 'none' && Math.max(Math.abs(dx), Math.abs(dy)) >= cfg.lockPx) lock = Math.abs(dx) > cfg.ratio * Math.abs(dy) ? 'h' : 'v'
  const horizontal = lock === 'h' && Math.abs(dx) > cfg.ratio * Math.abs(dy)
  const dt = Math.max(1, e.t - state.t0)
  const far = Math.abs(dx) >= cfg.distancePx
  const flick = Math.abs(dx) >= cfg.flickMinPx && Math.abs(dx) / dt >= cfg.flickPxPerMs
  return { state: IDLE, fire: horizontal && (far || flick) ? (dx < 0 ? 'next' : 'prev') : null }
}

/** After a swipe fired, the click some browsers still deliver to the element under the finger is swallowed for this long. */
export const SWIPE_CLICK_GUARD_MS = 400
/** True while a click must be ignored because it belongs to the gesture that just changed the day. */
export const swallowsClick = (firedAt: number | null, now: number): boolean => firedAt !== null && now >= firedAt && now - firedAt < SWIPE_CLICK_GUARD_MS

/** True when an element (or an ancestor up to `root`) must keep its own pointer behaviour. */
export function isSwipeBlocked(target: Element | null, root: Element | null): boolean {
  // A portal (menu sheet, dialog) bubbles its pointer events through React to the surface: those are not ours.
  if (root && target && !root.contains(target)) return true
  for (let el: Element | null = target; el; el = el.parentElement) {
    // Rows are buttons and stay swipeable (most of a diary is rows); small controls opt out with [data-no-swipe].
    if (el.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe]')) return true
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    if (el === root) break
  }
  return false
}
