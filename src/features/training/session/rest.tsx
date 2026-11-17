import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRepo } from '../../../app/profile'
import type { Profile, SessionExercise } from '../../../db/types'
import { enableRestNotifications, exactAlarmsBlocked, markRestNotificationIntroSeen, openExactAlarmSettings, restNotificationIntroSeen, restNotificationStatus } from '../../../integrations/notifications'
import { Icon } from '../../../ui/Icon'
import { IconButton } from '../../../ui/IconButton'
import { useDismissable } from '../../../ui/useDismissable'
import { parseRestDuration, startRest, REST_MAX_SEC, REST_MIN_SEC, type RestTimer } from '../restTimer'
import { updateSessionExercise } from '../session'
import { formatDuration } from '../sets'
import { REST_PRESETS } from './model'
import { probeRender } from './renderProbe'
import { useSaveGuard } from './saveGuard'
import { OVER_KEEP_SEC, useSessionRest } from './useSessionRest'

type RestProfile = Pick<Profile, 'id' | 'settings'>

/** The bar is on screen while a rest runs, is paused, or has just ended (a few seconds, then it folds by itself). */
const showsRest = (t: RestTimer) => t.status === 'running' || t.status === 'paused' || (t.status === 'over' && t.overSec < OVER_KEEP_SEC)

/** Marks the controls that open the popover, so a press on them is not an "outside" press. */
const TRIGGER = 'data-rest-trigger'

/**
 * No rest on screen: the small timer button of the session bar (opens the popover to start any duration).
 * With a rest on screen it renders nothing: the bar below the header has the countdown.
 */
export function RestPill({ profile, sessionId, onOpen, open }: { profile: RestProfile; sessionId: string; onOpen: () => void; open: boolean }) {
  const timer = useSessionRest(profile, sessionId)
  if (showsRest(timer)) return null
  return <IconButton icon="timer" label="Descanso" onClick={onOpen} pressed={open} aria-expanded={open} aria-haspopup="dialog" data-testid="rest-timer" data-rest-trigger="" />
}

/**
 * The compact rest bar, docked under the sticky session header: time left with a thin progress line, −15,
 * +15, pause/resume and end. Tapping the time opens the popover. Its own subscriber, so its ticks never
 * re-render the session list. It lives in the flow of the header: it never covers a set row.
 */
export function RestBar({ profile, sessionId, onOpen, open }: { profile: RestProfile; sessionId: string; onOpen: () => void; open: boolean }) {
  const timer = useSessionRest(profile, sessionId)
  probeRender('restPill')
  if (!showsRest(timer)) return null
  const over = timer.status === 'over'
  const paused = timer.status === 'paused'
  const pct = over ? 100 : Math.max(0, Math.min(100, timer.fraction * 100))
  const step = 'flex h-11 min-w-11 shrink-0 select-none items-center justify-center rounded-xl px-1.5 text-ink hover:bg-surface2 active:scale-95 motion-safe:transition'
  return (
    <div className={`relative border-t border-line ${over ? 'bg-good/10' : 'bg-train/[0.07]'}`} data-testid="rest-bar" data-state={timer.status}>
      <div className="mx-auto flex h-12 max-w-2xl items-center gap-0.5 pl-4 pr-1.5 lg:pl-6 lg:pr-4">
        <button
          type="button"
          data-rest-trigger=""
          onClick={onOpen}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={over ? 'Descanso terminado. Cambiar duración' : `Descanso${paused ? ' en pausa' : ''}: quedan ${formatDuration(timer.leftSec)}. Cambiar duración`}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="rest-timer"
        >
          <Icon name={over ? 'check' : paused ? 'pause' : 'timer'} size={18} strokeWidth={2.3} className={over ? 'text-good' : 'text-train'} />
          <span className={`readout text-[24px] leading-none ${over ? 'text-good' : ''}`}>{over ? '0:00' : formatDuration(timer.leftSec)}</span>
          <span className="truncate text-label text-muted">{over ? 'Descanso terminado' : paused ? `En pausa · de ${formatDuration(timer.totalSec)}` : `de ${formatDuration(timer.totalSec)}`}</span>
        </button>
        {over ? null : (
          <>
            <button type="button" className={step} onClick={() => timer.add(-15)} aria-label="Restar 15 segundos">
              <span className="readout text-[17px]">−15</span>
            </button>
            <button type="button" className={step} onClick={() => timer.add(15)} aria-label="Sumar 15 segundos">
              <span className="readout text-[17px]">+15</span>
            </button>
            <button type="button" className={step} onClick={() => (paused ? timer.resume() : timer.pause())} aria-label={paused ? 'Reanudar descanso' : 'Pausar descanso'} data-testid="rest-pause">
              <Icon name={paused ? 'play' : 'pause'} size={20} strokeWidth={2.4} />
            </button>
            <button type="button" className={`${step} text-muted`} onClick={() => timer.skip()} aria-label="Terminar descanso" data-testid="rest-end">
              <Icon name="x" size={20} strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line" aria-hidden>
        <div className={`h-full ${over ? 'bg-good' : 'bg-train'} motion-safe:transition-[width] motion-safe:duration-progress motion-safe:ease-linear`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * Small popover anchored under the session header (never a sheet, never taller than about 220 px): quick
 * durations, a typed one ("90", "1:30", "2:00") and "Usar para este ejercicio". Choosing one starts (or
 * restarts) the rest and closes it. A rest that reaches zero closes it too.
 */
export function RestPopover({ open, onClose, profile, sessionId, order, currentId }: { open: boolean; onClose: () => void; profile: RestProfile; sessionId: string; order: readonly SessionExercise[]; currentId: string | null }) {
  if (!open) return null
  return <PopoverBody onClose={onClose} profile={profile} sessionId={sessionId} order={order} currentId={currentId} />
}

function PopoverBody({ onClose, profile, sessionId, order, currentId }: { onClose: () => void; profile: RestProfile; sessionId: string; order: readonly SessionExercise[]; currentId: string | null }) {
  const r = useRepo()
  const guard = useSaveGuard()
  const timer = useSessionRest(profile, sessionId)
  const box = useRef<HTMLDivElement>(null)
  const [custom, setCustom] = useState('')
  const [remember, setRemember] = useState(false)
  const item = order.find((o) => o.exerciseId === (timer.state?.exerciseId ?? currentId))
  const parsed = parseRestDuration(custom)
  const invalid = custom.trim() !== '' && parsed === null
  const active = timer.status === 'running' || timer.status === 'paused' ? timer.totalSec : null

  useDismissable(true, onClose)
  // A rest that reaches zero closes the popover: nothing stays on screen that needs dismissing.
  const was = useRef(timer.status)
  useEffect(() => {
    if (was.current !== 'over' && timer.status === 'over') onClose()
    was.current = timer.status
  }, [timer.status, onClose])
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
  }, [])
  // An outside press closes it (the controls that open it toggle it themselves).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const n = e.target as Element | null
      if (box.current?.contains(n) || n?.closest?.(`[${TRIGGER}]`)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose])

  const choose = (sec: number) => {
    startRest(profile.id, sessionId, sec, { restAlert: profile.settings.training?.restAlert, exerciseId: item?.exerciseId })
    if (remember && item && item.restSec !== sec) void guard(updateSessionExercise(r, sessionId, item.exerciseId, { restSec: sec }))
    onClose()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
    document.querySelector<HTMLElement>(`[${TRIGGER}]`)?.focus()
  }

  return (
    <div className="absolute inset-x-0 top-full z-10" onKeyDown={onKey}>
      <div className="mx-auto max-w-2xl px-3 lg:px-5">
        <div ref={box} role="dialog" aria-label="Descanso" className="mt-1.5 max-h-[232px] overflow-y-auto rounded-2xl border border-line-strong bg-surface p-2.5 shadow-lg" data-testid="rest-popover">
          <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Duraciones frecuentes, en segundos">
            {REST_PRESETS.map((s, i) => (
              <button
                key={s}
                type="button"
                data-autofocus={i === 0 ? '' : undefined}
                className={`flex h-11 items-center justify-center rounded-xl readout text-[19px] outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95 motion-safe:transition ${active === s ? 'bg-train/20 text-ink' : 'bg-surface2 hover:bg-line'}`}
                aria-label={`${s} segundos`}
                data-testid={`rest-preset-${s}`}
                onClick={() => choose(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="mt-1.5 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (parsed !== null) choose(parsed)
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Otra duración: segundos o minutos y segundos, de {REST_MIN_SEC} s a {REST_MAX_SEC / 60} min</span>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Otra: 90 o 1:30"
                aria-invalid={invalid || undefined}
                data-testid="rest-custom"
                className={`h-11 w-full rounded-xl bg-surface2 px-3 text-body outline-none placeholder:text-faint focus:ring-2 focus:ring-accent ${invalid ? 'text-bad ring-2 ring-bad/80' : 'text-ink'}`}
              />
            </label>
            <button type="submit" className="btn-primary h-11 shrink-0 px-4" disabled={parsed === null} data-testid="rest-custom-start">
              Iniciar
            </button>
          </form>
          {invalid ? (
            <p className="mt-1 px-1 text-micro text-bad" role="alert">
              De 5 s a 60 min: «90», «1:30» o «2:00».
            </p>
          ) : null}
          {item ? (
            <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-1.5 text-label text-ink hover:bg-surface2/60">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="rest-remember" />
              <span className="min-w-0 flex-1 truncate">Usar para este ejercicio</span>
              <span className="num shrink-0 text-muted">{item.restSec ? formatDuration(item.restSec) : 'sin descanso'}</span>
            </label>
          ) : null}
          <NotificationLine profile={profile} />
          <ExactAlarmLine />
        </div>
      </div>
    </div>
  )
}

/**
 * Only when notifications are on but the system does not allow exact alarms: one line and one action. The system
 * screen opens only when the person taps (the app never opens settings by itself). Re-checked when the app returns.
 */
function ExactAlarmLine() {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    let alive = true
    const check = () => void exactAlarmsBlocked().then((b) => alive && setBlocked(b))
    check()
    document.addEventListener('visibilitychange', check)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  if (!blocked) return null
  return (
    <div className="mt-1 flex min-h-11 items-center gap-1 pl-1.5" data-testid="rest-exact-alarm">
      <span className="min-w-0 flex-1 text-label text-muted">El aviso puede llegar con retraso</span>
      <button type="button" className="hit-44 h-9 shrink-0 rounded-lg px-2.5 text-label font-semibold text-accent hover:bg-surface2" onClick={() => void openExactAlarmSettings()}>
        Permitir avisos puntuales
      </button>
    </div>
  )
}

/**
 * First time only, one inline line: allow the end-of-rest notification. Answering it (either way) removes it
 * for good; "Ajustes del entreno" can switch the alert back on.
 */
function NotificationLine({ profile }: { profile: Pick<Profile, 'settings'> }) {
  const [state, setState] = useState<'hidden' | 'ask' | 'granted'>('hidden')
  const alertOn = profile.settings.training?.restAlert !== false
  useEffect(() => {
    if (!alertOn || restNotificationIntroSeen()) return
    let alive = true
    void restNotificationStatus().then((s) => {
      if (alive && s === 'unasked') setState('ask')
    })
    return () => {
      alive = false
    }
  }, [alertOn])
  if (state === 'hidden') return null
  if (state === 'granted')
    return (
      <p className="mt-1 px-1.5 text-label text-muted" role="status">
        Listo: te avisaremos al terminar el descanso.
      </p>
    )
  return (
    <div className="mt-1 flex min-h-11 items-center gap-1 pl-1.5" data-testid="rest-notify-intro">
      <span className="min-w-0 flex-1 text-label text-muted">Aviso al terminar</span>
      <button
        type="button"
        className="hit-44 h-9 shrink-0 rounded-lg px-2.5 text-label font-semibold text-accent hover:bg-surface2"
        onClick={async () => {
          markRestNotificationIntroSeen()
          setState((await enableRestNotifications()) ? 'granted' : 'hidden')
        }}
      >
        Activar avisos
      </button>
      <button
        type="button"
        className="hit-44 h-9 shrink-0 rounded-lg px-2 text-label text-muted hover:bg-surface2"
        onClick={() => {
          markRestNotificationIntroSeen()
          setState('hidden')
        }}
      >
        Ahora no
      </button>
    </div>
  )
}
