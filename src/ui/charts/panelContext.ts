import { createContext, useEffect, useRef, useState } from 'react'
import type { Readout } from './types'

/** ChartPanel owns the selection; the chart inside reads/writes it through this context. */
export interface PanelCtx {
  selectedDate: string | null
  /** Called by the chart with the new selection and what the header should show for it. */
  select: (date: string | null, readout: Readout | null) => void
  compact: boolean
  /** True when the panel provides its own "Ver tabla" toggle (chart then hides its own). */
  externalTable: boolean
}

export const ChartPanelContext = createContext<PanelCtx | null>(null)

/** Width in px of an element, tracked with ResizeObserver (text must not stretch with a viewBox). */
export function useElementWidth<E extends HTMLElement>(): [React.RefObject<E | null>, number] {
  const ref = useRef<E | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.round(el.getBoundingClientRect().width))
    const ro = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]!.contentRect.width)
      setW((prev) => (prev === next ? prev : next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
