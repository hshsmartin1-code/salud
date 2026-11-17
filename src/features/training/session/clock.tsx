import { useEffect, useState } from 'react'
import { formatDuration } from '../sets'
import { probeRender } from './renderProbe'

/** Current time, refreshed every `ms` (aligned to the next whole second so readouts tick together). */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      t = setTimeout(tick, ms - (Date.now() % ms) + 5)
    }
    t = setTimeout(tick, ms - (Date.now() % ms) + 5)
    const onVis = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms])
  return now
}

/**
 * Running time since `startedAt`. The only component that re-renders every second, so the session list
 * around it never does.
 */
export function ElapsedClock({ startedAt, className = '' }: { startedAt: string | null; className?: string }) {
  const now = useNow(1000)
  probeRender('clock')
  const start = startedAt ? new Date(startedAt).getTime() : null
  return (
    <span className={`num ${className}`} role="timer" aria-label="Tiempo de entrenamiento">
      {start !== null ? formatDuration(Math.max(0, (now - start) / 1000)) : '—'}
    </span>
  )
}
