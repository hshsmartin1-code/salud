import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 1024px)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** True from the `lg` breakpoint (1024 px) up: the Nutrition screens switch to their desktop layout. */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
