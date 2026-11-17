import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalNotificationsPlugin, PermissionState } from './native'

// A fake Capacitor LocalNotifications plugin (the plugin itself is imported lazily by ./native).
const state = { native: false, display: 'prompt' as PermissionState, afterRequest: 'granted' as PermissionState, missing: false }
const calls = { schedule: [] as unknown[], cancel: [] as unknown[], request: 0, channels: [] as unknown[] }
const fake: LocalNotificationsPlugin = {
  schedule: async (o) => {
    if (state.missing) throw new Error('"LocalNotifications" plugin is not implemented on android')
    calls.schedule.push(o)
  },
  cancel: async (o) => {
    if (state.missing) throw new Error('not implemented')
    calls.cancel.push(o)
  },
  checkPermissions: async () => {
    if (state.missing) throw new Error('not implemented')
    return { display: state.display }
  },
  createChannel: async (c) => {
    calls.channels.push(c)
  },
  requestPermissions: async () => {
    calls.request++
    state.display = state.afterRequest
    return { display: state.display }
  },
}
vi.mock('./native', () => ({ isNativePlatform: () => state.native, localNotifications: async () => fake }))

const { _resetNotificationState, cancelRestAlert, enableRestNotifications, markRestNotificationIntroSeen, notificationIdFor, playRestEndCue, resetRestNotificationPrompt, restNotificationIntroSeen, restNotificationStatus, scheduleRestAlert } = await import('./index')

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

beforeEach(() => {
  Object.assign(state, { native: false, display: 'prompt', afterRequest: 'granted', missing: false })
  calls.schedule = []
  calls.cancel = []
  calls.channels = []
  calls.request = 0
  _resetNotificationState()
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()
})

describe('rest alert adapter', () => {
  it('degrades silently without window, plugin or permission', async () => {
    await expect(scheduleRestAlert('k', Date.now() + 1000)).resolves.toBeUndefined() // node: no window, no Notification
    await expect(cancelRestAlert('k')).resolves.toBeUndefined()
    expect(() => playRestEndCue()).not.toThrow()
    state.native = true
    state.missing = true // plugin not installed yet
    await expect(scheduleRestAlert('k', Date.now() + 1000)).resolves.toBeUndefined()
    await expect(cancelRestAlert('k')).resolves.toBeUndefined()
  })

  it('Android: scheduling never asks for permission; it only schedules when already granted, by a stable id', async () => {
    state.native = true
    const at = Date.now() + 90_000
    await scheduleRestAlert('salud.rest|p|s', at) // permission is "prompt": nothing is requested, nothing scheduled
    expect(calls.request).toBe(0)
    expect(calls.schedule).toHaveLength(0)
    state.display = 'granted'
    await scheduleRestAlert('salud.rest|p|s', at)
    expect(calls.request).toBe(0)
    expect(calls.schedule).toHaveLength(1)
    const n = (calls.schedule[0] as { notifications: { id: number; channelId: string; isExactNotification: boolean; schedule: { at: Date; allowWhileIdle: boolean } }[] }).notifications[0]!
    expect(n.id).toBe(notificationIdFor('salud.rest|p|s'))
    expect(n.channelId).toBe('rest-timer')
    expect(n.isExactNotification).toBe(false) // never opens the exact-alarm settings screen
    expect(n.schedule.at.getTime()).toBe(at)
    expect(n.schedule.allowWhileIdle).toBe(true)
    await scheduleRestAlert('salud.rest|p|s', at + 15_000) // reschedule (±15 s): cancel + same id
    expect(calls.schedule).toHaveLength(2)
    expect((calls.schedule[1] as { notifications: { id: number }[] }).notifications[0]!.id).toBe(n.id)
    await cancelRestAlert('salud.rest|p|s')
    expect(calls.cancel.at(-1)).toEqual({ notifications: [{ id: n.id }] })
  })

  it('Android: the rest-timer channel is created once, high importance with vibration', async () => {
    state.native = true
    state.display = 'granted'
    await scheduleRestAlert('a', Date.now() + 60_000)
    await scheduleRestAlert('a', Date.now() + 75_000)
    await scheduleRestAlert('b', Date.now() + 75_000)
    expect(calls.channels).toHaveLength(1)
    expect(calls.channels[0]).toMatchObject({ id: 'rest-timer', importance: 4, vibration: true })
  })

  it('Android: a rest that is already over schedules nothing and clears the pending alert', async () => {
    state.native = true
    state.display = 'granted'
    await scheduleRestAlert('k', Date.now() - 5000)
    expect(calls.schedule).toHaveLength(0)
    expect(calls.cancel).toHaveLength(1)
  })

  it('Android: only the explicit enable action asks, once; a refusal is never asked again', async () => {
    state.native = true
    state.afterRequest = 'denied'
    expect(await enableRestNotifications()).toBe(false)
    await scheduleRestAlert('k', Date.now() + 60_000)
    await scheduleRestAlert('k', Date.now() + 60_000)
    state.display = 'prompt' // even if the system would allow another prompt
    expect(await enableRestNotifications()).toBe(false)
    expect(calls.request).toBe(1)
    expect(calls.schedule).toHaveLength(0)
  })

  it('Android: a permission granted later from the system settings is honoured', async () => {
    state.native = true
    state.afterRequest = 'denied'
    await enableRestNotifications()
    state.display = 'granted'
    expect(await restNotificationStatus()).toBe('granted')
    await scheduleRestAlert('k', Date.now() + 60_000)
    expect(calls.schedule).toHaveLength(1)
  })

  it('restAlert false cancels instead of scheduling', async () => {
    state.native = true
    state.display = 'granted'
    await scheduleRestAlert('k', Date.now() + 1000, { restAlert: false })
    expect(calls.schedule).toHaveLength(0)
    expect(calls.cancel).toHaveLength(1)
  })

  it('notification ids are positive 31-bit integers', () => {
    for (const k of ['a', 'salud.rest|x|y', '']) {
      const id = notificationIdFor(k)
      expect(Number.isInteger(id) && id > 0 && id < 2 ** 31).toBe(true)
    }
  })
})

describe('permission status for the session UI', () => {
  it('reads the status without prompting, and unsupported without plugin or window', async () => {
    expect(await restNotificationStatus()).toBe('unsupported') // node: no window
    state.native = true
    state.missing = true
    expect(await restNotificationStatus()).toBe('unsupported')
    state.missing = false
    expect(await restNotificationStatus()).toBe('unasked')
    expect(calls.request).toBe(0)
    state.display = 'granted'
    expect(await restNotificationStatus()).toBe('granted')
  })

  it('a refusal reads as denied and is never asked again, until the setting re-enables it', async () => {
    state.native = true
    state.afterRequest = 'denied'
    expect(await enableRestNotifications()).toBe(false)
    expect(await restNotificationStatus()).toBe('denied')
    state.display = 'prompt'
    expect(await enableRestNotifications()).toBe(false)
    expect(calls.request).toBe(1)
    // Switching the alert setting back on allows one more system prompt.
    resetRestNotificationPrompt()
    state.afterRequest = 'granted'
    expect(await restNotificationStatus()).toBe('unasked')
    expect(await enableRestNotifications()).toBe(true)
    expect(calls.request).toBe(2)
    expect(await restNotificationStatus()).toBe('granted')
  })

  it('remembers that the one-time explanation was answered', () => {
    expect(restNotificationIntroSeen()).toBe(false)
    markRestNotificationIntroSeen()
    expect(restNotificationIntroSeen()).toBe(true)
  })
})
