import { useEffect } from 'react'

/** Whether the Screen Wake Lock API exists here (the setting is hidden when it does not). */
export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

/**
 * Keeps the screen on while `enabled` and the page is visible. The browser releases the lock when the
 * page is hidden, so it is requested again on `visibilitychange → visible`; released on unmount.
 * Every failure (denied, battery saver, no API) is silent.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return
    let sentinel: WakeLockSentinel | null = null
    let pending = false
    let alive = true
    const acquire = async () => {
      if (!alive || pending || sentinel || document.visibilityState !== 'visible') return
      pending = true
      try {
        const s = await navigator.wakeLock.request('screen')
        if (!alive) {
          void s.release().catch(() => undefined)
          return
        }
        sentinel = s
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null
        })
      } catch {
        /* not allowed now (battery saver, no user activation): try again on the next visibility change */
      } finally {
        pending = false
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }
  }, [enabled])
}
