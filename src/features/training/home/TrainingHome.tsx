import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../../ui/Icon'
import { SectionHeader } from '../../../ui/SectionHeader'
import { Skeleton } from '../../../ui/Skeleton'
import { PageHeader } from '../../../ui/kit'
import { useProfile } from '../../../app/profile'
import { sortRoutines } from '../routines'
import { doneDates } from '../plan/plan'
import { offeredRoutine, startSuggestion } from '../plan/startSuggestion'
import { formatDuration } from '../sets'
import { DockBar } from '../shared/DockBar'
import { useElapsed } from '../shared/useElapsed'
import { useStartTraining } from '../shared/useStartTraining'
import { useTrainingData } from '../shared/useTrainingData'
import { allRecords, digestSessions, recordCountBySession, routineStats, weekToDate } from '../trainingStats'
import { useDesktop } from '../../nutrition/useDesktop'
import { useActiveSession } from '../useTraining'
import { RecoverySection } from '../recovery/RecoverySection'
import { RoutineCard } from './RoutineCard'
import { SessionCard } from './SessionCard'
import { StartSheet } from './StartSheet'
import { calendarWeeks, weekStreak } from '../trainingCalendar'
import { TrainingCalendar } from './TrainingCalendar'
import { PlanSection } from '../plan/PlanSection'
import { WeekReadouts } from './WeekSummary'

const SECTION = 'border-t border-line pt-6'
const MAX_ROUTINES = 6
const RECENT = 3

function HomeSkeleton() {
  // Same blocks, same heights as the loaded page, so nothing jumps when the data arrives.
  return (
    <div data-testid="training-loading" className="space-y-7">
      <Skeleton height={40} label="Cargando entrenamiento" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-6">
        <Skeleton height={52} label="" />
        <Skeleton height={52} label="" />
        <Skeleton height={52} label="" />
        <Skeleton height={52} label="" />
      </div>
      <Skeleton height={236} label="" />
      <Skeleton height={150} label="" />
    </div>
  )
}

function ActiveBlock({ session }: { session: { id: string; name: string; startedAt: string | null } }) {
  const elapsed = useElapsed(session.startedAt)
  return (
    <Link
      to={`/entreno/sesion/${session.id}`}
      data-testid="active-session"
      className="block rounded-2xl border border-accent/50 bg-surface p-4 outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-label text-muted">Entrenamiento en curso</span>
          <span className="block truncate text-heading text-ink">{session.name}</span>
        </span>
        {session.startedAt ? (
          <span className="readout num shrink-0 text-readout text-ink" aria-label={`Lleva ${formatDuration(elapsed)}`} data-testid="active-elapsed">
            {formatDuration(elapsed)}
          </span>
        ) : null}
      </span>
      <span className="btn-primary mt-4 w-full">
        <Icon name="play" size={16} />
        Continuar entrenamiento
      </span>
    </Link>
  )
}

function Section({ children, first = false, className = '' }: { children: ReactNode; first?: boolean; className?: string }) {
  return <div className={`${first ? '' : SECTION} ${className}`}>{children}</div>
}

export function TrainingHome() {
  const d = useTrainingData()
  const active = useActiveSession()
  const start = useStartTraining()
  const [params, setParams] = useSearchParams()
  const sheetOpen = params.get('iniciar') === '1'
  const { routines, prepared, lastUsed, ex, today } = d
  const desktop = useDesktop()
  const plan = useProfile().settings.training?.plan

  const view = useMemo(() => {
    if (!routines || !prepared) return null
    const sorted = sortRoutines(routines, lastUsed)
    const stats = new Map(sorted.map((rt) => [rt.id, routineStats(rt, prepared, today, ex.byId)]))
    const { week, previous: prev, previousFull: prevFull } = weekToDate(prepared, today)
    const records = allRecords(prepared)
    return {
      sorted,
      stats,
      suggestion: startSuggestion({ plan, today, done: doneDates(d.sessions ?? []), routines, lastUsed }),
      week,
      prev,
      prevFull,
      calendar: calendarWeeks(prepared, today, 5),
      streak: weekStreak(prepared, today),
      digests: digestSessions(prepared, recordCountBySession(prepared, records)),
    }
  }, [routines, prepared, lastUsed, ex.byId, today, plan, d.sessions])

  const closeSheet = () => setParams({}, { replace: true })

  if (!view || active === undefined || !(ex.ready || ex.error)) {
    return (
      <>
        <PageHeader title="Entreno" />
        <HomeSkeleton />
      </>
    )
  }
  const { sorted, stats, suggestion, week, prev, prevFull, digests, calendar, streak } = view
  const hasHistory = digests.length > 0
  // The routine the dock offers: today's planned one when it is due, else the habitual one (same rule as Hoy and the + sheet).
  const habitual = offeredRoutine(suggestion)
  const planned = suggestion.kind === 'planned'

  // Each block is built once; the phone stacks them in this order, from lg they go to two columns.
  const routinesSection = (
    <Section first={false} className="lg:[&>div:first-child]:items-start">
      <SectionHeader
        title="Rutinas"
        action={
          <div className="-mr-2 flex items-center">
            <Link to="/entreno/rutinas" className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-label font-medium text-muted hover:text-ink" data-testid="manage-routines">
              Gestionar
            </Link>
            <Link to="/entreno/rutinas/nueva" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-label font-semibold text-ink" data-testid="new-routine">
              <Icon name="plus" size={16} /> Nueva
            </Link>
          </div>
        }
      />
      {sorted.length ? (
        <ul className="mt-3 space-y-3 lg:grid lg:grid-cols-1 lg:gap-3 lg:space-y-0 xl:grid-cols-[repeat(2,minmax(0,1fr))]" data-testid="routine-list">
          {sorted.slice(0, MAX_ROUTINES).map((rt) => (
            <RoutineCard key={rt.id} routine={rt} stats={stats.get(rt.id)!} ex={ex} onStart={() => void start(rt)} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-body text-muted">Una rutina guarda tus ejercicios, series objetivo y descansos para iniciarla con un toque.</p>
      )}
      {sorted.length > MAX_ROUTINES ? (
        <Link to="/entreno/rutinas" className="mt-2 flex min-h-[44px] items-center justify-between text-label font-medium text-muted hover:text-ink">
          Ver las {sorted.length} rutinas <Icon name="chevronRight" size={16} />
        </Link>
      ) : null}
    </Section>
  )

  const planSection = (
    <Section>
      <PlanSection dockOffersId={active ? null : (habitual?.id ?? null)} />
    </Section>
  )

  const calendarSection = hasHistory ? (
    <Section>
      <TrainingCalendar weeks={calendar} streak={streak} />
    </Section>
  ) : null

  const recoverySection = prepared ? (
    <Section>
      <RecoverySection prepared={prepared} catalog={ex.byId} labels={ex.labels.muscles} />
    </Section>
  ) : null

  const historySection = hasHistory ? (
    <Section>
      <SectionHeader
        title="Historial reciente"
        action={
          <Link to="/entreno/historial" className="-mr-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-label font-medium text-muted hover:text-ink" data-testid="all-history">
            Ver todo <Icon name="chevronRight" size={16} />
          </Link>
        }
      />
      <ul className="mt-3 space-y-3" data-testid="recent-history">
        {digests.slice(0, RECENT).map((dg) => (
          <SessionCard key={dg.session.id} digest={dg} prepared={prepared!} ex={ex} />
        ))}
      </ul>
    </Section>
  ) : null

  return (
    <>
      <PageHeader
        title="Entreno"
        actions={
          <>
            <Link to="/entreno/estadisticas" className="btn-secondary px-3" data-testid="stats-link">
              Estadísticas
            </Link>
            <Link to="/entreno/ejercicios" className="btn-secondary px-3">
              Ejercicios
            </Link>
          </>
        }
      />
      <div className={desktop ? 'flex flex-col gap-6' : 'space-y-6'} data-testid="training-home">
        {active ? <ActiveBlock session={active} /> : null}

        {hasHistory ? (
          <Section first>
            <WeekReadouts week={week} prev={prev} prevFull={prevFull} today={today} />
          </Section>
        ) : (
          <section aria-labelledby="empty-title" data-testid="training-empty" className="rounded-2xl border border-dashed border-line p-5">
            <h2 id="empty-title" className="text-heading text-ink">
              Aún no has terminado ningún entrenamiento
            </h2>
            <p className="mt-1 text-body text-muted">
              {sorted.length
                ? 'Inicia una de tus rutinas o un entrenamiento libre. Al terminar verás aquí la semana: sesiones, series, volumen y tiempo.'
                : 'Empieza con un entrenamiento libre o crea una rutina para repetirla con un toque. Al terminar verás aquí la semana: sesiones, series, volumen y tiempo.'}
            </p>
            {!sorted.length ? (
              <Link to="/entreno/rutinas/nueva" className="btn-secondary mt-4" data-testid="empty-new-routine">
                <Icon name="plus" size={16} /> Crear mi primera rutina
              </Link>
            ) : null}
          </section>
        )}

        {desktop ? (
          <>
          {/* «Mi planificación» is a full-width band above the two columns, so both columns start level. */}
          {planSection}
          <div className="grid grid-cols-[minmax(0,60fr)_minmax(320px,40fr)] items-start gap-x-8">
            <div className="flex min-w-0 flex-col gap-6">
              {routinesSection}
              {historySection}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              {calendarSection}
              {recoverySection}
            </div>
          </div>
          </>
        ) : (
          <>
            {planSection}
            {routinesSection}
            {calendarSection}
            {recoverySection}
            {historySection}
          </>
        )}
      </div>

      <DockBar label="Iniciar entrenamiento">
        {active ? (
          <button type="button" className="btn-secondary min-h-[52px] flex-1" onClick={() => void start()} data-testid="start-empty-session">
            <Icon name="play" size={16} /> Entrenamiento libre
          </button>
        ) : (
          <>
            {habitual ? (
              <button type="button" className="btn-primary min-h-[52px] min-w-0 flex-1 justify-start gap-3 px-4 text-left" onClick={() => void start(habitual)} data-testid="start-last-routine" aria-label={`Iniciar ${habitual.name}`}>
                <Icon name="play" size={18} className="shrink-0" />
                <span className="min-w-0 leading-tight">
                  <span className="block text-label font-medium opacity-80">{planned ? 'Iniciar · hoy' : 'Iniciar'}</span>
                  <span className="block truncate text-body font-semibold">{habitual.name}</span>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={habitual ? 'btn-secondary min-h-[52px] shrink-0 px-4' : 'btn-primary min-h-[52px] flex-1'}
              onClick={() => void start()}
              data-testid={habitual ? 'start-free-dock' : 'start-empty-session'}
              aria-label="Entrenamiento libre"
            >
              {habitual ? 'Libre' : (
                <>
                  <Icon name="play" size={16} /> Entrenamiento libre
                </>
              )}
            </button>
          </>
        )}
      </DockBar>

      <StartSheet open={sheetOpen} onClose={closeSheet} routines={sorted} stats={stats} ex={ex} active={active} onStart={(rt) => void start(rt)} />
    </>
  )
}
