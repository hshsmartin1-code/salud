import { Link } from 'react-router-dom'
import { Icon } from '../../ui/Icon'
import { useStartTraining } from '../training/shared/useStartTraining'
import type { TrainingSlot } from './trainingSlot'

/** Today is a planned training day and nothing is finished: the one place where training is the recommendation. */
export function DueCard({ slot }: { slot: Extract<TrainingSlot, { kind: 'due' }> }) {
  const start = useStartTraining()
  const { routine } = slot
  return (
    <section className="rounded-2xl border border-line bg-surface p-3.5" aria-label="Entrenamiento de hoy" data-testid="training-due">
      <div className="text-label text-muted">Hoy toca</div>
      <div className="truncate text-heading text-ink">{slot.title}</div>
      {slot.detail ? <div className="truncate text-label text-muted">{slot.detail}</div> : null}
      <div className="mt-2.5 flex items-stretch gap-2">
        <button type="button" className="btn-primary min-h-[52px] min-w-0 flex-1" onClick={() => void start(routine ?? undefined)} data-testid="start-last-routine" aria-label={routine ? `Iniciar ${routine.name}` : 'Iniciar entrenamiento'}>
          <Icon name="play" size={16} className="shrink-0" />
          <span className="truncate">Iniciar</span>
        </button>
        <Link to="/entreno" className="btn-secondary min-h-[52px] shrink-0 px-4" data-testid="now-other">
          Otra
        </Link>
      </div>
    </section>
  )
}

/** One quiet row at the end of Hoy: training done, the next session, or the way to Entreno. */
export function TrainingRow({ slot }: { slot: Extract<TrainingSlot, { kind: 'done' | 'next' | 'go' }> }) {
  const done = slot.kind === 'done'
  const to = done ? `/entreno/sesion/${slot.sessionId}` : '/entreno'
  const text = done ? 'Entrenamiento hecho' : slot.kind === 'next' ? slot.text : 'Ir a Entreno'
  return (
    <Link to={to} data-testid={`training-${slot.kind}`} className="flex min-h-11 items-center gap-2.5 border-t border-line text-label outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <Icon name={done ? 'check' : 'dumbbell'} size={16} className={`shrink-0 ${done ? 'text-good' : 'text-muted'}`} />
      <span className="min-w-0 flex-1 truncate text-ink">
        {text}
        {done ? <span className="text-muted">{` · ${slot.name}`}</span> : null}
      </span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
    </Link>
  )
}
