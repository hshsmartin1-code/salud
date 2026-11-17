import { afterEach, describe, expect, it, vi } from 'vitest'
import { remindersFor } from './plan'

afterEach(() => vi.unstubAllEnvs())

describe('reminder window follows the device calendar', () => {
  const days = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), {}]))
  it('keeps all 28 days just after midnight east of Bogotá', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo')
    const now = new Date(2026, 10, 16, 0, 30)
    const reminders = remindersFor({ days, reminder: { on: true, time: '07:00' } }, now, new Set())
    expect(reminders).toHaveLength(28)
    expect(reminders[0]!.date).toBe('2026-11-16')
    expect(reminders.at(-1)!.date).toBe('2026-12-13')
  })

  it('includes a future reminder today while Bogotá is already on tomorrow', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const now = new Date(2026, 10, 16, 23, 30)
    const reminders = remindersFor({ days, reminder: { on: true, time: '23:45' } }, now, new Set())
    expect(reminders[0]!.date).toBe('2026-11-16')
    expect(reminders[0]!.atMs).toBe(new Date(2026, 10, 16, 23, 45).getTime())
    expect(reminders).toHaveLength(28)
  })
})
