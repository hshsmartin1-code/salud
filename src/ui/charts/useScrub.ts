import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { nearestIndex } from './geometry'

/**
 * Pointer + keyboard scrubbing shared by both chart implementations (so the comparison measures rendering,
 * not event handling). The whole wrapper is the hit area.
 * - touch: down/move selects the nearest day with data; release pins it; a vertical scroll (pointercancel)
 *   restores the previous pin. The wrapper must set `touch-action: pan-y`.
 * - mouse: hover scrubs, click toggles the pinned point, leaving restores the pin.
 * - keyboard: Left/Right/Home/End move between days with data, Escape clears.
 */
export function useScrub(o: {
  enabled: boolean
  wrapRef: RefObject<HTMLElement | null>
  /** Days with data of the primary series, ascending, and their x relative to the wrapper's left edge. */
  dates: string[]
  xs: number[]
  /** Latest selection (controlled or not). */
  selected: string | null
  select: (date: string | null) => void
}) {
  const pinned = useRef<string | null>(null)
  const rect = useRef<DOMRect | null>(null)
  const sel = useRef(o.selected)
  useEffect(() => {
    sel.current = o.selected
  }, [o.selected])

  const dateAt = (clientX: number): string | null => {
    const r = rect.current ?? o.wrapRef.current?.getBoundingClientRect()
    if (!r) return null
    const i = nearestIndex(o.xs, clientX - r.left)
    return i < 0 ? null : o.dates[i]!
  }
  const set = (d: string | null) => {
    if (d !== sel.current) {
      sel.current = d
      o.select(d)
    }
  }

  if (!o.enabled) return {}
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      rect.current = o.wrapRef.current?.getBoundingClientRect() ?? null
      const mouse = e.pointerType === 'mouse'
      if (mouse) e.currentTarget.setPointerCapture(e.pointerId)
      const d = dateAt(e.clientX)
      if (!d) return
      if (mouse) {
        pinned.current = d === pinned.current ? null : d
        set(pinned.current)
      } else set(d)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse' && e.buttons === 0) return
      const d = dateAt(e.clientX)
      if (d) set(d)
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse') pinned.current = sel.current
      rect.current = null
    },
    onPointerCancel() {
      set(pinned.current)
      rect.current = null
    },
    onPointerLeave(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse') {
        set(pinned.current)
        rect.current = null
      }
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.key === 'Escape') {
        pinned.current = null
        set(null)
        return
      }
      if (!o.dates.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      const cur = sel.current ? o.dates.indexOf(sel.current) : -1
      const last = o.dates.length - 1
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? last : cur < 0 ? last : Math.min(last, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))
      pinned.current = o.dates[next]!
      set(pinned.current)
    },
  }
}
