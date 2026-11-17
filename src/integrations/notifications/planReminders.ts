/**
 * V3.2 training-plan reminders: one-shot local notifications for the next days a training day is planned.
 *
 *  - `syncTrainingReminders(profileId, desired)` RECONCILES: it cancels what is scheduled but no longer wanted,
 *    schedules what is missing and leaves the rest alone (an identical run makes no native scheduling or cancellation call).
 *  - What was scheduled is tracked in ONE localStorage key per profile (`salud.plan.reminders|<profileId>`:
 *    date to "atMs|body"), plus one small index of the profiles that have any. localStorage and the scheduled
 *    notifications are reconciled against the native pending list too, so a blocked or damaged journal cannot
 *    leave orphaned reminders behind. Ids are derived from `salud.plan|<profile>|<date>` with
 *    `notificationIdFor`, so the id of a date is always the same.
 *  - It NEVER asks for permission: without it nothing is scheduled (and what was tracked is cancelled). The prompt
 *    belongs to the person switching the reminder on (`requestNotificationPermission`).
 *  - Always `isExactNotification: false`: this app never opens the system "Alarms & reminders" screen.
 *  - Only the active profile keeps reminders: every run first cancels those tracked for other profiles.
 *  - Off Android nothing is scheduled. Every failure is swallowed; the first one is reported once with console.warn.
 */
import { ensureChannelSpec, notificationIdFor, notificationsGranted, serial, type ChannelSpec } from './index'
import { isNativePlatform, localNotifications } from './native'

export const PLAN_CHANNEL: ChannelSpec = { id: 'plan-reminders', name: 'Recordatorio de entrenamiento', description: 'Aviso los días que tienes entrenamiento planificado', importance: 3, vibration: true }
export const PLAN_REMINDER_TITLE = 'Hoy toca entrenar'
export const PLAN_REMINDER_FALLBACK_BODY = 'Tienes un entrenamiento planificado.'
export const PLAN_REMINDER_ROUTE = '/entreno'
const KEY = (profileId: string) => `salud.plan.reminders|${profileId}`
const INDEX_KEY = 'salud.plan.reminders.profiles'

export interface DesiredReminder {
  /** Local date YYYY-MM-DD (identifies the notification). */
  date: string
  /** Epoch ms of the local instant to fire. */
  atMs: number
  /** Routine name, or '' for a training day without routine. */
  body: string
}
export interface ReminderSyncResult {
  scheduled: number
  cancelled: number
  /** Set when the plugin failed; nothing is thrown. */
  error?: string
}

type Tracked = Record<string, string>
const sig = (r: Pick<DesiredReminder, 'atMs' | 'body'>) => `${r.atMs}|${r.body}`
const atOf = (s: string) => Number(s.slice(0, s.indexOf('|')))
export const reminderNotificationId = (profileId: string, date: string) => notificationIdFor(`salud.plan|${profileId}|${date}`)

function read(k: string): string | null {
  try {
    return globalThis.localStorage?.getItem(k) ?? null
  } catch {
    return null
  }
}
function write(k: string, v: string | null) {
  try {
    if (v === null) globalThis.localStorage?.removeItem(k)
    else globalThis.localStorage?.setItem(k, v)
  } catch {
    /* blocked storage: the next run simply schedules again */
  }
}
function readTracked(profileId: string): Tracked {
  try {
    const raw = JSON.parse(read(KEY(profileId)) ?? '{}') as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([d, s]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && typeof s === 'string' && s.includes('|') && Number.isFinite(atOf(s))))
  } catch {
    return {}
  }
}
function readIndex(): string[] {
  try {
    const raw = JSON.parse(read(INDEX_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function writeTracked(profileId: string, tracked: Tracked) {
  const has = Object.keys(tracked).length > 0
  write(KEY(profileId), has ? JSON.stringify(tracked) : null)
  const index = new Set(readIndex())
  if (has) index.add(profileId)
  else index.delete(profileId)
  write(INDEX_KEY, index.size ? JSON.stringify([...index]) : null)
}

let reported = false
function report(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (!reported) {
    reported = true
    console.warn('[salud] No se pudieron actualizar los recordatorios de entrenamiento:', message)
  }
  return message
}
/** Test helper: forget that a failure was already reported. */
export function _resetPlanReminderState() {
  reported = false
}

type Plugin = Awaited<ReturnType<typeof localNotifications>>

/** Cancels every tracked reminder of `profileId` and forgets them. Throws when the plugin fails (callers catch). */
async function cancelTracked(ln: Plugin, profileId: string): Promise<number> {
  const dates = Object.keys(readTracked(profileId))
  if (dates.length) await ln.cancel({ notifications: dates.map((d) => ({ id: reminderNotificationId(profileId, d) })) })
  writeTracked(profileId, {})
  return dates.length
}

/**
 * Makes the scheduled reminders of the active profile equal to `desired` (only future instants are scheduled).
 * `now` is injectable for tests. Never throws, never prompts.
 */
export function syncTrainingReminders(profileId: string, desired: readonly DesiredReminder[], now: number = Date.now()): Promise<ReminderSyncResult> {
  if (!isNativePlatform()) return Promise.resolve({ scheduled: 0, cancelled: 0 })
  return serial(async (): Promise<ReminderSyncResult> => {
    const result: ReminderSyncResult = { scheduled: 0, cancelled: 0 }
    try {
      const ln = await localNotifications()
      // Only the active profile keeps reminders.
      for (const other of readIndex()) if (other !== profileId) result.cancelled += await cancelTracked(ln, other)

      const granted = desired.length > 0 && (await notificationsGranted())
      const want = new Map<string, DesiredReminder>()
      if (granted) for (const r of desired) if (r.atMs > now && !want.has(r.date)) want.set(r.date, r)

      const pending = await ln.getPending?.()
      const pendingIds = pending ? new Set(pending.notifications.filter((n) => n.channelId === PLAN_CHANNEL.id).map((n) => n.id)) : null
      const wantedIds = new Set([...want.keys()].map((date) => reminderNotificationId(profileId, date)))

      const tracked = readTracked(profileId)
      const next: Tracked = {}
      const stale: string[] = []
      for (const [date, s] of Object.entries(tracked)) {
        const w = want.get(date)
        if (w && sig(w) === s && (!pendingIds || pendingIds.has(reminderNotificationId(profileId, date)))) next[date] = s // unchanged: no native write
        else if (atOf(s) <= now && !w) continue // already fired: nothing to cancel, just forget it
        else stale.push(date) // removed, or changed (a changed one is scheduled again below)
      }
      const missing = [...want.values()].filter((r) => next[r.date] === undefined).sort((a, b) => a.atMs - b.atMs)
      const staleIds = new Set(stale.map((date) => reminderNotificationId(profileId, date)))
      for (const id of pendingIds ?? []) if (!wantedIds.has(id)) staleIds.add(id)

      if (staleIds.size) {
        await ln.cancel({ notifications: [...staleIds].map((id) => ({ id })) })
        result.cancelled += staleIds.size
        writeTracked(profileId, next)
      } else if (Object.keys(next).length !== Object.keys(tracked).length) writeTracked(profileId, next)

      if (missing.length) {
        await ensureChannelSpec(ln, PLAN_CHANNEL)
        await ln.schedule({
          notifications: missing.map((r) => ({
            id: reminderNotificationId(profileId, r.date),
            title: PLAN_REMINDER_TITLE,
            body: r.body || PLAN_REMINDER_FALLBACK_BODY,
            channelId: PLAN_CHANNEL.id,
            autoCancel: true,
            isExactNotification: false,
            schedule: { at: new Date(r.atMs), allowWhileIdle: true },
            extra: { route: PLAN_REMINDER_ROUTE },
          })),
        })
        for (const r of missing) next[r.date] = sig(r)
        writeTracked(profileId, next)
        result.scheduled = missing.length
      }
      reported = false
    } catch (e) {
      result.error = report(e)
    }
    return result
  })
}

/** Cancels everything this profile has scheduled (reminder off, plan removed). Never throws. */
export function clearTrainingReminders(profileId: string): Promise<ReminderSyncResult> {
  if (!isNativePlatform()) {
    writeTracked(profileId, {})
    return Promise.resolve({ scheduled: 0, cancelled: 0 })
  }
  return serial(async (): Promise<ReminderSyncResult> => {
    const result: ReminderSyncResult = { scheduled: 0, cancelled: 0 }
    try {
      result.cancelled = await cancelTracked(await localNotifications(), profileId)
    } catch (e) {
      result.error = report(e)
    }
    return result
  })
}

/**
 * No profile is left on this device (the last one was removed): nothing may stay scheduled. Cancels what every profile
 * tracked and anything still pending in the plan channel. Never throws.
 */
export function clearAllTrainingReminders(): Promise<ReminderSyncResult> {
  return syncTrainingReminders('', [])
}
