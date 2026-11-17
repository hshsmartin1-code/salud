import { Link } from 'react-router-dom'
import type { Routine, TrainingSession } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { Sheet } from '../../../ui/kit'
import type { useExercises } from '../exercises'
import { RoutineThumbs } from '../shared/RoutineThumbs'
import { routineSummary } from '../shared/format'
import type { RoutineStats } from '../trainingStats'
import { groupsText, lastTimeText } from '../shared/routineText'

/**
 * "Iniciar entrenamiento": the routines (in the order of the home) and the free option, one tap each.
 * Opened from the app's "+" (`/entreno?iniciar=1`) and from "Elegir otra" on the home.
 */
export function StartSheet({
  open,
  onClose,
  routines,
  stats,
  ex,
  active,
  onStart,
}: {
  open: boolean
  onClose: () => void
  routines: readonly Routine[]
  stats: ReadonlyMap<string, RoutineStats>
  ex: ReturnType<typeof useExercises>
  active: TrainingSession | null | undefined
  onStart: (routine?: Routine) => void
}) {
  const pick = (routine?: Routine) => {
    onClose()
    onStart(routine)
  }
  const row = 'flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-accent active:bg-surface2'
  return (
    <Sheet open={open} onClose={onClose} title="Iniciar entrenamiento">
      <div className="space-y-1 pb-2" data-testid="start-sheet">
        {active ? (
          <Link to={`/entreno/sesion/${active.id}`} onClick={onClose} className={`${row} border border-accent/40`} data-testid="start-sheet-continue">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">Continuar «{active.name}»</span>
              <span className="block text-label text-muted">Ya hay un entrenamiento en curso. Solo puede haber uno a la vez.</span>
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
          </Link>
        ) : null}
        <ul className="divide-rows">
          {routines.map((rt) => {
            const st = stats.get(rt.id)
            return (
              <li key={rt.id}>
                <button type="button" className={row} onClick={() => pick(rt)} data-testid="start-sheet-routine">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-ink">{rt.name}</span>
                    <span className="num block truncate text-label text-muted">{st ? `${routineSummary(st.exerciseCount, st.plannedSets)} · ${groupsText(st) || 'sin músculos'}` : `${rt.exercises.length} ejercicios`}</span>
                    {st ? <span className="num block truncate text-label text-muted">{lastTimeText(st)}</span> : null}
                  </span>
                  <RoutineThumbs exercises={rt.exercises} ex={ex} max={3} />
                  <Icon name="play" size={16} className="shrink-0 text-ink" />
                </button>
              </li>
            )
          })}
          <li>
            <button type="button" className={row} onClick={() => pick()} data-testid="start-sheet-free">
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink">Entrenamiento libre</span>
                <span className="block text-label text-muted">Sin rutina: eliges los ejercicios sobre la marcha.</span>
              </span>
              <Icon name="play" size={16} className="shrink-0 text-ink" />
            </button>
          </li>
        </ul>
        {!routines.length ? (
          <Link to="/entreno/rutinas/nueva" onClick={onClose} className="btn-secondary mt-3 w-full">
            <Icon name="plus" size={16} /> Crear una rutina
          </Link>
        ) : null}
      </div>
    </Sheet>
  )
}
