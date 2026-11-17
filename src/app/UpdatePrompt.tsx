import { lazy, Suspense, useEffect, useState } from 'react'

// The service-worker registration (workbox-window, ~6 KB) is not needed to paint the first screen: it is
// loaded once the browser is idle (at most 2 s after mount).
const Inner = lazy(() => import('./UpdatePromptInner'))

/** Service-worker lifecycle: "offline ready" note and "new version" prompt, registered when idle. */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const go = () => setReady(true)
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(go, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(go, 1200)
    return () => window.clearTimeout(t)
  }, [])
  return ready ? (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  ) : null
}
