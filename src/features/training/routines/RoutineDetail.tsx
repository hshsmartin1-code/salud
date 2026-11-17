import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../../ui/Icon'
import { Menu } from '../../../ui/Menu'
import { Meter } from '../../../ui/Meter'
import { Metric } from '../../../ui/Metric'
import { SectionHeader } from '../../../ui/SectionHeader'
import { Skeleton } from '../../../ui/Skeleton'
import { EmptyState, PageHeader } from '../../../ui/kit'
import { exercisePath } from '../exerciseKnowledge'
import { ExerciseThumb, useExerciseMedia } from '../exerciseMedia'
import { MuscleMap } from '../MuscleMap'
import { groupLabel } from '../muscles'
import { describeExercise } from '../routines'
import { formatSet } from '../sets'
import { DockBar } from '../shared/DockBar'
import { shortDay, weekdayDay } from '../shared/format'
import { useStartTraining } from '../shared/useStartTraining'
import { useTrainingData } from '../shared/useTrainingData'
import { formatMinutes, lastExercisePerformance, routineStats } from '../trainingStats'
import { useRoutineActions } from './useRoutineActions'

/** `/entreno/rutinas/:id`: decide and start in one screen. */
export function RoutineDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { r, routines, prepared, lastUsed, ex, today } = useTrainingData()
  const routine = useLiveQuery(async () => (await r.get('routines', id)) ?? null, [r, id])
  const media = useExerciseMedia()
  const start = useStartTraining()
  const act = useRoutineActions(routines, lastUsed)

  const view = useMemo(() => {
    if (!routine || !prepared) return null
    const stats = routineStats(routine, prepared, today, ex.byId)
    const primary = new Set<string>()
    const secondary = new Set<string>()
    for (const e of routine.exercises) {
      const c = ex.byId.get(e.exerciseId)
      c?.primaryMuscles.forEach((m) => primary.add(m))
      c?.secondaryMuscles.forEach((m) => secondary.add(m))
    }
    // Old ids that resolve to the same exercise count as the same exercise.
    const aliasOf = new Map<string, string[]>()
    for (const [k, v] of ex.byId) if (k !== v.id) aliasOf.set(v.id, [...(aliasOf.get(v.id) ?? []), k])
    const lasts = new Map(routine.exercises.map((e) => [e.key, lastExercisePerformance(prepared, [e.exerciseId, ...(aliasOf.get(e.exerciseId) ?? [])])]))
    return { stats, primary: [...primary], secondary: [...secondary], lasts }
  }, [routine, prepared, ex.byId, today])

  if (routine === undefined || !view) {
    return (
      <>
        <PageHeader title="Rutina" back="/entreno" />
        <div className="space-y-6" data-testid="routine-loading">
          <Skeleton height={64} label="Cargando rutina" />
          <Skeleton height={120} label="" />
          <Skeleton height={240} label="" />
        </div>
      </>
    )
  }
  if (routine === null) {
    return (
      <>
        <PageHeader title="Rutina" back="/entreno" />
        <EmptyState icon="info" title="Esta rutina ya no existe">
          Puede que se haya eliminado en otro dispositivo. <Link to="/entreno" className="underline underline-offset-2">Volver a Entreno</Link>
        </EmptyState>
      </>
    )
  }
  const { stats, primary, secondary, lasts } = view
  const est = stats.estimatedMin !== null ? formatMinutes(stats.estimatedMin) : null
  const archived = !!routine.archived
  const groupMax = Math.max(1, ...stats.groups.map((g) => g.sets))

  return (
    <>
      <PageHeader
        title={routine.name}
        back="/entreno"
        actions={
          <Menu
            label={`Más acciones de ${routine.name}`}
            items={[
              { label: 'Editar', icon: 'edit', onSelect: () => nav(`/entreno/rutinas/${routine.id}/editar`) },
              { label: 'Duplicar', icon: 'copy', onSelect: () => void act.duplicate(routine).then((c) => c && nav(`/entreno/rutinas/${c.id}`)) },
              archived ? { label: 'Restaurar', icon: 'rotateCcw', onSelect: () => void act.restore(routine) } : { label: 'Archivar', icon: 'layers', onSelect: () => void act.archive(routine).then(() => nav('/entreno')) },
              { label: 'Eliminar', icon: 'trash', tone: 'danger', onSelect: () => void act.remove(routine).then((gone) => gone && nav('/entreno')) },
            ]}
          />
        }
      />
      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-x-10" data-testid="routine-detail">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-7">
        <div className="-mt-2 space-y-1">
          {archived ? <p className="text-label font-medium text-warn">Archivada: no aparece en tu lista de rutinas.</p> : null}
          {routine.notes ? <p className="whitespace-pre-line text-body text-muted">{routine.notes}</p> : null}
          <p className="num text-label text-muted" data-testid="detail-last">
            {stats.lastDate
              ? `Última vez: ${weekdayDay(stats.lastDate)}${stats.timesLast4Weeks ? ` · ${stats.timesLast4Weeks} ${stats.timesLast4Weeks === 1 ? 'vez' : 'veces'} en las últimas 4 semanas` : ''}`
              : 'Aún sin hacer'}
          </p>
        </div>

        <section aria-label="Resumen de la rutina">
          <div className={`grid divide-x divide-line border-y border-line py-4 ${est ? 'grid-cols-3' : 'grid-cols-2'}`} data-testid="routine-strip">
            <div className="pr-3">
              <Metric label="Series" value={stats.plannedSets} size="lg" hint={stats.plannedWarmups ? `+ ${stats.plannedWarmups} de calentamiento` : undefined} />
            </div>
            <div className="px-3">
              <Metric label="Ejercicios" value={stats.exerciseCount} size="lg" />
            </div>
            {est ? (
              <div className="pl-3" data-testid="routine-estimate">
                <Metric label="Duración est." value={`~${est.value}`} unit={est.unit} size="lg" hint={`Mediana de ${stats.sessionCount > 8 ? 'las últimas 8' : stats.sessionCount} sesiones`} />
              </div>
            ) : null}
          </div>
        </section>

        {stats.groups.length ? (
          <section aria-labelledby="muscles-title" className="grid items-center gap-x-8 gap-y-5 sm:grid-cols-[auto_1fr] lg:grid-cols-1">
            <h2 id="muscles-title" className="sr-only">
              Músculos que trabaja
            </h2>
            <div className="mx-auto">
              <MuscleMap primary={primary} secondary={secondary} labels={ex.labels.muscles} height={240} />
            </div>
            <ul className="min-w-0 space-y-3" data-testid="routine-groups">
              {stats.groups.map((g) => (
                <li key={g.group}>
                  <div className="flex items-baseline justify-between gap-2 text-body">
                    <span className="truncate text-ink">{groupLabel(g.group)}</span>
                    <span className="num text-label text-muted">{g.sets} series</span>
                  </div>
                  <div className="mt-1">
                    <Meter value={g.sets} max={groupMax} colorVar="train" variant="bar" label={`${groupLabel(g.group)}: ${g.sets} series planeadas`} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        </div>
        <section aria-labelledby="exercises-title" className="border-t border-line pt-6 lg:min-w-0 lg:border-t-0 lg:pt-0">
          <SectionHeader title={<span id="exercises-title">Ejercicios ({routine.exercises.length})</span>} />
          {routine.exercises.length ? (
            <ul className="divide-rows mt-1" data-testid="routine-exercises">
              {routine.exercises.map((e) => {
                const c = ex.byId.get(e.exerciseId)
                const last = lasts.get(e.key)
                return (
                  <li key={e.key} data-testid="routine-exercise">
                    <Link to={exercisePath(e.exerciseId)} className="relative isolate flex min-h-[72px] items-center gap-3 py-3 outline-none before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-xl hover:before:bg-surface2/50 focus-visible:ring-2 focus-visible:ring-accent">
                      <ExerciseThumb media={media} item={media?.items[e.exerciseId]} exerciseId={e.exerciseId} size={48} exercise={c} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-ink">{e.name}</span>
                        <span className="num block text-label text-muted">{describeExercise(e)}</span>
                        {e.notes ? <span className="block text-label text-ink">Nota: {e.notes}</span> : null}
                        {last ? (
                          <span className="num block text-label text-muted">
                            Última vez {shortDay(last.date)} · {last.sets.length} {last.sets.length === 1 ? 'serie' : 'series'}
                            {last.best ? ` · mejor ${formatSet(last.best, e.trackingType)}` : ''}
                          </span>
                        ) : null}
                      </span>
                      <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-3 text-body text-muted">
              Esta rutina no tiene ejercicios. <Link to={`/entreno/rutinas/${routine.id}/editar`} className="underline underline-offset-2">Añadirlos</Link>
            </p>
          )}
        </section>
      </div>

      <DockBar label="Iniciar esta rutina">
        <button type="button" className="btn-primary min-h-[52px] flex-1" onClick={() => void start(routine)} data-testid="start-routine">
          <Icon name="play" size={18} /> Iniciar entrenamiento
        </button>
      </DockBar>
    </>
  )
}
