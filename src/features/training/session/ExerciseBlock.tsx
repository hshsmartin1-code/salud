import { useLiveQuery } from 'dexie-react-hooks'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRepo } from '../../../app/profile'
import type { ExerciseSet, SessionExercise } from '../../../db/types'
import { isWorkSet } from '../../../domain/setKind'
import { formatNumber } from '../../../domain/units'
import { Icon } from '../../../ui/Icon'
import { Menu, type MenuItem } from '../../../ui/Menu'
import { useToast } from '../../../ui/Toast'
import type { ExerciseAliases } from '../exerciseKnowledge'
import { ExerciseThumb, type ExerciseMediaFile } from '../exerciseMedia'
import type { Exercise } from '../exercises'
import { matchPreviousSets, previousSessionSets } from '../session'
import { applyAndTouch } from '../sessionWork'
import { formatDuration } from '../sets'
import { useExerciseNoteDraft } from '../useSetDraft'
import { useSessionActions } from './actions'
import { EFFORT_LABEL, FIELD_LABEL, gridTemplate, rowFields, type Effort } from './columns'
import { exerciseProgress, lastTimeLine, targetLabel, workOrdinals } from './model'
import { useSaveGuard } from './saveGuard'
import { progressionHint, progressionText, type ProgressionHint } from './progression'
import { probeRender } from './renderProbe'
import { SetRow } from './SetRow'

export interface SessionRef {
  id: string
  date: string
  startedAt: string | null
  createdAt: string
}

export interface ExerciseBlockProps {
  session: SessionRef
  item: SessionExercise
  /** This exercise's rows, sorted by setIndex. */
  sets: ExerciseSet[]
  index: number
  count: number
  open: boolean
  /** Collapsible (live session). A finished session in edit mode shows every block open. */
  collapsible: boolean
  effort: Effort
  /** Record names per set id (only this exercise's sets are read). */
  prs: ReadonlyMap<string, string>
  aliases: ExerciseAliases
  exercise: Exercise | undefined
  media: ExerciseMediaFile | null
  muscle?: string
  /** Precomputed by the screen: changes whenever anything this block shows changes. */
  sig: string
}

function ExerciseBlockImpl({ session, item, sets, index, count, open, collapsible, effort, prs, aliases, exercise, media, muscle }: ExerciseBlockProps) {
  probeRender(`block:${item.exerciseId}`)
  const actions = useSessionActions()
  const progress = exerciseProgress(sets)
  const complete = progress.total > 0 && progress.done === progress.total
  const thumb = <ExerciseThumb media={media} item={media?.items[item.exerciseId]} size={40} exercise={exercise} muscle={muscle} exerciseId={item.exerciseId} />

  if (collapsible && !open) {
    return (
      <section className="rounded-2xl border border-line bg-surface" data-testid="exercise-block" data-open="false">
        <button
          type="button"
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-surface2/50"
          aria-expanded={false}
          aria-label={`${item.name}, ${progress.done} de ${progress.total} series. Desplegar`}
          onClick={() => actions.toggleOpen(item.exerciseId, true)}
        >
          {thumb}
          <span className="line-clamp-2 min-w-0 flex-1 text-body font-semibold leading-tight">{item.name}</span>
          <span className={`readout shrink-0 text-[17px] ${complete ? 'text-train' : 'text-muted'}`}>
            {progress.done} / {progress.total}
          </span>
          {complete ? <Icon name="check" size={18} className="shrink-0 text-train" strokeWidth={2.6} /> : <Icon name="chevronDown" size={20} className="shrink-0 text-faint" />}
        </button>
      </section>
    )
  }
  return <OpenBlock {...{ session, item, sets, index, count, collapsible, effort, prs, aliases, thumb, progress }} equipment={exercise?.equipment} />
}

function OpenBlock({
  session,
  item,
  sets,
  index,
  count,
  collapsible,
  effort,
  prs,
  aliases,
  thumb,
  progress,
  equipment,
}: Pick<ExerciseBlockProps, 'session' | 'item' | 'sets' | 'index' | 'count' | 'collapsible' | 'effort' | 'prs' | 'aliases'> & { thumb: ReactNode; progress: { done: number; total: number }; equipment: string | null | undefined }) {
  const r = useRepo()
  const actions = useSessionActions()
  const t = item.trackingType
  const [noteOpen, setNoteOpen] = useState(false)
  const hasNote = !!item.notes?.trim()
  // Comparable previous session (alias-resolved, finished, not excluded) of this exercise.
  const aliasKey = Object.keys(aliases).length
  const prevSets = useLiveQuery(
    () => previousSessionSets(r, session, item.exerciseId, aliases),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, session.id, session.date, session.startedAt, item.exerciseId, aliasKey],
  )
  const kindsKey = sets.map((s) => `${s.id}:${s.setIndex}:${s.isWarmup ? 1 : 0}:${s.kind ?? ''}`).join('|')
  const matched = useMemo(
    () => matchPreviousSets(sets, prevSets ?? []),
    // Pairing depends on order and set types only, not on the values being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kindsKey, prevSets],
  )
  const ordinals = workOrdinals(sets)
  const template = gridTemplate(t, effort)
  const fields = rowFields(t, effort)
  const context = lastTimeLine(prevSets, t)
  const target = targetLabel(item)
  // Later pending work rows per row: where "Aplicar a las siguientes" writes (never done rows).
  const following = sets.map((s, i) => (isWorkSet(s) ? sets.slice(i + 1).filter((x) => !x.done && isWorkSet(x)).map((x) => x.id).join(',') : ''))
  const hint = progressionHint({ tracking: t, targetReps: item.targetReps, equipment, previous: prevSets })
  const below = hint ? sets.filter((s) => !s.done && isWorkSet(s) && (s.weight == null || s.weight < hint.suggested)).map((s) => s.id) : []

  const menu: MenuItem[] = [
    { label: 'Historial y técnica', icon: 'chart', onSelect: () => actions.openDetail(item.exerciseId) },
    { label: 'Sustituir', icon: 'swap', onSelect: () => actions.substitute(item.exerciseId) },
    { label: 'Subir', icon: 'chevronUp', disabled: index === 0, onSelect: () => actions.move(item.exerciseId, -1) },
    { label: 'Bajar', icon: 'chevronDown', disabled: index === count - 1, onSelect: () => actions.move(item.exerciseId, 1) },
    { label: hasNote ? 'Editar nota' : 'Añadir nota', icon: 'pencil', onSelect: () => setNoteOpen(true) },
    { label: `Descanso · ${item.restSec ? formatDuration(item.restSec) : 'sin descanso'}`, icon: 'timer', onSelect: () => actions.openRestEdit(item.exerciseId) },
    { label: 'Quitar ejercicio', icon: 'trash', tone: 'danger', onSelect: () => actions.remove(item.exerciseId) },
  ]

  return (
    <section className="rounded-2xl border border-line bg-surface pb-1" data-testid="exercise-block" data-open="true">
      <div className="flex items-start gap-3 px-3 pt-3">
        <button type="button" className="hit-44 shrink-0 rounded-lg" onClick={() => actions.openDetail(item.exerciseId)} aria-label={`Ver historial de ${item.name}`} tabIndex={-1}>
          {thumb}
        </button>
        <button type="button" className="min-h-11 min-w-0 flex-1 pt-0.5 text-left" onClick={() => actions.openDetail(item.exerciseId)}>
          <span className="line-clamp-2 text-heading leading-tight">{item.name}</span>
          <span className="sr-only">. Ver historial y técnica.</span>
        </button>
        {collapsible ? (
          <button
            type="button"
            className="-my-0.5 flex min-h-11 shrink-0 items-center gap-1 rounded-xl pl-2 pr-1 text-muted hover:bg-surface2"
            aria-expanded
            aria-label={`${progress.done} de ${progress.total} series${target ? ` (objetivo ${target})` : ''}. Plegar ${item.name}`}
            onClick={() => actions.toggleOpen(item.exerciseId, false)}
          >
            <span className="flex flex-col items-end leading-none">
              <span className="readout text-[17px] text-ink">
                {progress.done}
                <span className="text-muted"> / {progress.total}</span>
              </span>
              {target ? <span className="mt-1 text-micro font-medium text-muted">{target}</span> : null}
            </span>
            <Icon name="chevronUp" size={20} className="text-faint" />
          </button>
        ) : target ? (
          <span className="shrink-0 pt-1 text-label text-muted">{target}</span>
        ) : null}
        <span className="-my-0.5 -mr-1.5 shrink-0">
          <Menu label={`Opciones de ${item.name}`} items={menu} />
        </span>
      </div>

      <ContextRow context={context} first={!!prevSets && !context} hint={hint && below.length ? hint : null} sessionId={session.id} ids={below} />
      {noteOpen || hasNote ? <MetaLine session={session} item={item} focusOnMount={noteOpen} onDone={() => setNoteOpen(false)} /> : null}

      <div className="px-1.5" role="table" aria-label={`Series de ${item.name}`}>
        <div className="grid h-7 items-center gap-x-1.5 pl-0.5 pr-1 text-micro font-medium text-muted" style={{ gridTemplateColumns: template }} role="row">
          <span className="text-center" role="columnheader">
            Serie
          </span>
          <span className="px-1" role="columnheader">
            Anterior
          </span>
          {fields.map((f) => (
            <span key={f} className="text-center" role="columnheader">
              {f === 'rpe' || f === 'rir' ? EFFORT_LABEL[f] : FIELD_LABEL[t][f]}
            </span>
          ))}
          <span className="flex justify-end pr-3" role="columnheader">
            <Icon name="check" size={14} strokeWidth={2.4} />
            <span className="sr-only">Hecha</span>
          </span>
        </div>
        {sets.map((s, i) => (
          <SetRow key={s.id} set={s} n={ordinals[i]!} tracking={t} effort={effort} prev={matched.get(s.id) ?? null} prs={prs.get(s.id)} following={following[i]!} restSec={item.restSec} template={template} />
        ))}
        <button type="button" className="mt-0.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-label font-semibold text-muted hover:bg-surface2 hover:text-ink" onClick={() => actions.addSet(item.exerciseId)} data-testid="add-set">
          <Icon name="plus" size={16} strokeWidth={2.4} /> Serie
        </button>
      </div>
    </section>
  )
}

/**
 * One line under the block header: "Última vez 9 nov · mejor 74 kg × 9" (it never wraps: the "mejor" part gives way
 * first) and, when the progression rule applies, a compact chip "+2,5 kg" whose explanation opens on tap. Screen
 * readers still get the " · " between the parts (sr-only).
 */
function ContextRow({ context, first, hint, sessionId, ids }: { context: string | null; first: boolean; hint: ProgressionHint | null; sessionId: string; ids: readonly string[] }) {
  const [open, setOpen] = useState(false)
  if (!context && !first && !hint) return null
  const parts = context ? context.split(' · ') : []
  return (
    <div className="px-3" data-testid="progression-hint-row">
      <div className="flex min-h-8 items-center gap-2">
        <p className="flex min-w-0 flex-1 whitespace-nowrap text-label text-muted" data-testid="last-time">
          {context ? (
            <>
              <span className="shrink-0">{parts[0]}</span>
              {parts[1] ? (
                <>
                  <span className="sr-only"> · </span>
                  <span className="ml-2.5 min-w-0 truncate">{parts[1]}</span>
                </>
              ) : null}
            </>
          ) : (
            'Primera vez'
          )}
        </p>
        {hint ? (
          <span data-testid="progression-hint" className="flex shrink-0">
            <button
              type="button"
              className="hit-44 flex h-7 shrink-0 items-center gap-1 rounded-full bg-train/15 pl-2 pr-2.5 text-label font-semibold text-ink hover:bg-train/25"
              aria-expanded={open}
              aria-label={`Sugerencia de progresión: más ${formatNumber(hint.step, 2)} kilos. ${open ? 'Ocultar' : 'Ver'} explicación`}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name="target" size={13} className="text-train" strokeWidth={2.4} />
              <span className="num">+{formatNumber(hint.step, 2)} kg</span>
            </button>
          </span>
        ) : null}
      </div>
      {hint && open ? <ProgressionExplain hint={hint} sessionId={sessionId} ids={ids} /> : null}
    </div>
  )
}

/**
 * The progression hint's explanation (progression.ts states the rule). Never applied on its own: one tap
 * writes the suggested weight to the pending work rows below it, and the toast can undo it.
 */
function ProgressionExplain({ hint, sessionId, ids }: { hint: ProgressionHint; sessionId: string; ids: readonly string[] }) {
  const r = useRepo()
  const toast = useToast()
  const guard = useSaveGuard()
  const kg = formatNumber(hint.suggested, 2)
  const apply = async () => {
    const { count, undo } = await applyAndTouch(r, sessionId, ids, { weight: hint.suggested })
    if (count) toast.show({ message: count === 1 ? `${kg} kg en 1 serie` : `${kg} kg en ${count} series`, actionLabel: 'Deshacer', onAction: () => void guard(undo()) })
  }
  return (
    <div className="mb-1 flex items-center gap-2 rounded-xl bg-train/10 py-1 pl-3 pr-1" data-testid="progression-explain">
      <p className="min-w-0 flex-1 text-label leading-snug text-ink">{progressionText(hint)}</p>
      <button type="button" className="min-h-11 shrink-0 rounded-lg px-2.5 text-label font-semibold text-train hover:bg-train/15" onClick={() => void guard(apply())} aria-label={`Aplicar ${kg} kg a ${ids.length === 1 ? 'la serie pendiente' : `las ${ids.length} series pendientes`}`}>
        Usar {kg} kg
      </button>
    </div>
  )
}

/** The exercise note, shown only when one exists or the person asked to add it (from the block's "⋯" menu). */
function MetaLine({ session, item, focusOnMount, onDone }: { session: SessionRef; item: SessionExercise; focusOnMount: boolean; onDone: () => void }) {
  const r = useRepo()
  const note = useExerciseNoteDraft(r, session.id, item.exerciseId, item.notes)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusOnMount) area.current?.focus()
  }, [focusOnMount])
  return (
    <div className="px-3 pt-0.5">
      <label className="flex items-start gap-1.5 rounded-lg bg-surface2/70 px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent">
        <Icon name="pencil" size={14} className="mt-[3px] shrink-0 text-muted" />
        <span className="sr-only">Nota del ejercicio</span>
        <textarea
          ref={area}
          className="block min-h-[20px] w-full resize-none bg-transparent text-label text-ink outline-none [field-sizing:content] placeholder:text-faint"
          rows={1}
          placeholder="Ajustes de la máquina, sensaciones…"
          {...note.bind()}
          onBlur={() => {
            void note.flush()
            onDone()
          }}
          data-testid="exercise-note"
        />
      </label>
    </div>
  )
}

export const ExerciseBlock = memo(
  ExerciseBlockImpl,
  (a, b) =>
    a.sig === b.sig &&
    a.open === b.open &&
    a.collapsible === b.collapsible &&
    a.effort === b.effort &&
    a.index === b.index &&
    a.count === b.count &&
    a.aliases === b.aliases &&
    a.media === b.media &&
    a.exercise?.id === b.exercise?.id &&
    a.muscle === b.muscle &&
    a.session.id === b.session.id &&
    a.session.date === b.session.date &&
    a.session.startedAt === b.session.startedAt,
)
