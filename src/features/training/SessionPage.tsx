import { lazy, Suspense } from 'react'
import { Skeleton } from '../../ui/Skeleton'

// The session screen (live session and finished summary) loads as its own chunk: see ./session/.
const SessionScreen = lazy(() => import('./session/SessionScreen'))

export function SessionPage() {
  return (
    <Suspense fallback={<Skeleton lines={6} label="Cargando sesión" />}>
      <SessionScreen />
    </Suspense>
  )
}
