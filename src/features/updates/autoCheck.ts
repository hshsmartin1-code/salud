import type { UpdateState } from './state'

/**
 * Automatic update check (Android shell, OTA enabled only). It asks the service for a SILENT check: the service publishes
 * an offer if there is one and nothing else, so a failed or offline attempt leaves no trace. It never downloads.
 * The decision is the pure `decideAutoCheck`; `createAutoChecker` only gathers its inputs and runs it.
 */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** The only localStorage key of this feature (the journal itself stays under `salud:ota:v1`). */
export const AUTO_CHECK_KEY = 'salud:ota:lastAuto:v1'

export type AutoCheckDecision = 'check' | 'busy' | 'ready' | 'offline' | 'too-soon'

/** Statuses in which an automatic check must not start: an operation is running or a bundle waits for the restart. */
const BUSY: ReadonlySet<UpdateState['status']> = new Set(['checking', 'downloading'])
/** An offer, a downloaded bundle or a one-time notice is already in front of the person: nothing to look for. */
const SETTLED: ReadonlySet<UpdateState['status']> = new Set(['available', 'ready-to-restart', 'applied', 'rolled-back'])

export interface AutoCheckInput {
  status: UpdateState['status']
  /** An apply/restart is under way even though the status has not changed yet. */
  working: boolean
  online: boolean
  now: number
  /** Time of the previous automatic attempt, or null when there is none (or it could not be read). */
  last: number | null
}

export function decideAutoCheck(input: AutoCheckInput): AutoCheckDecision {
  if (input.working || BUSY.has(input.status)) return 'busy'
  if (SETTLED.has(input.status)) return 'ready'
  if (!input.online) return 'offline'
  // A clock set back (last is in the future) must not block checks until it catches up: that counts as due.
  if (input.last !== null && input.now >= input.last && input.now - input.last < AUTO_CHECK_INTERVAL_MS) return 'too-soon'
  return 'check'
}

export interface AutoStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface AutoCheckService {
  getState(): UpdateState
  check(options: { silent: true }): Promise<UpdateState>
}
export interface AutoCheckDeps {
  service: AutoCheckService
  storage: AutoStorage
  now(): number
  online(): boolean
}

export function createAutoChecker(deps: AutoCheckDeps) {
  let running = false
  // If storage cannot be read or written, the attempt time lives here: still at most one check per interval per process.
  let memory: number | null = null
  const readLast = (): number | null => {
    let stored: number | null = null
    try {
      const text = deps.storage.getItem(AUTO_CHECK_KEY)
      const n = text === null ? NaN : Number(text)
      stored = Number.isFinite(n) && n > 0 ? n : null
    } catch { stored = null }
    return stored ?? memory
  }
  const stamp = (at: number) => {
    memory = at
    try { deps.storage.setItem(AUTO_CHECK_KEY, String(at)) } catch { /* in-memory copy still limits the rate */ }
  }
  return {
    /** Runs one automatic attempt if the policy allows it. Never throws and never reports a failure. */
    async run(): Promise<AutoCheckDecision> {
      const now = deps.now()
      const decision = decideAutoCheck({ status: deps.service.getState().status, working: running, online: deps.online(), now, last: readLast() })
      // One diagnostic line (no data) so a device log shows why an attempt did or did not run.
      console.info('[updates] comprobación automática:', decision, deps.service.getState().status)
      if (decision !== 'check') return decision
      running = true
      stamp(now)
      try { await deps.service.check({ silent: true }) } catch { /* silent by contract */ } finally { running = false }
      return 'check'
    },
  }
}

/** A foreground/background source: the Capacitor App plugin in the app, a fake in tests. */
export interface ForegroundPort {
  /** Calls `onActive` every time the app returns to the foreground. Resolves with a function that stops listening. */
  subscribe(onActive: () => void): Promise<() => void>
}

/**
 * Plain object around the plugin: a Capacitor plugin is a Proxy that answers every property, including "then", so it must
 * never be returned from (or resolved by) a promise. Same pattern as nativeBack.ts.
 */
export function capacitorForeground(): ForegroundPort {
  return {
    async subscribe(onActive) {
      const { App } = await import('@capacitor/app')
      const handle = await App.addListener('appStateChange', (event) => { if (event.isActive) onActive() })
      return () => { void handle.remove() }
    },
  }
}

/** First attempt now (the caller has just confirmed a healthy start), then on every return to the foreground. */
export function startAutoChecks(checker: Pick<ReturnType<typeof createAutoChecker>, 'run'>, foreground: ForegroundPort = capacitorForeground()): () => void {
  let stopped = false
  let stop: (() => void) | null = null
  void checker.run()
  foreground.subscribe(() => { if (!stopped) void checker.run() }).then((off) => {
    if (stopped) off()
    else stop = off
  }).catch(() => undefined)
  return () => {
    stopped = true
    stop?.()
  }
}
