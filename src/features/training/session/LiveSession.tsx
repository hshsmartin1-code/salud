import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProfile, useRepo } from '../../../app/profile'
import type { ExerciseSet, TrainingSession } from '../../../db/types'
import { isWorkSet } from '../../../domain/setKind'
import { formatNumber } from '../../../domain/units'
import { useConfirm } from '../../../ui/Confirm'
import { Icon } from '../../../ui/Icon'
import { IconButton } from '../../../ui/IconButton'
import { Menu } from '../../../ui/Menu'
import { useToast } from '../../../ui/Toast'
import { useExerciseMedia } from '../exerciseMedia'
import { startRest } from '../restTimer'
import { deleteSession, hasMeasure } from '../session'
import { finishSessionWhenSettled, touchedSetIds, undoFinish } from '../sessionWork'
import { SessionActionsContext } from './actions'
import { ElapsedClock } from './clock'
import type { Effort } from './columns'
import { blockSignature, smoothScroll, useSessionEditor, type Catalog } from './editor'
import { ExerciseBlock } from './ExerciseBlock'
import { FinishSheet } from './FinishSheet'
import { currentExerciseId, forgetToggles, isExerciseOpen, sessionStats } from './model'
import { RECORD_SEPARATOR, type RecordLine } from './records'
import { probeRender } from './renderProbe'
import { RestBar, RestPill, RestPopover } from './rest'
import { TrainingSettingsSheet } from './sheets'
import { SAVE_FAILED, useSaveGuard } from './saveGuard'
import { useWakeLock } from './useWakeLock'

/** Wall clock, read only in callbacks and effects. */
const clockNow = () => Date.now()

/** Bottom edge of the sticky session header (a focused row must stay below it). */
function headerBottom(): number {
  return document.querySelector('[data-session-header]')?.getBoundingClientRect().bottom ?? 0
}

const scrollToExercise = (id: string, block: 'start' | 'center' = 'start') => {
  const el = document.querySelector<HTMLElement>(`[data-exercise-id="${CSS.escape(id)}"]`)
  if (!el) return
  const rect = el.getBoundingClientRect()
  const top = block === 'start' ? rect.top - headerBottom() - 8 : rect.top - (window.innerHeight - rect.height) / 2
  window.scrollBy({ top, behavior: smoothScroll() })
}

/**
 * The live session in focus mode: a sticky bar (minimise, name, rest, Terminar) with the state strip,
 * then one block per exercise. Typing in a row re-renders only that row; the clock and the rest pill
 * are their own subscribers.
 */
export function LiveSession({ session, sets, prs, ex }: { session: TrainingSession; sets: ExerciseSet[]; prs: ReadonlyMap<string, string>; ex: Catalog }) {
  probeRender('screen')
  const profile = useProfile()
  const r = useRepo()
  const nav = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const guard = useSaveGuard()
  const confirm = useConfirm()
  const media = useExerciseMedia()
  const training = profile.settings.training
  const effort: Effort = training?.effort ?? 'none'
  useWakeLock(training?.keepAwake === true)

  const [manual, setManual] = useState<Record<string, boolean>>({})
  const [restOpen, setRestOpen] = useState(false)
  const closeRest = useCallback(() => setRestOpen(false), [])
  const toggleRest = useCallback(() => setRestOpen((o) => !o), [])
  const headerRef = useRef<HTMLElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const revealNext = useRef(false)
  const focusRow = useRef<HTMLElement | null>(null)
  const keyboardSpacer = useRef<HTMLDivElement>(null)

  // Keeps the focused row and its done button between the sticky bar and the keyboard.
  const reveal = useCallback(() => {
    const el = focusRow.current
    const active = document.activeElement
    if (!el?.isConnected || !(active instanceof HTMLInputElement) || !el.contains(active)) return
    const vv = window.visualViewport
    const top = Math.max(headerBottom(), vv?.offsetTop ?? 0) + 8
    const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 8
    const rect = el.getBoundingClientRect()
    let dy = 0
    if (rect.bottom > bottom) dy = rect.bottom - bottom
    if (rect.top - dy < top) dy = rect.top - top
    if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'auto' })
  }, [])
  useEffect(() => {
    // The on-screen keyboard shrinks the visual viewport after the focus: check again then. A spacer as
    // tall as the keyboard gives the page room to lift even the last row above it (set directly, no
    // re-render of the screen).
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      if (keyboardSpacer.current) keyboardSpacer.current.style.height = inset > 80 ? `${inset}px` : '0px'
      reveal()
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [reveal])

  // The rest bar appears and folds inside the sticky header: the page scrolls by the same amount so the set rows
  // stay where the thumb is (a row never moves under it when a rest starts or ends).
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let h = el.getBoundingClientRect().height
    const ro = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().height
      const d = next - h
      h = next
      if (Math.abs(d) >= 1) window.scrollBy({ top: d, behavior: 'auto' })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { actions, sheets, byExercise, openPicker } = useSessionEditor(session, sets, ex, {
    toggleOpen: (id, open) => setManual((m) => ({ ...m, [id]: open })),
    onAdded: (id) => {
      setManual((m) => ({ ...m, [id]: true }))
      window.setTimeout(() => scrollToExercise(id, 'center'), 80)
    },
    revealRow: (el) => {
      focusRow.current = el
      window.setTimeout(reveal, 60)
      window.setTimeout(reveal, 320)
    },
    afterComplete: (set, restSec) => {
      try {
        navigator.vibrate?.(12)
      } catch {
        /* no vibration */
      }
      justCompleted.current.set(set.id, clockNow())
      const others = (byExercise.get(set.exerciseId) ?? []).filter((x) => x.id !== set.id)
      if (others.every((x) => x.done)) revealNext.current = true
      const t = profile.settings.training
      if (restSec > 0 && isWorkSet(set) && t?.autoRest !== false) {
        // Device-local timer: the synced session row is not rewritten (see restTimer.ts).
        startRest(profile.id, session.id, restSec, { restAlert: t?.restAlert, exerciseId: set.exerciseId, setId: set.id })
        // A 2.2.1 client may have left a timer in the row: clear it once, never write a new one.
        if (session.restEndsAt != null) void guard(r.update('trainingSessions', session.id, { restEndsAt: null }))
      }
    },
  })

  const order = session.exerciseOrder
  const current = currentExerciseId(order, byExercise)
  const stats = useMemo(() => sessionStats(sets), [sets])
  const recordLines = useMemo<RecordLine[]>(
    () =>
      sets
        .filter((s) => s.done && prs.has(s.id))
        .flatMap((s) => prs.get(s.id)!.split(RECORD_SEPARATOR).map((text, i) => ({ key: `${s.id}:${i}`, exercise: order.find((o) => o.exerciseId === s.exerciseId)?.name ?? s.exerciseName, text }))),
    [sets, prs, order],
  )
  const records = useMemo(() => sets.filter((s) => s.done && prs.has(s.id)).length, [sets, prs])

  // Record moment: a set completed here that the shared record logic now marks as a record is
  // announced once (toast + distinct vibration); the row shows its own mark (SetRow).
  const justCompleted = useRef(new Map<string, number>())
  const announced = useRef(new Set<string>())
  useEffect(() => {
    const now = clockNow()
    for (const [id, at] of justCompleted.current) {
      if (now - at > 15_000) {
        justCompleted.current.delete(id)
        continue
      }
      const text = prs.get(id)
      if (!text || announced.current.has(id)) continue
      announced.current.add(id)
      justCompleted.current.delete(id)
      try {
        navigator.vibrate?.([20, 40, 20])
      } catch {
        /* no vibration */
      }
      toast.show({ message: `Récord · ${text.split(RECORD_SEPARATOR)[0]}`, duration: 3500 })
    }
  }, [prs, toast])

  // Pending rows the person typed or confirmed values in (finishing offers to keep them).
  const withData = useMemo(() => {
    if (!finishOpen) return [] as string[]
    const touched = touchedSetIds(session.id)
    const tracking = new Map(order.map((o) => [o.exerciseId, o.trackingType]))
    return sets.filter((s) => !s.done && touched.has(s.id) && hasMeasure(s, tracking.get(s.exerciseId))).map((s) => s.id)
  }, [finishOpen, sets, order, session.id])

  // When the exercise in progress changes (its last set was just completed) the finished one folds and
  // the next one opens, whatever was toggled by hand on those two; every other manual toggle is kept.
  const [seenCurrent, setSeenCurrent] = useState(current)
  if (seenCurrent !== current) {
    setSeenCurrent(current)
    const next = forgetToggles(manual, [current, seenCurrent])
    if (next !== manual) setManual(next)
  }
  useEffect(() => {
    if (!revealNext.current || !current) return
    revealNext.current = false
    const el = document.querySelector<HTMLElement>(`[data-exercise-id="${CSS.escape(current)}"]`)
    if (!el) return
    const top = el.getBoundingClientRect().top - headerBottom() - 8
    if (top < 0 || top > window.innerHeight * 0.55) scrollToExercise(current)
  }, [current])

  const minimise = () => {
    if (location.key !== 'default') nav(-1)
    else nav('/entreno')
  }

  async function finish(complete: boolean) {
    // Flushes every draft and waits for set completions still being written (a set tapped done a
    // moment ago must not be discarded as pending), then finishes in one transaction.
    let out: Awaited<ReturnType<typeof finishSessionWhenSettled>>
    try {
      out = await finishSessionWhenSettled(r, session, { completeTouched: complete })
    } catch (e) {
      // Nothing was finished (one transaction): the sheet stays open and can be retried.
      toast.show({ message: SAVE_FAILED })
      throw e
    }
    const { snapshot, touchedIds } = out
    setFinishOpen(false)
    window.scrollTo({ top: 0 })
    // The removed rows stay in memory for the undo window only.
    toast.show({
      message: 'Entrenamiento terminado',
      actionLabel: 'Deshacer',
      duration: 8000,
      onAction: () => {
        void guard(undoFinish(r, snapshot, touchedIds)).then((ok) => {
          if (ok === false) toast.show({ message: 'No se pudo reabrir: el entrenamiento cambió o hay otro en curso.' })
        })
      },
    })
  }

  async function discard() {
    const ok = await confirm({
      title: '¿Descartar este entrenamiento?',
      body: 'Se borran la sesión y todas sus series, también las completadas. No se puede deshacer.',
      confirmLabel: 'Descartar',
      tone: 'danger',
    })
    if (!ok) return
    if ((await guard(deleteSession(r, session).then(() => true))) !== true) return
    nav('/entreno', { replace: true })
  }

  return (
    <SessionActionsContext.Provider value={actions}>
      <div className="pb-24 lg:pb-12" data-testid="live-session">
        <header ref={headerRef} data-session-header className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/90 pt-safe backdrop-blur-xl lg:-mx-10">
          <div className="mx-auto flex h-12 max-w-2xl items-center gap-1 px-1.5 lg:px-4">
            <IconButton icon="chevronDown" label="Minimizar sesión" onClick={minimise} size={22} />
            <h1 className="min-w-0 flex-1 truncate pl-0.5 text-heading">{session.name}</h1>
            <RestPill profile={profile} sessionId={session.id} onOpen={toggleRest} open={restOpen} />
            <button
              type="button"
              className="hit-44 ml-1 mr-1 h-9 shrink-0 rounded-full bg-ink px-4 text-label font-semibold text-ink-contrast hover:bg-ink/90 active:scale-[0.97] motion-safe:transition"
              onClick={() => setFinishOpen(true)}
              data-testid="finish-session"
            >
              Terminar
            </button>
          </div>
          <div className="mx-auto flex max-w-2xl items-center gap-2 pb-1 pl-4 pr-1.5 lg:pl-6 lg:pr-4" data-testid="session-strip">
            <div className="grid min-w-0 flex-1 grid-cols-[1fr_1fr_1.35fr] gap-3">
              <StripCell label="Tiempo">
                <ElapsedClock startedAt={session.startedAt} className="readout text-[17px] leading-none" />
              </StripCell>
              <StripCell label="Series">
                <span className="readout text-[17px] leading-none">
                  {stats.workDone}
                  <span className="text-label font-semibold text-muted"> / {stats.workTotal}</span>
                </span>
              </StripCell>
              <StripCell label="Volumen">
                <span className="readout flex items-baseline gap-1 text-[17px] leading-none">
                  <span data-testid="session-volume">{formatNumber(stats.volume, 0)}</span>
                  <span className="text-micro font-medium text-muted">kg</span>
                  {records ? (
                    <span className="ml-1 flex items-center gap-0.5 self-center text-micro font-semibold text-warn" aria-label={`${records} ${records === 1 ? 'récord' : 'récords'}`}>
                      <Icon name="trophy" size={13} strokeWidth={2.2} />
                      {records}
                    </span>
                  ) : null}
                </span>
              </StripCell>
            </div>
            <span className="-my-1.5 shrink-0">
              <Menu
                label="Opciones de la sesión"
                items={[
                  { label: 'Agregar ejercicio', icon: 'plus', onSelect: openPicker },
                  { label: 'Ajustes del entreno', icon: 'sliders', onSelect: () => setSettingsOpen(true) },
                  { label: 'Descartar entrenamiento', icon: 'trash', tone: 'danger', onSelect: () => void discard() },
                ]}
              />
            </span>
          </div>
          <RestBar profile={profile} sessionId={session.id} onOpen={toggleRest} open={restOpen} />
          <RestPopover open={restOpen} onClose={closeRest} profile={profile} sessionId={session.id} order={order} currentId={current} />
        </header>

        <div className="mx-auto max-w-2xl space-y-2.5 pt-3">
          {order.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface px-5 py-8 text-center" data-testid="empty-session">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-train/15 text-train">
                <Icon name="dumbbell" size={24} />
              </div>
              <p className="text-heading">Entrenamiento libre</p>
              <p className="mx-auto mt-1 max-w-xs text-body text-muted">Agrega el primer ejercicio y registra cada serie al terminarla.</p>
              <button type="button" className="btn-primary mt-5 min-w-[220px]" onClick={openPicker} data-testid="add-exercise">
                <Icon name="plus" size={18} strokeWidth={2.4} /> Agregar ejercicio
              </button>
            </div>
          ) : (
            order.map((item, i) => {
              const rows = byExercise.get(item.exerciseId) ?? []
              const e = ex.byId.get(item.exerciseId)
              return (
                <div key={item.exerciseId} data-exercise-id={item.exerciseId}>
                  <ExerciseBlock
                    session={session}
                    item={item}
                    sets={rows}
                    index={i}
                    count={order.length}
                    open={isExerciseOpen(item.exerciseId, current, manual)}
                    collapsible
                    effort={effort}
                    prs={prs}
                    aliases={ex.aliases}
                    exercise={e}
                    media={media}
                    muscle={e?.primaryMuscles[0] ? ex.labels.muscles[e.primaryMuscles[0]] : undefined}
                    sig={blockSignature(item, rows, prs)}
                  />
                </div>
              )
            })
          )}
          {order.length ? (
            <button type="button" className="btn-secondary h-12 w-full" onClick={openPicker} data-testid="add-exercise">
              <Icon name="plus" size={18} strokeWidth={2.4} /> Agregar ejercicio
            </button>
          ) : null}
        </div>
        <div ref={keyboardSpacer} aria-hidden />
      </div>

      {sheets}
      <TrainingSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} profile={profile} />
      <FinishSheet open={finishOpen} onClose={() => setFinishOpen(false)} session={session} stats={stats} records={recordLines} withData={withData.length} onFinish={finish} />
    </SessionActionsContext.Provider>
  )
}

function StripCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-medium leading-3 text-muted">{label}</div>
      <div className="mt-px truncate">{children}</div>
    </div>
  )
}
