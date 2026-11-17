import { beforeEach, describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ pending: new Map<number, { id: number; channelId?: string }>() }))
vi.mock('./native', () => ({
  isNativePlatform: () => true,
  localNotifications: async () => ({
    checkPermissions: async () => ({ display: 'granted' }),
    schedule: async ({ notifications }: { notifications: { id: number; channelId?: string }[] }) => {
      for (const n of notifications) device.pending.set(n.id, n)
    },
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const n of notifications) device.pending.delete(n.id)
    },
    getPending: async () => ({ notifications: [...device.pending.values()] }),
  }),
}))

import { _resetPlanReminderState, reminderNotificationId, syncTrainingReminders } from './planReminders'

const now = new Date(2026, 10, 16, 6).getTime()
const desired = [{ date: '2026-11-16', atMs: now + 3_600_000, body: '' }]
let values: Map<string, string>
beforeEach(() => {
  device.pending.clear()
  _resetPlanReminderState()
  values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  })
})

describe('native reminder reconciliation without a reliable journal', () => {
  it('turning reminders off cancels them even when storage has always been blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw Error('blocked') },
      setItem: () => { throw Error('blocked') },
      removeItem: () => { throw Error('blocked') },
    })
    await syncTrainingReminders('profile-a', desired, now)
    expect(device.pending.size).toBe(1)
    await syncTrainingReminders('profile-a', [], now)
    expect(device.pending.size).toBe(0)
  })

  it.each(['off', 'switch'])('garbage tracking after a relaunch cannot leave reminders behind: %s', async (action) => {
    await syncTrainingReminders('profile-a', desired, now)
    values.set('salud.plan.reminders|profile-a', '{broken')
    values.set('salud.plan.reminders.profiles', 'null')
    _resetPlanReminderState() // a fresh process cannot rely on the previous in-memory index
    await syncTrainingReminders(action === 'switch' ? 'profile-b' : 'profile-a', [], now)
    expect(device.pending.size).toBe(0)
  })

  it('reschedules a missing native alarm even if local tracking says it still exists', async () => {
    await syncTrainingReminders('profile-a', desired, now)
    device.pending.clear()
    await syncTrainingReminders('profile-a', desired, now)
    expect(device.pending.has(reminderNotificationId('profile-a', desired[0]!.date))).toBe(true)
  })

  it('leaves a rest timer notification alone when clearing orphaned plan reminders', async () => {
    device.pending.set(42, { id: 42, channelId: 'rest-timer' })
    await syncTrainingReminders('profile-a', [], now)
    expect([...device.pending.keys()]).toEqual([42])
  })

  it('replaces legacy positive plan IDs without changing the journal format', async () => {
    const profile = 'profile-82230'
    device.pending.set(1780900450, { id: 1780900450, channelId: 'plan-reminders' })
    values.set(`salud.plan.reminders|${profile}`, JSON.stringify({ [desired[0]!.date]: `${desired[0]!.atMs}|` }))
    values.set('salud.plan.reminders.profiles', JSON.stringify([profile]))
    await syncTrainingReminders(profile, desired, now)
    expect([...device.pending.keys()]).toEqual([reminderNotificationId(profile, desired[0]!.date)])
    expect(device.pending.has(1780900450)).toBe(false)
  })
})
