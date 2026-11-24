/**
 * Weekly training plan (pure, no React, no I/O). Stored as `settings.training.plan` (see TrainingPlan).
 *
 * Rules that matter for the data:
 *  - a plan never creates, changes or deletes a session; "done" comes only from real, counted sessions;
 *  - dates are local `YYYY-MM-DD` strings and the weekday is computed from the calendar, never through UTC;
 *  - one-off overrides beat the weekday, in both directions (rest a training day, train a rest day);
 *  - unknown keys of a stored plan survive every edit (a newer app may have written them);
 *  - `done` is a set of local dates that have at least one counted finished session (see `doneDates`).
 */
import type { ID, Routine, TrainingPlan, TrainingSession } from '../../../db/types'
import { addDays, isCalendarDate, isoWeekday } from '../../../domain/dates'
import { isCountedSession } from '../trainingStats'

export type PlanDay = { kind: 'train'; routineId: ID | null } | { kind: 'rest' }
export type DayStatus = 'none' | 'rest' | 'planned' | 'done'
/** Local dates (YYYY-MM-DD) on which a counted session was finished. */
export type DoneDates = ReadonlySet<string>

/** An override older than this many days before today is dropped the next time the plan is written. */
export const OVERRIDE_KEEP_DAYS = 14
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const idOrNull = (v: unknown): ID | null => (typeof v === 'string' && v ? v : null)

export const isValidReminderTime = (t: unknown): t is string => typeof t === 'string' && TIME_RE.test(t)

// ───────────── reading ─────────────

/** Dates with at least one counted finished session. An active or excluded session never makes a day "done". */
export function doneDates(sessions: readonly Pick<TrainingSession, 'date' | 'status' | 'excludeFromStats'>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sessions) if (isCountedSession(s) && isCalendarDate(s.date)) out.add(s.date)
  return out
}

/** A plan exists when at least one weekday trains or one date is explicitly set to train. */
export function hasPlan(plan: TrainingPlan | null | undefined): boolean {
  const p = sanitizePlan(plan)
  if (!p) return false
  if (Object.keys(p.days ?? {}).length > 0) return true
  return Object.values(p.overrides ?? {}).some((o) => !('rest' in o))
}

function dayOf(entry: { routineId?: ID | null } | { rest: true } | undefined): PlanDay | null {
  if (!entry) return null
  return 'rest' in entry ? { kind: 'rest' } : { kind: 'train', routineId: idOrNull(entry.routineId) }
}

/** What the plan says for `date`: null = no plan. A date override wins over its weekday; a weekday not listed is rest. */
export function planFor(plan: TrainingPlan | null | undefined, date: string): PlanDay | null {
  const p = sanitizePlan(plan)
  if (!p || !hasPlan(p) || !isCalendarDate(date)) return null
  const over = dayOf(p.overrides?.[date])
  if (over) return over
  return dayOf(p.days?.[String(isoWeekday(date))]) ?? { kind: 'rest' }
}

export function dayStatus(plan: TrainingPlan | null | undefined, date: string, done: DoneDates): DayStatus {
  if (done.has(date)) return 'done'
  const d = planFor(plan, date)
  if (!d) return 'none'
  return d.kind === 'rest' ? 'rest' : 'planned'
}

/** First date ≥ `from` (within `horizon` days after it) that trains and is not done yet. */
export function nextPlanned(plan: TrainingPlan | null | undefined, from: string, done: DoneDates, horizon = 14): { date: string; routineId: ID | null } | null {
  if (!hasPlan(plan)) return null
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(from, i)
    const d = planFor(plan, date)
    if (d?.kind === 'train' && !done.has(date)) return { date, routineId: d.routineId }
  }
  return null
}

/**
 * Local instant of `date` at `HH:MM` on this device. Built from the calendar parts, never from a date-only
 * string (which JS reads as UTC). A wall-clock time that does not exist rolls forward; it never throws.
 */
export function localInstant(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

/**
 * One-shot reminders for the next `days` days (today included): only future instants, only training days not
 * yet done. Empty when the reminder is off or its time is malformed. `now` is the real clock.
 *
 * Time zones (deliberate, see reminderTimezone.test.ts): the app's CALENDAR is Bogota (`APP_TZ`: plan days, done
 * days and "today" are Bogota dates), but a reminder is a wall-clock alarm ("07:00") that must ring at 07:00 on the
 * device the person is holding. So the window starts at the DEVICE's calendar day and each instant is the device-local
 * `date HH:MM`. This never drops a reminder: any date before the device's today has its device-local HH:MM already
 * in the past, so the window starting there covers every instant that can still be in the future, whatever the offset
 * between the device and Bogota. The plan weekday of a date is zone-free (it only reads the date string).
 */
export function remindersFor(plan: TrainingPlan | null | undefined, now: Date | number, done: DoneDates, days = 28): { date: string; atMs: number; routineId: ID | null }[] {
  const p = sanitizePlan(plan)
  if (!p || !hasPlan(p) || p.reminder?.on !== true || !isValidReminderTime(p.reminder.time)) return []
  const nowMs = typeof now === 'number' ? now : now.getTime()
  if (!Number.isFinite(nowMs)) return []
  const localNow = new Date(nowMs)
  const first = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`
  const out: { date: string; atMs: number; routineId: ID | null }[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i)
    const d = planFor(p, date)
    if (d?.kind !== 'train' || done.has(date)) continue
    const atMs = localInstant(date, p.reminder.time)
    if (Number.isFinite(atMs) && atMs > nowMs) out.push({ date, atMs, routineId: d.routineId })
  }
  return out
}

/**
 * The routine a plan day points at, or null when it has none, or it was deleted or archived: the caller
 * then treats the day as a training day without routine. `routines` may include archived ones.
 */
export function resolveRoutine<T extends Pick<Routine, 'id' | 'archived'>>(day: PlanDay | null, routines: readonly T[] | null | undefined): T | null {
  if (day?.kind !== 'train' || !day.routineId) return null
  const r = routines?.find((x) => x.id === day.routineId)
  return r && !r.archived ? r : null
}

/**
 * What the system should have scheduled: the future reminders with the routine's name as body ('' when the day has
 * no routine, or its routine is gone or archived). Same shape the notifications adapter reconciles against.
 */
export function desiredReminders<T extends Pick<Routine, 'id' | 'name' | 'archived'>>(plan: TrainingPlan | null | undefined, now: Date | number, done: DoneDates, routines: readonly T[] | null | undefined, days = 28): { date: string; atMs: number; body: string }[] {
  return remindersFor(plan, now, done, days).map((r) => ({ date: r.date, atMs: r.atMs, body: resolveRoutine({ kind: 'train', routineId: r.routineId }, routines)?.name ?? '' }))
}

// ───────────── editing (each returns a new plan; none mutates its input) ─────────────

/** Tolerant reader of stored data: keeps what is valid, drops what is not, keeps unknown keys. Never throws. */
export function sanitizePlan(raw: unknown): TrainingPlan | undefined {
  if (!isObject(raw)) return undefined
  const out: Record<string, unknown> = { ...raw }
  delete out.days
  delete out.overrides
  delete out.reminder
  if (isObject(raw.days)) {
    const days: Record<string, { routineId?: ID | null }> = {}
    for (const [k, v] of Object.entries(raw.days)) {
      if (!/^[1-7]$/.test(k) || !isObject(v)) continue
      const id = idOrNull(v.routineId)
      days[k] = id ? { routineId: id } : {}
    }
    out.days = days
  }
  if (isObject(raw.overrides)) {
    const overrides: Record<string, { rest: true } | { routineId?: ID | null }> = {}
    for (const [k, v] of Object.entries(raw.overrides)) {
      if (!isCalendarDate(k) || !isObject(v)) continue
      if (v.rest === true) overrides[k] = { rest: true }
      else if (!('rest' in v)) {
        const id = idOrNull(v.routineId)
        overrides[k] = id ? { routineId: id } : {}
      }
    }
    out.overrides = overrides
  }
  if (isObject(raw.reminder) && typeof raw.reminder.on === 'boolean' && isValidReminderTime(raw.reminder.time)) {
    out.reminder = { on: raw.reminder.on, time: raw.reminder.time }
  }
  return out as TrainingPlan
}

const dayEntry = (day: PlanDay): { rest: true } | { routineId?: ID | null } => (day.kind === 'rest' ? { rest: true } : day.routineId ? { routineId: day.routineId } : {})
const sameDay = (a: PlanDay | null, b: PlanDay | null) => a?.kind === b?.kind && (a?.kind !== 'train' || a.routineId === (b as { routineId: ID | null }).routineId)

/** Sets (train, with or without routine) or clears (rest or null) one weekday, `isoWeekday` 1 = Monday … 7 = Sunday. */
export function setWeekday(plan: TrainingPlan | null | undefined, weekday: number, day: PlanDay | null): TrainingPlan {
  const base = sanitizePlan(plan) ?? {}
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return base
  const days = { ...(base.days ?? {}) }
  if (day?.kind === 'train') days[String(weekday)] = day.routineId ? { routineId: day.routineId } : {}
  else delete days[String(weekday)]
  return { ...base, days }
}

/** Sets or clears (null) the change of one date. An override equal to what the weekday already says is not stored. */
export function setOverride(plan: TrainingPlan | null | undefined, date: string, value: PlanDay | null): TrainingPlan {
  const base = sanitizePlan(plan) ?? {}
  if (!isCalendarDate(date)) return base
  const overrides = { ...(base.overrides ?? {}) }
  const weekday = dayOf(base.days?.[String(isoWeekday(date))]) ?? { kind: 'rest' as const }
  if (!value || sameDay(value, weekday)) delete overrides[date]
  else overrides[date] = dayEntry(value)
  return { ...base, overrides }
}

/** Moves this one session: rest on `fromDate`, training on `toDate` with the origin's routine. Not a training day → unchanged. */
export function moveDay(plan: TrainingPlan | null | undefined, fromDate: string, toDate: string): TrainingPlan {
  const base = sanitizePlan(plan) ?? {}
  const from = planFor(base, fromDate)
  if (from?.kind !== 'train' || fromDate === toDate || !isCalendarDate(toDate)) return base
  // The destination may have changed since the chooser offered it. Never replace another planned session.
  if (planFor(base, toDate)?.kind === 'train') return base
  return setOverride(setOverride(base, fromDate, { kind: 'rest' }), toDate, { kind: 'train', routineId: from.routineId })
}

/** Drops overrides older than 14 days before `today`. Run it whenever the plan is written. */
export function pruneOverrides(plan: TrainingPlan | null | undefined, today: string): TrainingPlan {
  const base = sanitizePlan(plan) ?? {}
  if (!base.overrides) return base
  const limit = addDays(today, -OVERRIDE_KEEP_DAYS)
  const overrides = Object.fromEntries(Object.entries(base.overrides).filter(([d]) => d >= limit))
  return { ...base, overrides }
}

/** Writes the reminder (an invalid time becomes 07:00). Only the plan UI calls it, after the permission step. */
export function setReminder(plan: TrainingPlan | null | undefined, reminder: { on: boolean; time: string }): TrainingPlan {
  const base = sanitizePlan(plan) ?? {}
  return { ...base, reminder: { on: reminder.on, time: isValidReminderTime(reminder.time) ? reminder.time : '07:00' } }
}
