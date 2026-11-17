import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { registerRestNotificationRouting } from '../integrations/notifications'
import { registerNativeBack, type BackRouter } from './nativeBack'

/** Mount once inside the router: registers the Android hardware Back listener (renders nothing; no-op on the web). */
export function NativeBackBridge() {
  const location = useLocation()
  const navigate = useNavigate()
  // The listener is registered once; it reads the latest route through refs.
  const latest = useRef({ location, navigate })
  useEffect(() => {
    latest.current = { location, navigate }
  })
  useEffect(() => {
    const router: BackRouter = {
      pathname: () => latest.current.location.pathname,
      locationKey: () => latest.current.location.key,
      navigate: (to, opts) => (typeof to === 'number' ? latest.current.navigate(to) : latest.current.navigate(to, opts)),
    }
    const unregisterBack = registerNativeBack(router)
    // A tapped rest alert opens its session; coming back to the app clears the delivered alert.
    const unregisterAlerts = registerRestNotificationRouting((route) => latest.current.navigate(route))
    return () => {
      unregisterBack()
      unregisterAlerts()
    }
  }, [])
  return null
}
