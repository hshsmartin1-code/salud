/**
 * Crash-safe persistence of what the person is typing during a live session (pure core, no React).
 *
 * Guarantees (owner requirement: weight, reps, RIR/RPE and notes survive an unexpected close, a screen
 * lock or an interruption):
 * - Every VALID change is written to Dexie within `delayMs` (≤ 150 ms for numbers, ≤ 300 ms for notes),
 *   without waiting for blur. The window starts at the first change of a burst and is not extended by
 *   later keystrokes, so continuous typing is still saved every `delayMs`.
 * - `flush()` writes the pending value at once (blur, visibilitychange → hidden, pagehide, unmount).
 * - Invalid intermediate text is never written and never erases the last valid value.
 * - Writes are serialised (never reordered) and a value equal to the last written one is skipped.
 * - A failed write is kept (unless a newer value replaced it) and retried by the next flush; `failed`
 *   stays true until a write succeeds, so the UI can say "no guardado" instead of losing the value.
 * - A set row writes only the columns typed in it, so another tab's change to another column survives.
 * - The local write never waits for the network: sync reads the rows later (see the project notes).
 *
 * Echo guard: a live query re-renders with the rows this writer just saved. `isOwnEcho()` recognises
 * them so they never clobber what is being typed, while a genuinely external change (another device
 * via sync, another tab) is adopted once the writer is idle.
 */
import type { TrackingType } from '../../db/catalogTypes'
import { formatNumber, parseDecimal } from '../../domain/units'
import { formatDuration } from './sets'

export const SET_DRAFT_DELAY_MS = 120
export const NOTE_DRAFT_DELAY_MS = 250

export interface DraftClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}
const REAL_CLOCK: DraftClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface DraftWriterOptions<T> {
  /** Persists one value (e.g. `repo.update`). Called at most once per `delayMs`, never concurrently. */
  write: (value: T) => Promise<void>
  /** Stable signature of a value (used to skip no-op writes and to recognise echoes). */
  key: (value: T) => string
  delayMs: number
  /** Signature of the value already stored when the writer is created. */
  initialKey?: string | null
  clock?: DraftClock
  onError?: (e: unknown) => void
}

const OWN_KEYS_MAX = 16

export class DraftWriter<T> {
  private readonly opts: DraftWriterOptions<T>
  private readonly clock: DraftClock
  private pending: { value: T } | null = null
  private timer: unknown = null
  private chain: Promise<void> = Promise.resolve()
  private inflight = 0
  private lastKey: string | null
  private own: string[] = []
  private disposed = false
  private error: unknown = null
  private readonly failListeners = new Set<() => void>()

  constructor(opts: DraftWriterOptions<T>) {
    this.opts = opts
    this.clock = opts.clock ?? REAL_CLOCK
    this.lastKey = opts.initialKey ?? null
  }

  /** A new valid value. Invalid input must simply not call this. */
  set(value: T): void {
    if (this.disposed) return
    this.pending = { value }
    if (this.timer === null) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null
        void this.flush()
      }, this.opts.delayMs)
    }
  }

  /** Writes the pending value now. Resolves when every write issued so far has finished. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer)
      this.timer = null
    }
    const p = this.pending
    this.pending = null
    if (!p) return this.chain
    const k = this.opts.key(p.value)
    if (k === this.lastKey) return this.chain
    this.lastKey = k
    this.own.push(k)
    if (this.own.length > OWN_KEYS_MAX) this.own.shift()
    this.inflight++
    this.chain = this.chain
      .then(() => this.opts.write(p.value))
      .then(() => {
        if (this.error !== null) {
          this.error = null
          this.failListeners.forEach((l) => l())
        }
      })
      .catch((e: unknown) => {
        // Not saved: allow the same value to be written again, and keep it for the next flush unless
        // a newer value is already waiting (that one wins).
        if (this.lastKey === k) this.lastKey = null
        if (this.pending === null) this.pending = p
        this.error = e
        this.failListeners.forEach((l) => l())
        this.opts.onError?.(e)
      })
      .finally(() => {
        this.inflight--
      })
    return this.chain
  }

  /** True after a write failed, until a later write succeeds (the value is kept and retried). */
  get failed(): boolean {
    return this.error !== null
  }

  /** Called whenever `failed` changes. Returns the unsubscribe function. */
  onFailedChange(listener: () => void): () => void {
    this.failListeners.add(listener)
    return () => this.failListeners.delete(listener)
  }

  /** True while a value is waiting for its window or a write has not finished. */
  get busy(): boolean {
    return this.pending !== null || this.inflight > 0
  }

  /** Signature of the last value written (or the initial stored one). */
  get lastWrittenKey(): string | null {
    return this.lastKey
  }

  /**
   * Whether a stored value is the echo of one of this writer's own writes. Once idle and the echo of
   * the final write has arrived, older own signatures are forgotten, so a later external change back
   * to one of them is recognised as external.
   */
  isOwnEcho(storedKey: string): boolean {
    // Live-query echoes can arrive before the write promise settles; there may be no further
    // echo when it becomes idle. Old signatures must not hide a later external edit indefinitely.
    if (!this.busy) this.own = this.lastKey !== null && this.own.includes(this.lastKey) ? [this.lastKey] : []
    if (!this.own.includes(storedKey)) return false
    return true
  }

  /** Adopts an external stored value (another device or tab) as the new baseline. */
  acceptExternal(storedKey: string): void {
    this.own = []
    this.lastKey = storedKey
  }

  /** Flushes and stops accepting values (unmount). */
  dispose(): Promise<void> {
    const done = this.flush()
    this.disposed = true
    return done
  }
}

/**
 * Decides what a live-query update means for the inputs: 'ignore' (own echo, or local typing still
 * pending — it will be written and wins) or 'adopt' (external change while idle: reset the inputs).
 */
export function classifyStoredChange(w: Pick<DraftWriter<unknown>, 'isOwnEcho' | 'busy' | 'lastWrittenKey'>, storedKey: string): 'ignore' | 'adopt' {
  if (storedKey === w.lastWrittenKey) return 'ignore'
  if (w.isOwnEcho(storedKey)) return 'ignore'
  if (w.busy) return 'ignore'
  return 'adopt'
}

// ───────────── Set fields: text ↔ stored values ─────────────

export type SetDraftField = 'weight' | 'reps' | 'durationSec' | 'distanceM' | 'rpe' | 'rir'
export type SetDraftValues = Partial<Record<SetDraftField, number | null>>
export type ParseResult = { ok: true; value: number | null } | { ok: false }

/**
 * Plausible ranges of a set (stored units). A value outside is rejected: the input shows its error
 * state, keeps the typed text, and nothing is written. Weight ≤ 1000 kg, reps ≤ 1000, distance ≤ 300 km,
 * duration ≤ 24 h, RPE 1–10, RIR 0–10 (negatives are never accepted).
 */
export const SET_FIELD_RANGE: Record<SetDraftField, readonly [number, number]> = {
  weight: [0, 1000],
  reps: [0, 1000],
  durationSec: [0, 24 * 3600],
  distanceM: [0, 300_000],
  rpe: [1, 10],
  rir: [0, 10],
}

/**
 * The app's number rule (units.ts parseDecimal): "1.200" is a thousands separator (1200), every other
 * single dot or comma is the decimal ("72.5", "72,5", "1.25", "0.500"). The dot-thousands case is
 * normalised here too, so it holds whichever parseDecimal this branch has (idempotent with the shared one).
 */
function parseNumber(t: string): number | null {
  const s = t.trim().replace(/\s+/g, '')
  return parseDecimal(/^[1-9]\d{0,2}\.\d{3}$/.test(s) ? s.replace('.', '') : s)
}

const inRange = (field: SetDraftField, n: number) => n >= SET_FIELD_RANGE[field][0] && n <= SET_FIELD_RANGE[field][1]

/** "90" → 90 s (or min when plain='min'); "1:30" → 90 s; "1:02:03" → 3723 s. */
export function parseDuration(s: string, plain: 'sec' | 'min' = 'sec'): number | null {
  const t = s.trim()
  if (!t) return null
  if (t.includes(':')) {
    const parts = t.split(':').map((p) => Number(p))
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null
    return parts.reduce((a, p) => a * 60 + p, 0)
  }
  const n = parseNumber(t)
  if (n === null || n < 0) return null
  return Math.round(plain === 'min' ? n * 60 : n)
}

const ok = (value: number | null): ParseResult => ({ ok: true, value })
const BAD: ParseResult = { ok: false }

/** Parses one input. Empty text is a valid "not recorded" (null). */
export function parseSetField(field: SetDraftField, text: string, tracking: TrackingType): ParseResult {
  const t = text.trim()
  if (!t) return ok(null)
  switch (field) {
    case 'weight':
    case 'rpe':
    case 'rir': {
      const n = parseNumber(t)
      return n === null || !inRange(field, n) ? BAD : ok(n)
    }
    case 'reps': {
      const n = parseNumber(t)
      return n === null || !Number.isInteger(n) || !inRange(field, n) ? BAD : ok(n)
    }
    case 'durationSec': {
      const n = parseDuration(t, tracking === 'distance' ? 'min' : 'sec')
      return n === null || !inRange(field, n) ? BAD : ok(n)
    }
    case 'distanceM': {
      const km = parseNumber(t)
      if (km === null) return BAD
      const m = Math.round(km * 1000)
      return inRange(field, m) ? ok(m) : BAD
    }
  }
}

const numText = (n: number | null | undefined, maxDecimals: number) =>
  n === null || n === undefined || !Number.isFinite(n) ? '' : formatNumber(n, maxDecimals).replace(/\./g, '')

/** Stored value → text shown in the input. */
export function formatSetField(field: SetDraftField, value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  switch (field) {
    case 'weight':
      return numText(value, 2)
    case 'reps':
      return numText(value, 0)
    case 'durationSec':
      return formatDuration(value)
    case 'distanceM':
      return numText(value / 1000, 3)
    case 'rpe':
    case 'rir':
      return numText(value, 1)
  }
}

/** Inputs of the current session row per tracking type (same columns as 2.2.1). */
export const SET_FIELDS: Record<TrackingType, readonly SetDraftField[]> = {
  weight_reps: ['weight', 'reps'],
  bodyweight_reps: ['weight', 'reps'],
  time: ['durationSec'],
  distance: ['distanceM', 'durationSec'],
}

/** Signature of the drafted fields of a stored row. */
export function setDraftKey(row: Partial<Record<SetDraftField, number | null | undefined>>, fields: readonly SetDraftField[]): string {
  return JSON.stringify(fields.map((f) => row[f] ?? null))
}

/** The measure each tracking type needs before a set can be marked done. */
export function canCompleteSet(v: SetDraftValues, tracking: TrackingType): boolean {
  switch (tracking) {
    case 'weight_reps':
      return v.weight != null && v.reps != null
    case 'bodyweight_reps':
      return v.reps != null
    case 'time':
      return v.durationSec != null
    case 'distance':
      return v.distanceM != null || v.durationSec != null
  }
}

/** Notes: trailing whitespace is kept while typing; an empty note removes the field. */
export function noteValue(text: string): string | undefined {
  return text.trim() ? text : undefined
}

// ───────────── Set row model (what useSetDraft renders) ─────────────

type StoredFields = Partial<Record<SetDraftField, number | null | undefined>>

export interface SetDraftModelOptions {
  fields: readonly SetDraftField[]
  tracking: TrackingType
  /** Stored values of the row when the model is created. */
  initial: StoredFields
  write: (values: SetDraftValues) => Promise<void>
  delayMs?: number
  clock?: DraftClock
  onError?: (e: unknown) => void
}

/**
 * Text inputs of one set row plus their crash-safe writer. Pure: React only re-renders from it.
 * Each field keeps its last VALID value; invalid text is shown (and flagged) but never written.
 */
export class SetDraftModel {
  readonly fields: readonly SetDraftField[]
  readonly tracking: TrackingType
  readonly writer: DraftWriter<SetDraftValues>
  text: Record<SetDraftField, string>
  values: SetDraftValues
  /** Fields typed in THIS row since its baseline: the only columns it writes. */
  private dirty = new Set<SetDraftField>()

  constructor(o: SetDraftModelOptions) {
    this.fields = o.fields
    this.tracking = o.tracking
    const { text, values } = this.fromStored(o.initial)
    this.text = text
    this.values = values
    this.writer = new DraftWriter<SetDraftValues>({
      delayMs: o.delayMs ?? SET_DRAFT_DELAY_MS,
      initialKey: setDraftKey(o.initial, o.fields),
      key: (v) => setDraftKey(v, o.fields),
      // Only the typed columns: another tab may have changed the others meanwhile.
      write: (v) => {
        const patch: SetDraftValues = {}
        for (const f of this.fields) if (this.dirty.has(f)) patch[f] = v[f] ?? null
        return o.write(patch)
      },
      clock: o.clock,
      onError: o.onError,
    })
  }

  private fromStored(row: StoredFields) {
    const text = {} as Record<SetDraftField, string>
    const values: SetDraftValues = {}
    for (const f of this.fields) {
      text[f] = formatSetField(f, row[f] ?? null)
      values[f] = row[f] ?? null
    }
    return { text, values }
  }

  /** New input text. Returns whether it was valid (and therefore scheduled for saving). */
  change(field: SetDraftField, text: string): boolean {
    this.text = { ...this.text, [field]: text }
    const p = parseSetField(field, text, this.tracking)
    if (!p.ok) return false
    this.values = { ...this.values, [field]: p.value }
    this.dirty.add(field)
    this.writer.set({ ...this.values })
    return true
  }

  invalid(): Partial<Record<SetDraftField, boolean>> {
    const out: Partial<Record<SetDraftField, boolean>> = {}
    for (const f of this.fields) if (!parseSetField(f, this.text[f] ?? '', this.tracking).ok) out[f] = true
    return out
  }

  canComplete(): boolean {
    return Object.keys(this.invalid()).length === 0 && canCompleteSet(this.values, this.tracking)
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  get failed(): boolean {
    return this.writer.failed
  }

  /** A live-query update of the row. Returns true when it was adopted (inputs reset to it). */
  stored(row: StoredFields): boolean {
    const key = setDraftKey(row, this.fields)
    if (classifyStoredChange(this.writer, key) === 'ignore') return false
    this.writer.acceptExternal(key)
    this.dirty.clear()
    const { text, values } = this.fromStored(row)
    this.text = text
    this.values = values
    return true
  }
}
