import { useEffect, useRef } from 'react'
import { dismissStack } from './dismissStack'

/**
 * While `open`, registers `onClose` in the app-wide dismiss stack (see dismissStack.ts). The latest
 * `onClose` is always the one called. Public props of the overlay are unchanged.
 */
export function useDismissable(open: boolean, onClose: () => void): void {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!open) return
    return dismissStack.push(() => ref.current())
  }, [open])
}
