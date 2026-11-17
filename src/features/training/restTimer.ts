/**
 * Device-local rest timer (V3).
 *
 * State lives ONLY on this device (localStorage, with an in-memory fallback), keyed by profile +
 * session. It is never written to the synced session row: in 2.2.1 `restEndsAt` rewrote the session
 * after every completed set and produced conflicts between devices. Everything is a timestamp, so the
 * remaining time is right after a reload and after the app spent any time in the background.
 *
 * Pure arithmetic (`restStart`, `restPause`, … and `restView`) is separate from the store, so it can be
 * tested with a fake clock. The end-of-rest alert is scheduled through src/integrations/notifications.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { cancelRestAlert, playRestEndCue, scheduleRestAlert } from '../../integrations/notifications'

export interface RestState {
  v: 1
  /** Total length of this rest in ms, including ±adjustments (for the progress bar). */
  totalMs: number
  /** Running: epoch ms when the rest ends. null while paused. */
  endsAt: number | null
  /** Paused: ms left when it was paused. null while running. */
  pausedLeftMs: number | null
  startedAt: number
  /** Optional: the exercise this rest follows (shown by the rest sheet). Kept through pause, ± and resume. */
  exerciseId?: string
  /** Optional: the set whose completion started this rest, so un-ticking that set cancels it. */
  setId?: string
}

export type RestStatus = 'idle' | 'running' | 'paused' | 'over'
export interface RestView {
  status: RestStatus
  /** Whole seconds left (rounded up); 0 when over. */
  leftSec: number
  /** Seconds past the end (0 unless over). */
  overSec: number
  totalSec: number
  /** 0..1 of the rest still to go. */
  fraction: number
  endsAt: number | null
}

// ───────────── Pure arithmetic ─────────────

export function restStart(durationSec: number, now: number, exerciseId?: string, setId?: string): RestState {
  const totalMs = Math.max(0, Math.round(durationSec * 1000))
  const s: RestState = { v: 1, totalMs, endsAt: now + totalMs, pausedLeftMs: null, startedAt: now }
  if (exerciseId) s.exerciseId = exerciseId
  if (setId) s.setId = setId
  return s
}

export function restLeftMs(s: RestState, now: number): number {
  return s.endsAt !== null ? s.endsAt - now : (s.pausedLeftMs ?? 0)
}

export function restPause(s: RestState, now: number): RestState {
  if (s.endsAt === null) return s
  return { ...s, endsAt: null, pausedLeftMs: Math.max(0, s.endsAt - now) }
}

export function restResume(s: RestState, now: number): RestState {
  if (s.endsAt !== null) return s
  return { ...s, endsAt: now + (s.pausedLeftMs ?? 0), pausedLeftMs: null }
}

/** ±seconds. Never below zero left; the bar total follows the change. */
export function restAdd(s: RestState, deltaSec: number, now: number): RestState {
  const delta = Math.round(deltaSec * 1000)
  const left = Math.max(0, restLeftMs(s, now))
  const nextLeft = Math.max(0, left + delta)
  const totalMs = Math.max(nextLeft, s.totalMs + (nextLeft - left))
  return s.endsAt !== null ? { ...s, totalMs, endsAt: now + nextLeft } : { ...s, totalMs, pausedLeftMs: nextLeft }
}

export function restView(s: RestState | null, now: number): RestView {
  if (!s) return { status: 'idle', leftSec: 0, overSec: 0, totalSec: 0, fraction: 0, endsAt: null }
  const left = restLeftMs(s, now)
  const totalSec = Math.round(s.totalMs / 1000)
  if (s.endsAt === null) return { status: 'paused', leftSec: Math.ceil(left / 1000), overSec: 0, totalSec, fraction: s.totalMs ? left / s.totalMs : 0, endsAt: null }
  if (left > 0) return { status: 'running', leftSec: Math.ceil(left / 1000), overSec: 0, totalSec, fraction: s.totalMs ? Math.min(1, left / s.totalMs) : 0, endsAt: s.endsAt }
  return { status: 'over', leftSec: 0, overSec: Math.floor(-left / 1000) || 0, totalSec, fraction: 0, endsAt: s.endsAt }
}

// ───────────── Typed duration ─────────────

export const REST_MIN_SEC = 5
export const REST_MAX_SEC = 3600

/**
 * Seconds from what a person types in the rest field: "90", "90 s", "1:30", "2:00". Null when it is not a
 * duration or falls outside 5 s – 60 min. A bare number is always seconds ("2" is invalid, not two minutes).
 */
export function parseRestDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  let sec: number
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(t)
  if (clock) sec = Number(clock[1]) * 60 + Number(clock[2])
  else {
    const plain = /^(\d{1,4})(s|seg)?$/.exec(t)
    if (!plain) return null
    sec = Number(plain[1])
  }
  return sec >= REST_MIN_SEC && sec <= REST_MAX_SEC ? sec : null
}

// ───────────── Device store ─────────────

const PREFIX = 'salud.rest|'
/** A finished rest older than this is forgotten. */
const STALE_MS = 6 * 3600_000

export const restKey = (profileId: string, sessionId: string) => `${PREFIX}${profileId}|${sessionId}`

const memory = new Map<string, RestState | null>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function parse(raw: string | null): RestState | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as RestState
    if (s?.v !== 1 || typeof s.totalMs !== 'number') return null
    return s
  } catch {
    return null
  }
}

/** A paused timer nobody resumed for this long is abandoned. */
const ABANDONED_PAUSE_MS = 24 * 3600_000

function isStale(s: RestState | null, now: number): boolean {
  if (!s) return true
  if (s.endsAt !== null) return now - s.endsAt > STALE_MS
  return now - s.startedAt > ABANDONED_PAUSE_MS
}

function read(key: string): RestState | null {
  if (memory.has(key)) return memory.get(key)!
  const st = storage()
  let raw: string | null = null
  try {
    raw = st?.getItem(key) ?? null
  } catch {
    raw = null
  }
  const s = parse(raw)
  const stale = raw !== null && isStale(s, Date.now())
  if (stale) {
    // Expired (or unreadable): remove the persistent key instead of keeping it forever.
    try {
      st?.removeItem(key)
    } catch {
      /* blocked storage */
    }
  }
  const fresh = stale ? null : s
  memory.set(key, fresh)
  return fresh
}

/** Most keys inspected per sweep (bounded work on start/finish). */
const SWEEP_MAX = 200

/**
 * Removes expired or unreadable rest timers of ONE profile (abandoned sessions). Other profiles' keys
 * are never touched. Bounded; safe when storage is blocked or does not support enumeration.
 */
export function sweepRestTimers(profileId: string, now = Date.now()): number {
  const st = storage()
  if (!st || typeof st.key !== 'function' || typeof st.length !== 'number') return 0
  const own = `${PREFIX}${profileId}|`
  const doomed: string[] = []
  try {
    const n = Math.min(st.length, SWEEP_MAX * 5)
    for (let i = 0; i < n && doomed.length < SWEEP_MAX; i++) {
      const k = st.key(i)
      if (!k || !k.startsWith(own)) continue
      if (isStale(parse(st.getItem(k)), now)) doomed.push(k)
    }
    for (const k of doomed) {
      st.removeItem(k)
      memory.delete(k)
    }
  } catch {
    return 0
  }
  return doomed.length
}

function write(key: string, s: RestState | null) {
  memory.set(key, s)
  try {
    const st = storage()
    if (s) st?.setItem(key, JSON.stringify(s))
    else st?.removeItem(key)
  } catch {
    /* quota or blocked storage: the in-memory value still works for this page */
  }
  emit()
}

if (typeof window !== 'undefined') {
  // Another tab of the app changed a timer.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.startsWith(PREFIX)) {
      if (e.key === null) memory.clear()
      else memory.delete(e.key)
      emit()
    }
  })
}

export function subscribeRest(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export interface RestOptions {
  /** `settings.training.restAlert` (absent = on). */
  restAlert?: boolean
  now?: number
  /** startRest only: the exercise this rest follows (stored with the timer, shown by the rest sheet). */
  exerciseId?: string
  /** startRest only: the set that started this rest (see RestState.setId). */
  setId?: string
}

/** The session screen a delivered alert opens. Keys are `<prefix><profile>|<session>`. */
function sessionRoute(key: string): string | undefined {
  const session = key.split('|').pop()
  return session ? `/entreno/sesion/${session}` : undefined
}

function alertFor(key: string, s: RestState | null, opts: RestOptions) {
  if (s && s.endsAt !== null && opts.restAlert !== false) void scheduleRestAlert(key, s.endsAt, { restAlert: opts.restAlert, route: sessionRoute(key) })
  else void cancelRestAlert(key)
}

function apply(profileId: string, sessionId: string, f: (s: RestState | null, now: number) => RestState | null, opts: RestOptions = {}): RestState | null {
  const key = restKey(profileId, sessionId)
  const next = f(read(key), opts.now ?? Date.now())
  write(key, next)
  alertFor(key, next, opts)
  return next
}

export const getRest = (profileId: string, sessionId: string): RestState | null => read(restKey(profileId, sessionId))
export const startRest = (profileId: string, sessionId: string, durationSec: number, opts?: RestOptions) => apply(profileId, sessionId, (_s, now) => restStart(durationSec, now, opts?.exerciseId, opts?.setId), opts)
export const pauseRest = (profileId: string, sessionId: string, opts?: RestOptions) => apply(profileId, sessionId, (s, now) => (s ? restPause(s, now) : null), opts)
export const resumeRest = (profileId: string, sessionId: string, opts?: RestOptions) => apply(profileId, sessionId, (s, now) => (s ? restResume(s, now) : null), opts)
export const addRest = (profileId: string, sessionId: string, deltaSec: number, opts?: RestOptions) => apply(profileId, sessionId, (s, now) => (s ? restAdd(s, deltaSec, now) : null), opts)
/** Ends the rest now (nothing left to show) and cancels the alert. */
export const skipRest = (profileId: string, sessionId: string) => apply(profileId, sessionId, () => null, { restAlert: false })
/**
 * Forgets a rest that ENDED by itself. Unlike skip it keeps the scheduled notification: with the app in the background
 * that notification is the only alert, and the moment it fires may come after this runs.
 */
export function expireRest(profileId: string, sessionId: string): void {
  write(restKey(profileId, sessionId), null)
}

/**
 * A rest reached zero. With the page visible the in-app cue already alerts, so the notification is cancelled (no
 * duplicate); hidden (background), it stays scheduled. Returns whether it cancelled.
 */
export function restEnded(profileId: string, sessionId: string, visible: boolean): boolean {
  if (!visible) return false
  void cancelRestAlert(restKey(profileId, sessionId))
  return true
}

/** Forgets the timer of a finished or deleted session. */
export const clearRest = skipRest
/** A set was un-ticked: if it is the one that started the current rest, end that rest and cancel its alert. */
export function cancelRestForSet(profileId: string, sessionId: string, setId: string): boolean {
  if (read(restKey(profileId, sessionId))?.setId !== setId) return false
  skipRest(profileId, sessionId)
  return true
}

/** Test helper: forget the in-memory cache (simulates a reload). */
export function _resetRestMemory() {
  memory.clear()
}

// ───────────── React ─────────────

/**
 * The clock reading a render should use. A tick sampled for an older rest state (the interval only runs
 * while a rest is active, so the stored `now` can be many seconds old when a new rest starts) is
 * discarded in favour of the real clock: the first painted value is then already correct.
 */
export function freshNow(tick: { now: number; token: unknown }, token: unknown, realNow: number): number {
  return tick.token === token ? tick.now : realNow
}

function useTick(active: boolean, token: unknown, ms = 250) {
  const [tick, setTick] = useState(() => ({ now: Date.now(), token }))
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setTick({ now: Date.now(), token }), ms)
    const onVis = () => setTick({ now: Date.now(), token })
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [active, token, ms])
  return freshNow(tick, token, Date.now())
}

/** End time of the rest whose cue already played, per timer key. */
const cued = new Map<string, number>()

export interface RestTimer extends RestView {
  state: RestState | null
  start(durationSec: number): void
  pause(): void
  resume(): void
  add(deltaSec: number): void
  skip(): void
  /** The finished rest is forgotten; its notification is left alone. */
  expire(): void
}

/**
 * Rest timer of one session on this device. Re-renders a few times per second only while running.
 * Plays the end cue (vibration + tone) once when the rest ends while the page is visible, if
 * `restAlert !== false`.
 */
export function useRestTimer(profileId: string, sessionId: string, opts: { restAlert?: boolean } = {}): RestTimer {
  const key = restKey(profileId, sessionId)
  const state = useSyncExternalStore(
    subscribeRest,
    () => read(key),
    () => null,
  )
  const now = useTick(state !== null && state.endsAt !== null, state)
  const view = restView(state, now)
  const restAlert = opts.restAlert
  useEffect(() => {
    // Several components may subscribe to the same rest (bar, pill, popover): the cue plays once per end.
    if (view.status !== 'over' || view.endsAt === null || cued.get(key) === view.endsAt) return
    cued.set(key, view.endsAt)
    restEnded(profileId, sessionId, globalThis.document?.visibilityState === 'visible')
    // Only a fresh end (not a stale one found after a long background) plays the cue.
    if (restAlert !== false && view.overSec < 5) playRestEndCue()
  }, [key, view.status, view.endsAt, view.overSec, restAlert, profileId, sessionId])
  return useMemo(
    () => ({
      ...view,
      state,
      start: (d: number) => void startRest(profileId, sessionId, d, { restAlert }),
      pause: () => void pauseRest(profileId, sessionId, { restAlert }),
      resume: () => void resumeRest(profileId, sessionId, { restAlert }),
      add: (d: number) => void addRest(profileId, sessionId, d, { restAlert }),
      skip: () => void skipRest(profileId, sessionId),
      expire: () => expireRest(profileId, sessionId),
    }),
    // view fields are primitives; listing them keeps the object stable between ticks of the same second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, view.status, view.leftSec, view.overSec, view.totalSec, profileId, sessionId, restAlert],
  )
}
