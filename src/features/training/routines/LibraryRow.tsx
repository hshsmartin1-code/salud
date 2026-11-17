import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Routine } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { Menu, type MenuItem } from '../../../ui/Menu'
import type { useExercises } from '../exercises'
import { RoutineThumbs } from '../shared/RoutineThumbs'
import { routineSummary } from '../shared/format'
import { groupsText, lastTimeText } from '../shared/routineText'
import type { RoutineStats } from '../trainingStats'

/** Desktop column template of a library row (and of the heads above the list). */
export const LIBRARY_GRID = 'lg:grid-cols-[2rem_minmax(0,1.2fr)_10.5rem_minmax(0,1.4fr)_9rem_6rem_2.75rem] lg:gap-x-3'

export interface DragVisual {
  /** Pixels the dragged row follows the pointer. */
  dy: number
  /** Own offset when another row is being dragged (rows make room). */
  shift: number
  dragging: boolean
}

/**
 * A routine of the library: name, "Iniciar", menu, and under them the same facts as the home card
 * (counts, muscle groups, last time, thumbnails). The handle drags (pointer events) and also answers
 * the arrow keys; the menu has Subir/Bajar as well.
 */
export function LibraryRow({
  routine,
  stats,
  ex,
  menu,
  visual,
  canDrag,
  onStart,
  onDragStart,
  onDragMove,
  onDragEnd,
  onNudge,
  rowRef,
}: {
  routine: Routine
  stats: RoutineStats
  ex: ReturnType<typeof useExercises>
  menu: readonly MenuItem[]
  visual: DragVisual
  canDrag: boolean
  onStart: () => void
  onDragStart: (clientY: number) => void
  onDragMove: (clientY: number) => void
  onDragEnd: (cancel: boolean) => void
  onNudge: (dir: -1 | 1) => void
  rowRef: (el: HTMLLIElement | null) => void
}) {
  const active = useRef(false)
  const groups = groupsText(stats)
  const style: CSSProperties = visual.dragging
    ? { transform: `translateY(${visual.dy}px)`, zIndex: 20, position: 'relative' }
    : { transform: visual.shift ? `translateY(${visual.shift}px)` : undefined, transition: 'transform 120ms ease-out' }
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    active.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onDragStart(e.clientY)
  }
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    onNudge(e.key === 'ArrowUp' ? -1 : 1)
  }
  return (
    <li ref={rowRef} className={`relative py-3 lg:grid lg:items-center lg:py-2 ${LIBRARY_GRID} ${visual.dragging ? 'rounded-xl bg-surface shadow-pop' : ''}`} style={style} data-testid="library-row">
      <div className="flex items-center gap-1 lg:contents">
        {canDrag ? (
          <button
            type="button"
            className="relative z-10 -ml-2 flex h-11 w-11 lg:col-start-1 lg:row-start-1 shrink-0 touch-none select-none items-center justify-center rounded-xl text-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Reordenar ${routine.name}: arrastra, o usa las flechas arriba y abajo`}
            data-testid="drag-handle"
            onPointerDown={down}
            onPointerMove={(e) => active.current && onDragMove(e.clientY)}
            onPointerUp={() => {
              if (active.current) onDragEnd(false)
              active.current = false
            }}
            onPointerCancel={() => {
              if (active.current) onDragEnd(true)
              active.current = false
            }}
            onKeyDown={key}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="4" r="1.6" />
              <circle cx="11" cy="4" r="1.6" />
              <circle cx="5" cy="10" r="1.6" />
              <circle cx="11" cy="10" r="1.6" />
              <circle cx="5" cy="16" r="1.6" />
              <circle cx="11" cy="16" r="1.6" />
            </svg>
          </button>
        ) : null}
        <h3 className="min-w-0 flex-1 truncate text-heading text-ink lg:col-start-2 lg:row-start-1">
          <Link to={`/entreno/rutinas/${routine.id}`} className="rounded-lg outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-accent" data-testid="routine-link">
            {routine.name}
          </Link>
        </h3>
        <button type="button" className="btn-secondary relative z-10 shrink-0 px-3 lg:col-start-6 lg:row-start-1" onClick={onStart} data-testid="library-start" aria-label={`Iniciar ${routine.name}`}>
          <Icon name="play" size={16} />
          Iniciar
        </button>
        <span className="relative z-10 -mr-1 lg:col-start-7 lg:row-start-1 lg:mr-0">
          <Menu label={`Más acciones de ${routine.name}`} items={menu} />
        </span>
      </div>
      <div className={`${canDrag ? 'pl-10' : ''} lg:contents`}>
        <p className="num text-body text-ink lg:col-start-3 lg:row-start-1" data-testid="routine-sets">
          {routineSummary(stats.exerciseCount, stats.plannedSets)}
        </p>
        <div className="flex items-start justify-between gap-3 lg:col-start-4 lg:row-start-1 lg:items-center">
          <p className="min-w-0 text-label text-muted">{groups || 'Sin ejercicios'}</p>
          <RoutineThumbs exercises={routine.exercises} ex={ex} />
        </div>
        <p className="num text-label text-muted lg:col-start-5 lg:row-start-1" data-testid="routine-last">
          {lastTimeText(stats)}
        </p>
      </div>
    </li>
  )
}
