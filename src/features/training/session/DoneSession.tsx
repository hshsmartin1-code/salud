import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile, useRepo } from '../../../app/profile'
import type { ExerciseSet, TrainingSession } from '../../../db/types'
import { formatDateEs } from '../../../domain/dates'
import { isWorkSet, setKind, SET_KIND_SHORT } from '../../../domain/setKind'
import { sessionVolume } from '../../../domain/training'
import { formatNumber } from '../../../domain/units'
import { useConfirm } from '../../../ui/Confirm'
import { Icon } from '../../../ui/Icon'
import { PageHeader } from '../../../ui/kit'
import { Menu } from '../../../ui/Menu'
import { Meter } from '../../../ui/Meter'
import { SectionHeader } from '../../../ui/SectionHeader'
import { useToast } from '../../../ui/Toast'
import { ExerciseThumb, useExerciseMedia } from '../exerciseMedia'
import { routineFromSession, uniqueRoutineName } from '../routineFromSession'
import { groupLabel } from '../muscles'
import { deleteSession } from '../session'
import { formatSet } from '../sets'
import { sessionMuscleSplit } from '../trainingStats'
import { SessionActionsContext } from './actions'
import type { Effort } from './columns'
import { blockSignature, useSessionEditor, type Catalog } from './editor'
import { ExerciseBlock } from './ExerciseBlock'
import { workOrdinals } from './model'
import { RECORD_SEPARATOR } from './records'
import { KIND_TONE } from './kinds'

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : null)

const seriesText = (n: number) => `${n} ${n === 1 ? 'serie' : 'series'}`

function durationText(s: TrainingSession): string {
  const min = s.durationMin ?? (s.startedAt && s.endedAt ? Math.max(1, Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)) : null)
  if (min === null) return '—'
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min}`
}

/**
 * A finished session (same route): a readable summary first, then each exercise with its sets as
 * compact read-only lines. "Editar" turns them into the editable table.
 */
export function DoneSession({ session, sets, prs, ex }: { session: TrainingSession; sets: ExerciseSet[]; prs: ReadonlyMap<string, string>; ex: Catalog }) {
  const r = useRepo()
  const profile = useProfile()
  const nav = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const media = useExerciseMedia()
  const [editing, setEditing] = useState(false)
  const effort: Effort = profile.settings.training?.effort ?? 'none'
  const { actions, sheets, byExercise, openPicker } = useSessionEditor(session, sets, ex)

  const done = useMemo(() => sets.filter((s) => s.done), [sets])
  const work = done.filter(isWorkSet)
  const volume = sessionVolume(done)
  const records = done.filter((s) => prs.has(s.id)).length
  const range = [time(session.startedAt), time(session.endedAt)].filter(Boolean).join('–')
  const skipped = session.exerciseOrder.filter((o) => !(byExercise.get(o.exerciseId) ?? []).some((s) => s.done))
  const dur = durationText(session)
  const split = useMemo(() => sessionMuscleSplit(sets, ex.byId), [sets, ex.byId])

  async function saveAsRoutine() {
    const existing = (await r.all('routines')).map((x) => x.name)
    const draft = routineFromSession(session, sets, { name: uniqueRoutineName(session.name, existing) })
    if (!draft.exercises.length) {
      toast.show({ message: 'No hay series completadas para crear una rutina.' })
      return
    }
    const routine = await r.add('routines', draft)
    toast.show({ message: `Rutina «${routine.name}» creada` })
    nav(`/entreno/rutinas/${routine.id}/editar`)
  }

  async function remove() {
    const ok = await confirm({ title: '¿Eliminar esta sesión?', body: 'Se borran la sesión y todas sus series. No se puede deshacer.', confirmLabel: 'Eliminar sesión', tone: 'danger' })
    if (!ok) return
    await deleteSession(r, session)
    nav('/entreno', { replace: true })
  }

  async function stopEditing() {
    // Rows added while editing and never marked done are not performed sets.
    const pending = sets.filter((s) => !s.done)
    if (pending.length) {
      await r.removeMany('exerciseSets', pending.map((s) => s.id))
      toast.show({ message: pending.length === 1 ? 'Se quitó 1 serie sin marcar como hecha.' : `Se quitaron ${pending.length} series sin marcar como hechas.` })
    }
    setEditing(false)
  }

  return (
    <SessionActionsContext.Provider value={actions}>
      <div className="mx-auto max-w-2xl" data-testid="done-session">
        <PageHeader
          title={session.name}
          subtitle={`${formatDateEs(session.date, 'long')}${range ? ` · ${range}` : ''}`}
          back="/entreno"
          actions={
            editing ? (
              <button type="button" className="btn-primary" onClick={() => void stopEditing()} data-testid="edit-done">
                <Icon name="check" size={18} strokeWidth={2.4} /> Listo
              </button>
            ) : (
              <Menu
                label="Opciones de la sesión"
                items={[
                  { label: 'Editar', icon: 'pencil', onSelect: () => setEditing(true) },
                  { label: 'Guardar como rutina', icon: 'copy', onSelect: () => void saveAsRoutine() },
                  { label: 'Eliminar sesión', icon: 'trash', tone: 'danger', onSelect: () => void remove() },
                ]}
              />
            )
          }
        />

        <div className="metric-strip grid-cols-2 sm:grid-cols-4" data-testid="session-summary">
          <SummaryCell label="Duración" value={dur} unit={dur.includes('h') || dur === '—' ? undefined : 'min'} />
          <SummaryCell label="Series" value={String(work.length)} />
          <SummaryCell label="Volumen" value={<span data-testid="session-volume">{formatNumber(volume, 0)}</span>} unit="kg" />
          <SummaryCell label="Récords" value={String(records)} tone={records ? 'warn' : undefined} icon={records ? true : undefined} />
        </div>
        {session.rpe || session.notes ? (
          <div className="mt-4 space-y-1 px-1">
            {session.rpe ? (
              <p className="text-label text-muted">
                Esfuerzo de la sesión <span className="num font-semibold text-ink">{formatNumber(session.rpe, 1)} / 10</span>
              </p>
            ) : null}
            {session.notes ? <p className="whitespace-pre-line text-body">{session.notes}</p> : null}
          </div>
        ) : null}

        {!editing && split.length ? <MuscleSplit split={split} /> : null}

        <div className="mt-7 space-y-2.5">
          {session.exerciseOrder.map((item, i) => {
            const rows = byExercise.get(item.exerciseId) ?? []
            // Read-only view: only what was done (planned-but-skipped exercises are summarised below).
            if (!editing && !rows.some((s) => s.done)) return null
            const e = ex.byId.get(item.exerciseId)
            const muscle = e?.primaryMuscles[0] ? ex.labels.muscles[e.primaryMuscles[0]] : undefined
            if (editing)
              return (
                <ExerciseBlock
                  key={item.exerciseId}
                  session={session}
                  item={item}
                  sets={rows}
                  index={i}
                  count={session.exerciseOrder.length}
                  open
                  collapsible={false}
                  effort={effort}
                  prs={prs}
                  aliases={ex.aliases}
                  exercise={e}
                  media={media}
                  muscle={muscle}
                  sig={blockSignature(item, rows, prs)}
                />
              )
            const shown = rows.filter((s) => s.done)
            const ord = workOrdinals(shown)
            const exVolume = sessionVolume(shown)
            return (
              <section key={item.exerciseId} className="rounded-2xl border border-line bg-surface px-3 py-3" data-testid="exercise-block">
                <button type="button" className="flex min-h-11 w-full items-center gap-3 text-left" onClick={() => actions.openDetail(item.exerciseId)}>
                  <ExerciseThumb media={media} item={media?.items[item.exerciseId]} size={40} exercise={e} muscle={muscle} exerciseId={item.exerciseId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-heading">{item.name}</span>
                    <span className="block truncate text-label text-muted">
                      {seriesText(shown.filter(isWorkSet).length)}{exVolume ? ` · ${formatNumber(exVolume, 0)} kg` : ''}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
                </button>
                {shown.length ? (
                  <ol className="mt-2 border-t border-line pt-1.5">
                    {shown.map((s, k) => {
                      const kind = setKind(s)
                      const rec = prs.get(s.id)
                      const effortText = s.rpe != null ? `RPE ${formatNumber(s.rpe, 1)}` : s.rir != null ? `RIR ${formatNumber(s.rir, 1)}` : null
                      return (
                        <li key={s.id} className="grid min-h-8 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-1.5" data-testid="done-set">
                          <span className={`text-center text-label font-semibold num ${kind === 'normal' ? 'text-muted' : KIND_TONE[kind]}`} aria-label={kind === 'normal' ? `Serie ${ord[k]}` : undefined}>
                            {kind === 'normal' ? ord[k] : SET_KIND_SHORT[kind]}
                          </span>
                          <span className="truncate">
                            <span className="readout text-[17px]">{formatSet(s, item.trackingType)}</span>
                            {effortText ? <span className="ml-2 text-label text-muted">{effortText}</span> : null}
                            {s.notes ? <span className="ml-2 text-label text-muted">· {s.notes}</span> : null}
                          </span>
                          {rec ? (
                            <span className="flex items-center gap-1 text-label font-medium text-warn" role="img" aria-label={`Récord: ${rec}`} title={`Récord: ${rec}`} data-testid="pr-badge">
                              <Icon name="trophy" size={14} strokeWidth={2.2} />
                              <span className="hidden sm:inline">{rec.split(RECORD_SEPARATOR)[0]}</span>
                            </span>
                          ) : (
                            <span />
                          )}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="mt-2 text-label text-muted">Sin series completadas.</p>
                )}
                {item.notes ? <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface2/70 px-2 py-1.5 text-label text-muted">{item.notes}</p> : null}
              </section>
            )
          })}
          {!editing && skipped.length ? (
            <details className="group px-1 pt-1 text-label text-muted" data-testid="skipped-exercises">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg hover:text-ink">
                <Icon name="chevronRight" size={16} className="shrink-0 motion-safe:transition-transform group-open:rotate-90" />
                {skipped.length === 1 ? '1 ejercicio planificado sin series' : `${skipped.length} ejercicios planificados sin series`}
              </summary>
              <ul className="space-y-1 pb-1 pl-6">
                {skipped.map((o) => (
                  <li key={o.exerciseId}>{o.name}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {editing ? (
            <button type="button" className="btn-secondary h-12 w-full" onClick={openPicker} data-testid="add-exercise">
              <Icon name="plus" size={18} strokeWidth={2.4} /> Agregar ejercicio
            </button>
          ) : null}
        </div>
      </div>
      {sheets}
    </SessionActionsContext.Provider>
  )
}

function SummaryCell({ label, value, unit, tone, icon }: { label: string; value: ReactNode; unit?: string; tone?: 'warn'; icon?: boolean }) {
  return (
    <div>
      <div className="text-label font-medium text-muted">{label}</div>
      <div className={`readout mt-1.5 flex items-center gap-1.5 text-readout ${tone === 'warn' ? 'text-warn' : 'text-ink'}`}>
        {icon ? <Icon name="trophy" size={20} strokeWidth={2.2} /> : null}
        {value}
        {unit ? <span className="text-label font-medium text-muted">{unit}</span> : null}
      </div>
    </div>
  )
}

const SPLIT_SHOWN = 3

/** "División muscular": share of the session's work sets per muscle group, the top three and "Mostrar más". */
function MuscleSplit({ split }: { split: ReturnType<typeof sessionMuscleSplit> }) {
  const [all, setAll] = useState(false)
  const rows = all ? split : split.slice(0, SPLIT_SHOWN)
  return (
    <section className="mt-7" aria-labelledby="split-title" data-testid="muscle-split">
      <SectionHeader title={<span id="split-title">División muscular</span>} hint="Parte de las series de trabajo de la sesión" />
      <ul className="mt-3 space-y-3">
        {rows.map((g) => {
          const pct = Math.round(g.share * 100)
          return (
            <li key={g.group} className="grid grid-cols-[84px_1fr_44px] items-center gap-3" data-testid="split-row" data-group={g.group}>
              <span className="truncate text-body text-ink">{groupLabel(g.group)}</span>
              <Meter value={g.share} max={1} colorVar="train" variant="bar" label={`${groupLabel(g.group)}: ${pct} % de las series de trabajo`} />
              <span className="num text-right text-body text-ink">{pct} %</span>
            </li>
          )
        })}
      </ul>
      {split.length > SPLIT_SHOWN ? (
        <button type="button" className="mt-1 flex min-h-11 items-center gap-1 rounded-lg pr-2 text-label font-medium text-muted hover:text-ink" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="split-more">
          {all ? 'Mostrar menos' : 'Mostrar más'}
          <Icon name={all ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      ) : null}
    </section>
  )
}
