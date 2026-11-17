import { describe, expect, it } from 'vitest'
import { notificationIdFor } from './index'
import { reminderNotificationId } from './planReminders'

describe('plan and rest notification namespaces', () => {
  it('a concrete hash collision must not let a rest timer replace or cancel a plan reminder', () => {
    const plan = reminderNotificationId('profile-82230', '2026-11-16')
    const rest = notificationIdFor('salud.rest|profile-a|session-36446')
    // Both previously mapped to 1780900450: native notifications are keyed by ID, regardless of channel.
    const pending = new Map([[plan, 'plan']])
    pending.set(rest, 'rest')
    pending.delete(rest)
    expect(pending.get(plan)).toBe('plan')
    expect(plan).not.toBe(rest)
    expect(rest).toBe(1780900450) // existing rest alerts retain their identity
  })
})
