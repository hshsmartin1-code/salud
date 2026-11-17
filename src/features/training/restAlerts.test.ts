import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalNotificationsPlugin, PermissionState } from '../../integrations/notifications/native'

/**
 * The rest timer drives the Android notification through the real adapter, against a fake
 * LocalNotifications plugin that keeps the set of pending notifications (schedule replaces by id).
 */
const world = { display: 'granted' as PermissionState, exact: 'denied' as PermissionState, pending: new Map<number, number>(), exactFlags: [] as boolean[], extras: [] as unknown[], scheduleCalls: 0 }
const fake: LocalNotificationsPlugin = {
  schedule: async ({ notifications }) => {
    for (const n of notifications) {
      world.scheduleCalls++
      world.exactFlags.push(n.isExactNotification === true)
      world.extras.push(n.extra)
      world.pending.set(n.id, n.schedule!.at.getTime())
    }
  },
  cancel: async ({ notifications }) => {
    for (const n of notifications) world.pending.delete(n.id)
  },
  checkPermissions: async () => ({ display: world.display }),
  requestPermissions: async () => ({ display: world.display }),
  checkExactNotificationSetting: async () => ({ exact_alarm: world.exact }),
  createChannel: async () => undefined,
}
vi.mock('../../integrations/notifications/native', () => ({ isNativePlatform: () => true, localNotifications: async () => fake }))

const { notificationIdFor } = await import('../../integrations/notifications')
const { _resetNotificationState } = await import('../../integrations/notifications')
const { _resetRestMemory, addRest, cancelRestForSet, clearRest, expireRest, pauseRest, restEnded, restKey, resumeRest, skipRest, startRest } = await import('./restTimer')

const P = 'perfil-a'
const S = 'sesion-1'
const id = notificationIdFor(restKey(P, S))
const flush = () => new Promise((r) => setTimeout(r, 0))
const T0 = Date.now()

beforeEach(async () => {
  world.display = 'granted'
  world.pending.clear()
  world.scheduleCalls = 0
  world.exact = 'denied'
  world.exactFlags = []
  world.extras = []
  _resetNotificationState()
  _resetRestMemory()
  clearRest(P, S)
  clearRest(P, 'otra-sesion')
  await flush()
  world.pending.clear()
})

describe('rest timer -> Android notification', () => {
  it('start schedules exactly one notification at the rest end time', async () => {
    startRest(P, S, 90, { now: T0, setId: 'set-1' })
    await flush()
    expect([...world.pending]).toEqual([[id, T0 + 90_000]])
  })

  it('+15 / -15 reschedule the same id instead of stacking', async () => {
    startRest(P, S, 90, { now: T0 })
    addRest(P, S, 15, { now: T0 + 1000 })
    await flush()
    expect(world.pending.size).toBe(1)
    expect(world.pending.get(id)).toBe(T0 + 1000 + 90_000 - 1000 + 15_000)
    addRest(P, S, -15, { now: T0 + 2000 })
    await flush()
    expect(world.pending.size).toBe(1)
    expect(world.pending.get(id)).toBe(T0 + 90_000)
  })

  it('pause cancels, resume schedules again from the time left', async () => {
    startRest(P, S, 60, { now: T0 })
    pauseRest(P, S, { now: T0 + 20_000 })
    await flush()
    expect(world.pending.size).toBe(0)
    resumeRest(P, S, { now: T0 + 50_000 })
    await flush()
    expect(world.pending.get(id)).toBe(T0 + 50_000 + 40_000)
  })

  it('skip cancels', async () => {
    startRest(P, S, 60, { now: T0 })
    await flush()
    skipRest(P, S)
    await flush()
    expect(world.pending.size).toBe(0)
  })

  it('un-ticking the set that started the rest cancels it; another set does not', async () => {
    startRest(P, S, 60, { now: T0, setId: 'set-1' })
    await flush()
    expect(cancelRestForSet(P, S, 'set-2')).toBe(false)
    await flush()
    expect(world.pending.size).toBe(1)
    expect(cancelRestForSet(P, S, 'set-1')).toBe(true)
    await flush()
    expect(world.pending.size).toBe(0)
  })

  it('finishing or deleting the session (clearRest) cancels', async () => {
    startRest(P, S, 60, { now: T0 })
    await flush()
    clearRest(P, S)
    await flush()
    expect(world.pending.size).toBe(0)
  })

  it('two sessions do not replace each other (stable id per profile + session)', async () => {
    startRest(P, S, 60, { now: T0 })
    startRest(P, 'otra-sesion', 60, { now: T0 })
    await flush()
    expect(world.pending.size).toBe(2)
    expect(notificationIdFor(restKey(P, S))).not.toBe(notificationIdFor(restKey(P, 'otra-sesion')))
  })

  it('permission denied: nothing is scheduled and the in-app timer still works', async () => {
    world.display = 'denied'
    const s = startRest(P, S, 60, { now: T0 })
    await flush()
    expect(world.scheduleCalls).toBe(0)
    expect(s?.endsAt).toBe(T0 + 60_000)
  })

  it('alert setting off: nothing is scheduled', async () => {
    startRest(P, S, 60, { now: T0, restAlert: false })
    await flush()
    expect(world.pending.size).toBe(0)
  })

  it('a rest that ends by itself in the background keeps its notification (expire does not cancel)', async () => {
    startRest(P, S, 15, { now: T0 })
    await flush()
    expect(restEnded(P, S, false)).toBe(false) // hidden page at the end: nothing cancelled
    expireRest(P, S) // the auto-fold of the finished bar
    await flush()
    expect(world.pending.get(id)).toBe(T0 + 15_000)
  })

  it('a rest that ends while the app is visible cancels the notification (the in-app cue alerts)', async () => {
    startRest(P, S, 15, { now: T0 })
    await flush()
    expect(restEnded(P, S, true)).toBe(true)
    await flush()
    expect(world.pending.size).toBe(0)
  })

  it('changing the duration reschedules to the new end', async () => {
    startRest(P, S, 60, { now: T0 })
    addRest(P, S, 15, { now: T0 })
    await flush()
    expect([...world.pending]).toEqual([[id, T0 + 75_000]])
  })

  it('uses an exact alarm only when the system already allows it; otherwise inexact (never opens settings)', async () => {
    startRest(P, S, 60, { now: T0 })
    await flush()
    expect(world.exactFlags).toEqual([false])
    world.exact = 'granted'
    startRest(P, S, 60, { now: T0 })
    await flush()
    expect(world.exactFlags).toEqual([false, true])
  })

  it('the alert carries the session route so a tap opens it', async () => {
    startRest(P, S, 60, { now: T0 })
    await flush()
    expect(world.extras[0]).toEqual({ route: '/entreno/sesion/' + S })
  })
})
