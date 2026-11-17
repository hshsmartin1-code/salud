/**
 * End-of-rest alert. Every path degrades silently when unavailable (no plugin, no permission, no
 * Notification API, no AudioContext, background throttling): the rest timer itself never depends on it.
 *
 * - Android (Capacitor shell): ONE local notification scheduled for the end of the rest (a stable id per
 *   profile + session, so rescheduling replaces it), cancelled or rescheduled on pause / skip / ±seconds /
 *   set un-ticked / session end. The system permission is requested ONLY by `enableRestNotifications()`
 *   (the explicit "Activar avisos" action, or switching the setting on) and never again once denied;
 *   scheduling merely checks it and does nothing when it is not granted.
 * - Plan reminders (V3.2) live in ./planReminders.ts and share the permission flow below; scheduling never prompts.
 * - Web: the Notification API only if permission is already granted, or after the person enables the
 *   alert setting (then it is requested once). Plus vibration and a short tone while the page is visible.
 */
import { isNativePlatform, localNotifications, type LocalNotificationsPlugin } from './native'

const CHANNEL = 'rest-timer'
const PERM_KEY = 'salud.notifications.permission'
const WEB_ASKED_KEY = 'salud.notifications.webAsked'

function readLocal(k: string): string | null {
  try {
    return globalThis.localStorage?.getItem(k) ?? null
  } catch {
    return null
  }
}
function writeLocal(k: string, v: string) {
  try {
    globalThis.localStorage?.setItem(k, v)
  } catch {
    /* private mode or blocked storage */
  }
}

/** Stable signed Android int: rest alerts stay positive; plans use the negative namespace. */
export function notificationIdFor(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  const id = h >>> 1 || 1
  return key.startsWith('salud.plan|') ? -id : id
}

export interface RestAlertText {
  title: string
  body: string
}
const DEFAULT_TEXT: RestAlertText = { title: 'Descanso terminado', body: 'Es hora de la siguiente serie.' }

// ───────────── Android ─────────────

/** Native calls run one after another in call order, so a late "schedule" can never land after a newer "cancel". */
let chain: Promise<unknown> = Promise.resolve()
export function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op)
  chain = run.catch(() => undefined)
  return run
}

export interface ChannelSpec {
  id: string
  name: string
  description?: string
  importance?: 1 | 2 | 3 | 4 | 5
  vibration?: boolean
}
const REST_CHANNEL: ChannelSpec = { id: CHANNEL, name: 'Temporizador de descanso', description: 'Aviso al terminar el descanso entre series', importance: 4, vibration: true }
const channelsReady = new Map<string, Promise<void>>()
/** Creates a channel once per process (idempotent on Android). Never throws; a failure is retried next time. */
export function ensureChannelSpec(ln: LocalNotificationsPlugin, spec: ChannelSpec): Promise<void> {
  let ready = channelsReady.get(spec.id)
  if (!ready) {
    ready = (ln.createChannel ? ln.createChannel(spec) : Promise.resolve()).catch(() => {
      channelsReady.delete(spec.id) // try again next time
    })
    channelsReady.set(spec.id, ready)
  }
  return ready
}
/** Creates the `rest-timer` channel once (high importance, vibration, default sound). Never throws. */
function ensureChannel(ln: LocalNotificationsPlugin): Promise<void> {
  return ensureChannelSpec(ln, REST_CHANNEL)
}

/** Test helper: forget that the channel was created (a fresh app process). */
export function _resetNotificationState() {
  channelsReady.clear()
}

/** Android 12+ exact-alarm permission, read without opening anything. false when unknown or unsupported. */
async function exactAlarmAllowed(ln: LocalNotificationsPlugin): Promise<boolean> {
  try {
    return (await ln.checkExactNotificationSetting?.())?.exact_alarm === 'granted'
  } catch {
    return false
  }
}

/** True only on Android with notifications enabled but exact alarms NOT allowed: the alert may arrive late. */
export async function exactAlarmsBlocked(): Promise<boolean> {
  try {
    if (!isNativePlatform()) return false
    const ln = await localNotifications()
    if ((await ln.checkPermissions()).display !== 'granted' || !ln.checkExactNotificationSetting) return false
    return (await ln.checkExactNotificationSetting()).exact_alarm !== 'granted'
  } catch {
    return false
  }
}

/** Opens the system screen where the person allows exact alarms for this app. Call it only from a tap. */
export async function openExactAlarmSettings(): Promise<void> {
  try {
    await (await localNotifications()).changeExactNotificationSetting?.()
  } catch {
    /* unsupported */
  }
}

/** Android: tapping a delivered rest alert opens its session; returning to the app clears the delivered alert. */
export function registerRestNotificationRouting(open: (route: string) => void): () => void {
  if (!isNativePlatform()) return () => undefined
  let handle: { remove(): Promise<void> } | undefined
  let gone = false
  const clear = () => {
    if (document.visibilityState === 'visible') void localNotifications().then((ln) => ln.removeAllDeliveredNotifications?.()).catch(() => undefined)
  }
  void localNotifications()
    .then((ln) =>
      ln.addListener?.('localNotificationActionPerformed', (a) => {
        const route = a.notification.extra?.route
        if (typeof route === 'string' && route.startsWith('/')) open(route)
      }),
    )
    .then((h) => {
      if (gone) void h?.remove()
      else handle = h
    })
    .catch(() => undefined)
  document.addEventListener('visibilitychange', clear)
  clear()
  return () => {
    gone = true
    document.removeEventListener('visibilitychange', clear)
    void handle?.remove()
  }
}

/** Check only, never prompts: is the system permission granted right now? (creates the rest channel) */
async function nativeGranted(): Promise<boolean> {
  const ln = await localNotifications()
  // The system decides: a permission granted later from Android Settings works even after an in-app refusal.
  if ((await ln.checkPermissions()).display !== 'granted') return false
  await ensureChannel(ln)
  return true
}

/**
 * The explicit request (from "Activar avisos" or the setting): asked once; 'asked' is recorded before
 * the system prompt, so a dismissed prompt counts as denied and is never repeated.
 */
async function nativeRequest(): Promise<boolean> {
  const stored = readLocal(PERM_KEY)
  if (stored === 'denied') return false // never ask again
  const ln = await localNotifications()
  let state = (await ln.checkPermissions()).display
  if (state !== 'granted' && state !== 'denied' && stored !== 'asked') {
    writeLocal(PERM_KEY, 'asked')
    state = (await ln.requestPermissions()).display
  }
  writeLocal(PERM_KEY, state === 'granted' ? 'granted' : 'denied')
  if (state === 'granted') await ensureChannel(ln)
  return state === 'granted'
}

// ───────────── Web ─────────────

const webTimers = new Map<string, ReturnType<typeof setTimeout>>()
type NotificationCtor = { permission: 'granted' | 'denied' | 'default'; requestPermission(): Promise<string> } & (new (title: string, opts?: { body?: string; tag?: string }) => unknown)
const webNotification = (): NotificationCtor | null => (globalThis as { Notification?: NotificationCtor }).Notification ?? null

async function webPermission(enabledBySetting: boolean): Promise<boolean> {
  const N = webNotification()
  if (!N) return false
  if (N.permission === 'granted') return true
  if (N.permission === 'denied' || !enabledBySetting || readLocal(WEB_ASKED_KEY)) return false
  writeLocal(WEB_ASKED_KEY, '1')
  return (await N.requestPermission()) === 'granted'
}

function webCancel(key: string) {
  const t = webTimers.get(key)
  if (t !== undefined) clearTimeout(t)
  webTimers.delete(key)
}

function webSchedule(key: string, atMs: number, text: RestAlertText) {
  webCancel(key)
  webTimers.set(
    key,
    setTimeout(
      () => {
        webTimers.delete(key)
        const N = webNotification()
        // While visible the page plays its own cue; the system notification is for a hidden page.
        if (!N || N.permission !== 'granted' || globalThis.document?.visibilityState === 'visible') return
        try {
          new N(text.title, { body: text.body, tag: key })
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      },
      Math.max(0, atMs - Date.now()),
    ),
  )
}

/** Check only, never prompts: is the system notification permission granted right now? false when unknown. */
export async function notificationsGranted(): Promise<boolean> {
  try {
    return (await (await localNotifications()).checkPermissions()).display === 'granted'
  } catch {
    return false
  }
}

// ───────────── Public API ─────────────

export interface ScheduleOptions {
  /** Route opened when the notification is tapped (e.g. `/entreno/sesion/<id>`). */
  route?: string
  /** `settings.training.restAlert`; absent = enabled. false = no notification at all. */
  restAlert?: boolean
  text?: RestAlertText
}

/** Schedules (or reschedules) the end-of-rest alert for timer `key`. Never throws. */
export async function scheduleRestAlert(key: string, atMs: number, opts: ScheduleOptions = {}): Promise<void> {
  try {
    if (opts.restAlert === false) return await cancelRestAlert(key)
    const text = opts.text ?? DEFAULT_TEXT
    if (isNativePlatform()) {
      return await serial(async () => {
        const id = notificationIdFor(key)
        const ln = await localNotifications()
        await ln.cancel({ notifications: [{ id }] }).catch(() => undefined) // replaces, never stacks
        // Nothing to wait for (already over), or no permission: no notification. The in-app cue still works.
        if (atMs - Date.now() < 1000 || !(await nativeGranted())) return
        // Exact only when the system ALREADY allows it: asking for exact without permission makes the plugin open the
        // system settings by itself, which this app never does unprompted (see the project notes).
        const exact = await exactAlarmAllowed(ln)
        await ln.schedule({
          notifications: [
            {
              id,
              title: text.title,
              body: text.body,
              channelId: CHANNEL,
              autoCancel: true,
              isExactNotification: exact,
              schedule: { at: new Date(atMs), allowWhileIdle: true },
              ...(opts.route ? { extra: { route: opts.route } } : {}),
            },
          ],
        })
      })
    }
    if (typeof window === 'undefined') return
    if (!(await webPermission(opts.restAlert === true))) return
    webSchedule(key, atMs, text)
  } catch {
    /* plugin missing, permission revoked or API unavailable: the in-app timer keeps working */
  }
}

/** Cancels the pending alert of timer `key`. Never throws. */
export async function cancelRestAlert(key: string): Promise<void> {
  try {
    webCancel(key)
    if (isNativePlatform()) await serial(async () => (await localNotifications()).cancel({ notifications: [{ id: notificationIdFor(key) }] }))
  } catch {
    /* nothing scheduled or plugin missing */
  }
}

let audio: AudioContext | null = null
/** Vibration and a short tone, only while the page is visible. Never throws. */
export function playRestEndCue(): void {
  if (globalThis.document?.visibilityState !== 'visible') return
  try {
    globalThis.navigator?.vibrate?.([200, 100, 200])
  } catch {
    /* not supported */
  }
  try {
    const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctx = g.AudioContext ?? g.webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    const ctx = audio
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const t = ctx.currentTime
    ;[880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = t + i * 0.18
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.17)
    })
  } catch {
    /* autoplay policy or no audio output */
  }
}

/**
 * Asks for notification permission from a user gesture (the rest alert or the plan reminder switched on). Asked
 * once; never repeated after a refusal. Scheduling code must NEVER call it.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (isNativePlatform()) return await nativeRequest()
    return await webPermission(true)
  } catch {
    return false
  }
}

/** The rest-alert setting's name for the same explicit request. */
export const enableRestNotifications = requestNotificationPermission

// ───────────── Permission status (V3 session UI) ─────────────

const INTRO_KEY = 'salud.notifications.restIntro'

function removeLocal(k: string) {
  try {
    globalThis.localStorage?.removeItem(k)
  } catch {
    /* private mode or blocked storage */
  }
}

/**
 * 'granted', 'denied' (refused, or asked once and dismissed: never ask again), 'unasked' (a prompt is
 * still possible) or 'unsupported' (no plugin / no Notification API). Reads only; never prompts or throws.
 */
export type RestNotificationStatus = 'granted' | 'denied' | 'unasked' | 'unsupported'
export async function restNotificationStatus(): Promise<RestNotificationStatus> {
  try {
    if (isNativePlatform()) {
      const stored = readLocal(PERM_KEY)
      const display = (await (await localNotifications()).checkPermissions()).display
      if (display === 'granted') return 'granted'
      if (stored === 'denied' || display === 'denied' || stored === 'asked') return 'denied'
      return 'unasked'
    }
    if (typeof window === 'undefined') return 'unsupported'
    const N = webNotification()
    if (!N) return 'unsupported'
    if (N.permission === 'granted') return 'granted'
    if (N.permission === 'denied' || readLocal(WEB_ASKED_KEY)) return 'denied'
    return 'unasked'
  } catch {
    return 'unsupported'
  }
}

/** Whether the one-time explanation of rest notifications was already shown and answered. */
export function restNotificationIntroSeen(): boolean {
  return readLocal(INTRO_KEY) === '1'
}
export function markRestNotificationIntroSeen(): void {
  writeLocal(INTRO_KEY, '1')
}

/**
 * The person switched the alert setting back on after a refusal: forget the app's own "never ask
 * again" mark so `enableRestNotifications()` may show the system prompt once more. The system still
 * decides (a permanently denied web permission stays denied).
 */
export function resetRestNotificationPrompt(): void {
  if (readLocal(PERM_KEY) !== 'granted') removeLocal(PERM_KEY)
  removeLocal(WEB_ASKED_KEY)
}
