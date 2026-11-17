/**
 * Android: the official `@capacitor/local-notifications` plugin, reached through the small interface
 * below. The package is imported lazily, so the web bundle and the unit tests (which replace this
 * module) never load it. Off Android every call rejects and the callers degrade silently.
 */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

export interface LocalNotificationsPlugin {
  schedule(options: {
    notifications: {
      id: number
      title: string
      body: string
      schedule?: { at: Date; allowWhileIdle?: boolean }
      channelId?: string
      autoCancel?: boolean
      /** false = inexact alarm. The plugin default is true, which on Android 12+ opens the system "Alarms & reminders" screen. */
      isExactNotification?: boolean
      /** Opaque data returned when the notification is tapped (we put the route to open). */
      extra?: Record<string, unknown>
    }[]
  }): Promise<unknown>
  cancel(options: { notifications: { id: number }[] }): Promise<void>
  getPending?(): Promise<{ notifications: { id: number; channelId?: string }[] }>
  checkPermissions(): Promise<{ display: PermissionState }>
  requestPermissions(): Promise<{ display: PermissionState }>
  /** Android 12+: is SCHEDULE_EXACT_ALARM allowed right now? (installed 8.x API, never opens a screen) */
  checkExactNotificationSetting?(): Promise<{ exact_alarm: PermissionState }>
  /** Opens the system "Alarms & reminders" screen of THIS app. Only call it from a tap. */
  changeExactNotificationSetting?(): Promise<{ exact_alarm: PermissionState }>
  removeAllDeliveredNotifications?(): Promise<void>
  addListener?(event: 'localNotificationActionPerformed', fn: (action: { notification: { extra?: Record<string, unknown> } }) => void): Promise<{ remove(): Promise<void> }>
  createChannel?(channel: { id: string; name: string; description?: string; importance?: 1 | 2 | 3 | 4 | 5; vibration?: boolean }): Promise<void>
}

const METHODS = ['schedule', 'cancel', 'getPending', 'checkPermissions', 'requestPermissions', 'createChannel', 'checkExactNotificationSetting', 'changeExactNotificationSetting', 'removeAllDeliveredNotifications', 'addListener'] as const
let plugin: Promise<LocalNotificationsPlugin> | null = null

/** Lazily loaded so that importing this module never touches Capacitor on the web or in tests. */
export function localNotifications(): Promise<LocalNotificationsPlugin> {
  // A Capacitor plugin is a Proxy that answers every property, 'then' included: resolving a promise with it calls
  // plugin.then() and rejects with "is not implemented on android" (found on a device). Hand out a plain object.
  plugin ??= import('@capacitor/local-notifications').then(
    ({ LocalNotifications: native }) =>
      Object.fromEntries(METHODS.map((name) => [name, (...args: unknown[]) => (native[name] as (...a: unknown[]) => unknown)(...args)])) as unknown as LocalNotificationsPlugin,
  )
  return plugin
}

export const isNativePlatform = (): boolean =>
  typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
