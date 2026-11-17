import { memo, useMemo, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useRepo } from '../../../app/profile'
import type { TrackingType } from '../../../db/catalogTypes'
import type { ExerciseSet } from '../../../db/types'
import { setKind, SET_KIND_SHORT } from '../../../domain/setKind'
import { Icon } from '../../../ui/Icon'
import { useToast } from '../../../ui/Toast'
import { canCompleteSet, formatSetField, SET_FIELDS, type SetDraftField, type SetDraftValues } from '../draft'
import { markSetDone, type MeasurePatch } from '../session'
import { cancelRestForSet } from '../restTimer'
import { applyAndTouch, trackSessionWork } from '../sessionWork'
import { formatSet } from '../sets'
import { useSetDraft } from '../useSetDraft'
import { useSessionActions } from './actions'
import { KIND_TONE, kindName } from './kinds'
import { EFFORT_LABEL, FIELD_LABEL, inputModeFor, rowFields, type Effort } from './columns'
import { formatPrevious, setSignature, spokenPrevious } from './model'
import { RECORD_SEPARATOR } from './records'
import { useSaveGuard } from './saveGuard'
import { probeRender } from './renderProbe'

/**
 * "Aplicar a las siguientes" is offered by one row at a time: the last pending work row whose measure
 * (weight, reps, time or distance) was typed. Kept outside React so other rows do not re-render.
 */
let offerId: string | null = null
const offerListeners = new Set<() => void>()
function setOffer(id: string | null) {
  if (offerId === id) return
  offerId = id
  for (const l of offerListeners) l()
}
const subscribeOffer = (l: () => void) => {
  offerListeners.add(l)
  return () => {
    offerListeners.delete(l)
  }
}

/** Next set input in document order (Enter on the keyboard: weight → reps → next row). */
function focusNextInput(from: HTMLInputElement) {
  const all = [...document.querySelectorAll<HTMLInputElement>('input[data-set-input]')]
  const next = all[all.indexOf(from) + 1]
  if (next) next.focus()
  else from.blur()
}

interface SetRowProps {
  set: ExerciseSet
  /** Ordinal among work sets (0 for warm-ups). */
  n: number
  tracking: TrackingType
  effort: Effort
  /** Comparable set of the previous session (null: none). */
  prev: ExerciseSet | null
  /** Record texts (RECORD_SEPARATOR separated) when this set is a record. */
  prs?: string
  /** Comma-separated ids of the later pending work rows of this exercise ('' for none or a warm-up). */
  following: string
  restSec: number
  template: string
}

function SetRowImpl({ set, n, tracking, effort, prev, prs, following, restSec, template }: SetRowProps) {
  probeRender(`row:${set.id}`)
  const r = useRepo()
  const actions = useSessionActions()
  const fields = useMemo(() => rowFields(tracking, effort), [tracking, effort])
  // Every change goes through the crash-safe draft: saved ≤ 120 ms after typing, never on blur only.
  const draft = useSetDraft(r, set, tracking, fields)
  const rowRef = useRef<HTMLDivElement>(null)
  const kind = setKind(set)
  const name = kindName(kind, n)
  const measure = SET_FIELDS[tracking]
  const toast = useToast()
  const guard = useSaveGuard()
  const offered = useSyncExternalStore(subscribeOffer, () => offerId === set.id)

  async function applyFollowing() {
    const patch: MeasurePatch = {}
    for (const f of measure) {
      const v = draft.values[f]
      if (v != null) (patch as Record<string, number>)[f] = v
    }
    setOffer(null)
    if (!Object.keys(patch).length || !following) return
    await draft.flush()
    const { count, undo } = await applyAndTouch(r, set.sessionId, following.split(','), patch)
    toast.show(
      count
        ? { message: count === 1 ? 'Aplicado a 1 serie' : `Aplicado a ${count} series`, actionLabel: 'Deshacer', onAction: () => void guard(undo()) }
        : { message: 'Las siguientes ya tenían esos valores' },
    )
  }

  const focusField = (f: SetDraftField) => rowRef.current?.querySelector<HTMLInputElement>(`input[data-field="${f}"]`)?.focus()

  const copyPrevious = () => {
    if (!prev) return
    for (const f of measure) draft.change(f, formatSetField(f, prev[f]))
  }

  async function toggleDone() {
    if (set.done) {
      await draft.flush()
      await markSetDone(r, set.id, draft.values, false)
      // Un-ticking the set that started the current rest ends that rest (and its notification).
      cancelRestForSet(r.profileId, set.sessionId, set.id)
      return
    }
    const bad = fields.find((f) => draft.invalid[f])
    if (bad) return focusField(bad)
    let values: SetDraftValues = draft.values
    // An empty row whose placeholders show last time's values completes with those values (one tap).
    if (!canCompleteSet(values, tracking) && prev) {
      const filled: SetDraftValues = { ...values }
      for (const f of measure) {
        if (filled[f] == null && prev[f] != null) {
          filled[f] = prev[f]
          draft.change(f, formatSetField(f, prev[f]))
        }
      }
      values = filled
    }
    if (!canCompleteSet(values, tracking)) {
      const missing = measure.find((f) => values[f] == null) ?? measure[0]!
      return focusField(missing)
    }
    await draft.flush()
    await markSetDone(r, set.id, values, true)
    // A completed row cannot offer "Aplicar a las siguientes". Drop its external-store selection
    // now, so typing in the next row does not also re-render this one.
    if (offerId === set.id) setOffer(null)
    actions.afterComplete(set, restSec)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      focusNextInput(e.currentTarget)
    }
  }

  const done = set.done
  const prevText = formatPrevious(prev, tracking)
  return (
    <div
      ref={rowRef}
      className={`rounded-lg motion-safe:transition-colors motion-safe:duration-state ${done ? 'bg-train/[0.07]' : ''}`}
      data-testid="set-row"
      data-done={done ? 'true' : 'false'}
    >
      <div className="grid min-h-12 items-center gap-x-1.5 pl-0.5 pr-1" style={{ gridTemplateColumns: template }}>
        <button
          type="button"
          className={`hit-44 flex h-10 items-center justify-center rounded-lg text-body font-semibold num hover:bg-surface2 ${kind === 'normal' ? 'text-muted' : `${KIND_TONE[kind]} font-bold`}`}
          aria-label={`${name}. Cambiar tipo o eliminar`}
          aria-haspopup="menu"
          onClick={() => actions.openSetMenu(set.id)}
        >
          {kind === 'normal' ? n : SET_KIND_SHORT[kind]}
        </button>
        <div className="relative min-w-0">
          {prev && prevText !== '—' ? (
            <button
              type="button"
              className={`flex h-11 w-full min-w-0 items-center rounded-lg px-1 text-left hover:bg-surface2 ${prs ? 'pr-6' : ''}`}
              aria-label={`Copiar la vez anterior: ${spokenPrevious(prev, tracking)}`}
              onClick={copyPrevious}
            >
              <span className={`readout truncate text-[16px] font-semibold ${done ? 'text-faint' : 'text-muted'}`}>{prevText}</span>
            </button>
          ) : (
            <span className="flex h-10 items-center px-1 text-faint" aria-label="Sin dato anterior">
              —
            </span>
          )}
          {prs ? (
            <span className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-warn" role="img" aria-label={`Récord: ${prs}`} title={`Récord: ${prs}`} data-testid="pr-badge">
              <Icon name="trophy" size={16} strokeWidth={2.1} />
            </span>
          ) : null}
        </div>
        {fields.map((f) => {
          const invalid = !!draft.invalid[f]
          const isEffort = f === 'rpe' || f === 'rir'
          const label = isEffort ? EFFORT_LABEL[f] : FIELD_LABEL[tracking][f]!
          const hint = !isEffort && prev ? formatSetField(f, prev[f]) : ''
          return (
            <input
              key={f}
              data-set-input=""
              data-field={f}
              className={`h-11 w-full min-w-0 rounded-lg px-0.5 text-center readout text-[19px] outline-none placeholder:font-semibold placeholder:text-faint/60 focus:ring-2 focus:ring-accent motion-safe:transition-colors ${
                done ? 'bg-transparent' : 'bg-surface2'
              } ${invalid ? 'text-bad ring-2 ring-bad/80' : done ? 'font-medium text-muted' : 'text-ink'} ${isEffort ? 'text-[17px]' : ''}`}
              inputMode={inputModeFor(f)}
              enterKeyHint="next"
              autoComplete="off"
              spellCheck={false}
              aria-label={label}
              aria-invalid={invalid || undefined}
              placeholder={hint || (f === 'durationSec' ? 'm:ss' : '—')}
              {...draft.bind(f)}
              onChange={(e) => {
                draft.change(f, e.target.value)
                if (!isEffort && following) setOffer(set.id)
              }}
              onFocus={(e) => {
                const el = e.currentTarget
                requestAnimationFrame(() => {
                  if (document.activeElement === el) el.select()
                })
                if (rowRef.current) actions.revealRow(rowRef.current)
              }}
              onKeyDown={onKeyDown}
            />
          )
        })}
        <button
          type="button"
          className={`flex h-11 w-11 items-center justify-center justify-self-end rounded-xl motion-safe:transition-colors motion-safe:duration-state active:scale-95 ${
            done ? 'bg-train text-ink-contrast' : 'bg-surface2 text-faint hover:text-ink'
          }`}
          aria-label={done ? `${name} hecha. Marcar como no hecha` : `Completar ${name.toLowerCase()}`}
          aria-pressed={done}
          onClick={() => void guard(trackSessionWork(toggleDone()))}
          data-testid="set-done"
        >
          <Icon name="check" size={22} strokeWidth={done ? 2.8 : 2.2} className={done ? 'anim-pop' : ''} />
        </button>
      </div>
      {prs && done ? (
        // Mounted when the record appears: the one-shot pop (off with reduced motion, index.css).
        <p className="anim-pop mb-1 ml-11 mr-12 flex items-center gap-1 px-1 text-label font-semibold text-warn" data-testid="set-record">
          <Icon name="trophy" size={14} strokeWidth={2.2} /> Récord · {prs.split(RECORD_SEPARATOR)[0]}
        </p>
      ) : null}
      {offered && following && !done ? (
        <button
          type="button"
          className="mb-1 ml-11 mr-12 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-left text-label font-semibold text-accent hover:bg-surface2"
          onClick={() => void guard(applyFollowing())}
          data-testid="apply-following"
        >
          <Icon name="copy" size={15} strokeWidth={2.2} />
          Aplicar {formatSet({ weight: draft.values.weight ?? null, reps: draft.values.reps ?? null, durationSec: draft.values.durationSec ?? null, distanceM: draft.values.distanceM ?? null }, tracking)} a las siguientes ({following.split(',').length})
        </button>
      ) : null}
      {draft.failed ? (
        <p className="mb-1 ml-11 mr-12 flex items-center gap-1 px-1 text-label font-medium text-bad" role="status" data-testid="set-unsaved">
          <Icon name="alert" size={14} strokeWidth={2.2} /> No guardado: se reintentará al seguir escribiendo o al salir
        </p>
      ) : null}
      {set.notes ? (
        <button type="button" className="mb-1 ml-11 mr-12 block max-w-full truncate rounded px-1 text-left text-label text-muted hover:text-ink" onClick={() => actions.openSetNote(set.id)}>
          <span className="sr-only">Nota de la serie: </span>
          {set.notes}
        </button>
      ) : null}
    </div>
  )
}

/** Memoised: live queries hand out new objects, so rows compare what they actually render. */
export const SetRow = memo(
  SetRowImpl,
  (a, b) =>
    a.n === b.n &&
    a.tracking === b.tracking &&
    a.effort === b.effort &&
    a.prs === b.prs &&
    a.following === b.following &&
    a.restSec === b.restSec &&
    a.template === b.template &&
    setSignature(a.set) === setSignature(b.set) &&
    setSignature(a.prev) === setSignature(b.prev),
)
