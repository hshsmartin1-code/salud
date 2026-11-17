import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react'
import { IDLE, isSwipeBlocked, swallowsClick, swipeStep, type SwipeEvent, type SwipeState } from './swipeLogic'

export { swipeStep, SWIPE } from './swipeLogic'

/**
 * Horizontal swipe navigation on one surface (pointer events). Spread the result on the element that should
 * react: it sets `touch-action: pan-y`, so vertical scrolling stays with the browser (it cancels the pointer).
 * Swipe left = `onNext`, swipe right = `onPrev`. Mouse, screen edges, inputs, horizontally scrollable areas and
 * `[data-no-swipe]` are left alone (see swipeLogic).
 */
export function useSwipeNav({ onPrev, onNext, enabled = true }: { onPrev: () => void; onNext: () => void; enabled?: boolean }) {
  const state = useRef<SwipeState>(IDLE)
  const firedAt = useRef<number | null>(null)
  const feed = useCallback(
    (e: SwipeEvent) => {
      const out = swipeStep(state.current, e)
      state.current = out.state
      if (out.fire) firedAt.current = performance.now()
      if (out.fire === 'next') onNext()
      else if (out.fire === 'prev') onPrev()
    },
    [onNext, onPrev],
  )
  if (!enabled) return {}
  return {
    style: { touchAction: 'pan-y' } as const,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      feed({
        type: 'down', x: e.clientX, y: e.clientY, t: e.timeStamp, pointerType: e.pointerType,
        blocked: isSwipeBlocked(e.target as Element, e.currentTarget), viewportWidth: window.innerWidth,
      })
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (state.current.phase === 'tracking') feed({ type: 'move', x: e.clientX, y: e.clientY, t: e.timeStamp })
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (state.current.phase === 'tracking') feed({ type: 'up', x: e.clientX, y: e.clientY, t: e.timeStamp })
    },
    onPointerCancel() {
      feed({ type: 'cancel' })
    },
    /** A new touch is a new gesture: only the click that belongs to the swipe itself is ever swallowed. */
    onPointerDownCapture() {
      firedAt.current = null
    },
    /** A swipe that started on a row must not also open that row. */
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!swallowsClick(firedAt.current, performance.now())) return
      firedAt.current = null
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
