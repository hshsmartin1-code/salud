import { Link } from 'react-router-dom'
import { useProfile } from '../../../app/profile'
import type { TrainingSession } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { formatDuration } from '../sets'
import { ElapsedClock } from './clock'
import { useSessionRest } from './useSessionRest'

/**
 * "Sesión en curso" bar shown by the app shell on every other route while a session is active: name,
 * running time and the rest countdown; tapping it returns to the session. Kept in the main bundle
 * (small) so the session screen itself can stay a lazy chunk.
 */
export function OngoingSessionBar({ session, variant }: { session: TrainingSession; variant: 'bottom' | 'sidebar' }) {
  const profile = useProfile()
  const rest = useSessionRest(profile, session.id)
  const resting = rest.status === 'running' || rest.status === 'paused'
  const to = `/entreno/sesion/${session.id}`
  const restText = resting ? (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-train/15 px-2 py-0.5 text-ink" aria-label={`Descanso: quedan ${formatDuration(rest.leftSec)}`}>
      <Icon name={rest.status === 'paused' ? 'pause' : 'timer'} size={14} className="text-train" strokeWidth={2.2} />
      <span className="readout text-[16px]">{formatDuration(rest.leftSec)}</span>
    </span>
  ) : null

  if (variant === 'sidebar')
    return (
      <Link to={to} className="mb-3 block rounded-xl border border-train/40 bg-train/10 px-3 py-2.5 hover:bg-train/15" data-testid="session-ongoing-bar">
        <span className="flex items-center gap-2 text-label font-medium text-muted">
          <span className="h-2 w-2 shrink-0 rounded-full bg-train" aria-hidden />
          Sesión en curso
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-semibold">{session.name}</span>
          {restText ?? <ElapsedClock startedAt={session.startedAt} className="readout text-[17px] text-muted" />}
        </span>
      </Link>
    )

  return (
    <Link
      to={to}
      className="mx-auto flex h-[52px] max-w-3xl items-center gap-3 px-4 hover:bg-train/5"
      aria-label={`Sesión en curso: ${session.name}. Volver a la sesión`}
      data-testid="session-ongoing-bar"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-train/15 text-train" aria-hidden>
        <Icon name="dumbbell" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-micro font-medium text-muted">Sesión en curso</span>
        <span className="block truncate text-body font-semibold leading-tight">{session.name}</span>
      </span>
      {restText}
      <ElapsedClock startedAt={session.startedAt} className="readout shrink-0 text-[19px]" />
      <Icon name="chevronUp" size={20} className="shrink-0 text-faint" />
    </Link>
  )
}
