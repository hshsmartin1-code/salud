import { Link } from 'react-router-dom'
import type { Routine } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import type { useExercises } from '../exercises'
import { RoutineThumbs } from '../shared/RoutineThumbs'
import { groupsText, lastTimeText } from '../shared/routineText'
import { routineSummary } from '../shared/format'
import type { RoutineStats } from '../trainingStats'

/**
 * One routine of the home list. The whole card opens the routine (stretched link on the name); "Iniciar"
 * is its own 44 px button above the link. One surface, no nested cards.
 */
export function RoutineCard({ routine, stats, ex, onStart }: { routine: Routine; stats: RoutineStats; ex: ReturnType<typeof useExercises>; onStart: () => void }) {
  const groups = groupsText(stats)
  return (
    <li className="card relative p-3 lg:pb-14 transition-colors duration-state focus-within:border-line-strong hover:border-line-strong" data-testid="routine-card">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-heading text-ink lg:whitespace-normal lg:break-words">
          <Link to={`/entreno/rutinas/${routine.id}`} className="rounded-lg outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-accent" data-testid="routine-link">
            {routine.name}
          </Link>
        </h3>
        <button type="button" className="btn-secondary relative z-10 shrink-0 px-3 lg:absolute lg:bottom-3 lg:right-3" onClick={onStart} data-testid="start-routine" aria-label={`Iniciar ${routine.name}`}>
          <Icon name="play" size={16} />
          Iniciar
        </button>
      </div>
      <div className="mt-0.5 flex min-h-8 items-center justify-between gap-3">
        <p className="min-w-0 text-label text-muted">{groups || 'Sin ejercicios'}</p>
        <RoutineThumbs exercises={routine.exercises} ex={ex} />
      </div>
      <p className="num mt-1 text-body text-ink" data-testid="routine-sets">
        {routineSummary(stats.exerciseCount, stats.plannedSets)}
      </p>
      <p className="num text-label text-muted" data-testid="routine-last">
        {lastTimeText(stats)}
      </p>
    </li>
  )
}
