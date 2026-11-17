import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalNotificationsPlugin, PermissionState } from './native'

// The same kind of fake Capacitor plugin as notifications.test.ts (./native is replaced; the plugin is never loaded).
const state = { native: true, display: 'granted' as PermissionState, failSchedule: false, failCancel: false }
type Sched = { id: number; title: string; body: string; channelId?: string; isExactNotification?: boolean; schedule?: { at: Date; allowWhileIdle?: boolean }; extra?: Record<string, unknown> }
const calls = { schedule: [] as Sched[][], cancel: [] as number[][], request: 0, channels: [] as { id: string; importance?: number }[] }
const fake: LocalNotificationsPlugin = {
  schedule: async (o) => {
    if (state.failSchedule) throw new Error('boom')
    calls.schedule.push(o.notifications as Sched[])
  },
  cancel: async (o) => {
    if (state.failCancel) throw new Error('boom')
    calls.cancel.push(o.notifications.map((n) => n.id))
  },
  checkPermissions: async () => ({ display: state.display }),
  requestPermissions: async () => {
    calls.request++
    return { display: 'granted' }
  },
  createChannel: async (c) => {
    calls.channels.push(c)
  },
}
vi.mock('./native', () => ({ isNativePlatform: () => state.native, localNotifications: async () => fake }))

const { _resetNotificationState, notificationIdFor } = await import('./index')
const { PLAN_REMINDER_ROUTE, PLAN_REMINDER_TITLE, _resetPlanReminderState, clearAllTrainingReminders, clearTrainingReminders, reminderNotificationId, syncTrainingReminders } = await import('./planReminders')

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

const NOW = new Date(2026, 10, 18, 6, 0).getTime()
const at = (date: string, h = 7, m = 30) => {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, mo - 1, d, h, m).getTime()
}
const want = (date: string, body = '', h = 7, m = 30) => ({ date, atMs: at(date, h, m), body })
const A = 'prof-a'
const B = 'prof-b'

let storage = new MemStorage()
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  Object.assign(state, { native: true, display: 'granted', failSchedule: false, failCancel: false })
  calls.schedule = []
  calls.cancel = []
  calls.channels = []
  calls.request = 0
  _resetNotificationState()
  _resetPlanReminderState()
  storage = new MemStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())

const scheduled = () => calls.schedule.flat()

describe('syncTrainingReminders', () => {
  it('first run schedules every future reminder once: channel, text, route, never exact, id from the date', async () => {
    const r = await syncTrainingReminders(A, [want('2026-11-18', 'Pierna A'), want('2026-11-20')], NOW)
    expect(r).toEqual({ scheduled: 2, cancelled: 0 })
    expect(calls.schedule).toHaveLength(1) // one native call for the batch
    const [n1, n2] = scheduled()
    expect(n1).toMatchObject({ id: notificationIdFor(`salud.plan|${A}|2026-11-18`), title: PLAN_REMINDER_TITLE, body: 'Pierna A', channelId: 'plan-reminders', isExactNotification: false, extra: { route: PLAN_REMINDER_ROUTE } })
    expect(n1!.id).toBe(reminderNotificationId(A, '2026-11-18'))
    expect(n1!.schedule).toEqual({ at: new Date(at('2026-11-18')), allowWhileIdle: true })
    expect(n2!.body).not.toBe('') // a day without routine still has a body
    expect(PLAN_REMINDER_TITLE).toBe('Hoy toca entrenar')
    expect(PLAN_REMINDER_ROUTE).toBe('/entreno')
    expect(calls.channels).toEqual([expect.objectContaining({ id: 'plan-reminders', importance: 3 })])
    expect(calls.request).toBe(0)
  })

  it('a second identical run does nothing native (no cancel, no schedule)', async () => {
    const d = [want('2026-11-18', 'Pierna A'), want('2026-11-20')]
    await syncTrainingReminders(A, d, NOW)
    const r = await syncTrainingReminders(A, d, NOW + 60_000)
    expect(r).toEqual({ scheduled: 0, cancelled: 0 })
    expect(calls.schedule).toHaveLength(1)
    expect(calls.cancel).toHaveLength(0)
  })

  it('a changed time replaces only the changed reminders (same ids)', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    const r = await syncTrainingReminders(A, [want('2026-11-18', '', 8, 0), want('2026-11-20', '', 8, 0)], NOW)
    expect(r).toEqual({ scheduled: 2, cancelled: 2 })
    expect(calls.cancel[0]!.sort()).toEqual([reminderNotificationId(A, '2026-11-18'), reminderNotificationId(A, '2026-11-20')].sort())
    expect(calls.schedule[1]!.map((n) => n.schedule!.at.getTime())).toEqual([at('2026-11-18', 8, 0), at('2026-11-20', 8, 0)])
  })

  it('a weekday removed cancels only its dates; the others are untouched', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20'), want('2026-11-25')], NOW)
    const r = await syncTrainingReminders(A, [want('2026-11-18')], NOW)
    expect(r).toEqual({ scheduled: 0, cancelled: 2 })
    expect(calls.cancel).toEqual([[reminderNotificationId(A, '2026-11-20'), reminderNotificationId(A, '2026-11-25')]])
    expect(calls.schedule).toHaveLength(1)
  })

  it('an override that moves a session cancels the old date and schedules the new one', async () => {
    await syncTrainingReminders(A, [want('2026-11-19', 'Torso A')], NOW)
    const r = await syncTrainingReminders(A, [want('2026-11-21', 'Torso A')], NOW)
    expect(r).toEqual({ scheduled: 1, cancelled: 1 })
    expect(calls.cancel).toEqual([[reminderNotificationId(A, '2026-11-19')]])
    expect(scheduled().at(-1)!.id).toBe(reminderNotificationId(A, '2026-11-21'))
  })

  it('a renamed routine updates the body', async () => {
    await syncTrainingReminders(A, [want('2026-11-20', 'Torso A')], NOW)
    await syncTrainingReminders(A, [want('2026-11-20', 'Torso B')], NOW)
    expect(scheduled().at(-1)!.body).toBe('Torso B')
    expect(calls.cancel).toHaveLength(1)
  })

  it('today done: today\'s pending reminder is cancelled, tomorrow\'s stays', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    const r = await syncTrainingReminders(A, [want('2026-11-20')], NOW + 3_600_000) // today finished before 07:30? (06:00 → 07:00)
    expect(r.cancelled).toBe(1)
    expect(calls.cancel).toEqual([[reminderNotificationId(A, '2026-11-18')]])
  })

  it('a reminder that already fired is forgotten without a cancel call', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    const r = await syncTrainingReminders(A, [want('2026-11-20')], at('2026-11-18', 12, 0))
    expect(r).toEqual({ scheduled: 0, cancelled: 0 })
    expect(calls.cancel).toHaveLength(0)
    // and it is not "stale" next time either
    await syncTrainingReminders(A, [want('2026-11-20')], at('2026-11-19', 12, 0))
    expect(calls.cancel).toHaveLength(0)
  })

  it('past instants are never scheduled', async () => {
    const r = await syncTrainingReminders(A, [want('2026-11-17'), { date: '2026-11-18', atMs: NOW, body: '' }, want('2026-11-18')], NOW)
    expect(r.scheduled).toBe(1)
  })

  it('reminder off (nothing desired) cancels everything scheduled', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    const r = await syncTrainingReminders(A, [], NOW)
    expect(r).toEqual({ scheduled: 0, cancelled: 2 })
    expect(await syncTrainingReminders(A, [], NOW)).toEqual({ scheduled: 0, cancelled: 0 })
    expect(calls.cancel).toHaveLength(1)
  })

  it('clearTrainingReminders cancels what the profile scheduled and forgets it', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    expect(await clearTrainingReminders(A)).toEqual({ scheduled: 0, cancelled: 2 })
    expect(await clearTrainingReminders(A)).toEqual({ scheduled: 0, cancelled: 0 })
    await syncTrainingReminders(A, [want('2026-11-18')], NOW) // nothing tracked any more: scheduled again
    expect(calls.schedule).toHaveLength(2)
  })

  it('profile switch: the previous profile\'s reminders are cancelled and the active one\'s scheduled', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    const r = await syncTrainingReminders(B, [want('2026-11-19')], NOW)
    expect(r).toEqual({ scheduled: 1, cancelled: 2 })
    expect(calls.cancel).toEqual([[reminderNotificationId(A, '2026-11-18'), reminderNotificationId(A, '2026-11-20')]])
    expect(scheduled().at(-1)!.id).toBe(reminderNotificationId(B, '2026-11-19'))
    expect(reminderNotificationId(A, '2026-11-19')).not.toBe(reminderNotificationId(B, '2026-11-19'))
    // back to A: B's go away
    await syncTrainingReminders(A, [want('2026-11-18')], NOW)
    expect(calls.cancel.at(-1)).toEqual([reminderNotificationId(B, '2026-11-19')])
  })

  it('permission not granted: nothing is scheduled and the system is never asked; what was scheduled is cancelled', async () => {
    state.display = 'prompt'
    expect(await syncTrainingReminders(A, [want('2026-11-18')], NOW)).toEqual({ scheduled: 0, cancelled: 0 })
    expect(calls.schedule).toHaveLength(0)
    expect(calls.request).toBe(0)
    state.display = 'granted'
    await syncTrainingReminders(A, [want('2026-11-18')], NOW)
    state.display = 'denied' // revoked later in the system settings
    expect(await syncTrainingReminders(A, [want('2026-11-18')], NOW)).toEqual({ scheduled: 0, cancelled: 1 })
    expect(calls.request).toBe(0)
  })

  it('off Android nothing is scheduled or cancelled', async () => {
    state.native = false
    expect(await syncTrainingReminders(A, [want('2026-11-18')], NOW)).toEqual({ scheduled: 0, cancelled: 0 })
    expect(await clearTrainingReminders(A)).toEqual({ scheduled: 0, cancelled: 0 })
    expect(calls.schedule).toHaveLength(0)
    expect(calls.channels).toHaveLength(0)
  })

  it('a plugin rejection is swallowed and reported once; the next success retries and tracks correctly', async () => {
    state.failSchedule = true
    const r1 = await syncTrainingReminders(A, [want('2026-11-18')], NOW)
    const r2 = await syncTrainingReminders(A, [want('2026-11-18')], NOW)
    expect(r1.error).toBe('boom')
    expect(r2.error).toBe('boom')
    expect(r1.scheduled).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    state.failSchedule = false
    expect(await syncTrainingReminders(A, [want('2026-11-18')], NOW)).toEqual({ scheduled: 1, cancelled: 0 }) // it was not tracked, so it is retried
    state.failCancel = true
    const r3 = await syncTrainingReminders(A, [], NOW)
    expect(r3.error).toBe('boom')
    expect(warn).toHaveBeenCalledTimes(2) // reported again only after a success in between
    state.failCancel = false
    expect(await syncTrainingReminders(A, [], NOW)).toEqual({ scheduled: 0, cancelled: 1 }) // still tracked: retried
    expect(await clearTrainingReminders(A)).toEqual({ scheduled: 0, cancelled: 0 })
  })

  it('malformed stored tracking is ignored, not fatal', async () => {
    ;storage.setItem(`salud.plan.reminders|${A}`, '{not json')
    ;storage.setItem('salud.plan.reminders.profiles', '"x"')
    expect(await syncTrainingReminders(A, [want('2026-11-18')], NOW)).toEqual({ scheduled: 1, cancelled: 0 })
  })

  it('duplicate dates in the request schedule one notification', async () => {
    expect((await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-18', 'x')], NOW)).scheduled).toBe(1)
  })
})

// Device finding (the project notes): a Capacitor plugin is a Proxy that answers every property, 'then'
// included; handing it out of a promise rejects. Reminders go through the real adapter here, with such a proxy.
describe('the real adapter with a Capacitor-like proxy', () => {
  it('schedules through the plugin without resolving the proxy from a promise', async () => {
    vi.resetModules()
    vi.doUnmock('./native')
    const schedule = vi.fn(async () => ({ notifications: [] }))
    const cancel = vi.fn(async () => undefined)
    const proxy = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') return () => { throw new Error('"LocalNotifications.then()" is not implemented on android') }
          if (prop === 'schedule') return schedule
          if (prop === 'cancel') return cancel
          if (prop === 'checkPermissions') return async () => ({ display: 'granted' })
          return async () => undefined
        },
      },
    )
    vi.doMock('@capacitor/local-notifications', () => ({ LocalNotifications: proxy }))
    ;(globalThis as { window?: unknown }).window = { Capacitor: { isNativePlatform: () => true } }
    try {
      const { syncTrainingReminders: sync } = await import('./planReminders')
      const r = await sync('proxy-profile', [{ date: '2026-11-20', atMs: Date.now() + 86_400_000, body: 'Pierna A' }])
      expect(r.error).toBeUndefined()
      expect(r.scheduled).toBe(1)
      expect(schedule).toHaveBeenCalledOnce()
    } finally {
      delete (globalThis as { window?: unknown }).window
      vi.doUnmock('@capacitor/local-notifications')
    }
  })
})

describe('clearAllTrainingReminders (the last profile was removed)', () => {
  it('cancels what every profile had scheduled and schedules nothing', async () => {
    await syncTrainingReminders(A, [want('2026-11-18'), want('2026-11-20')], NOW)
    calls.cancel = []
    calls.schedule = []
    const r = await clearAllTrainingReminders()
    expect(r.scheduled).toBe(0)
    expect(calls.schedule).toHaveLength(0)
    expect(new Set(calls.cancel.flat())).toEqual(new Set([reminderNotificationId(A, '2026-11-18'), reminderNotificationId(A, '2026-11-20')]))
    // Nothing is tracked afterwards: a second run makes no native write.
    calls.cancel = []
    await clearAllTrainingReminders()
    expect(calls.cancel).toHaveLength(0)
  })
  it('does nothing on the web and never asks for permission', async () => {
    state.native = false
    await clearAllTrainingReminders()
    expect(calls.cancel).toHaveLength(0)
    expect(calls.request).toBe(0)
  })
})
