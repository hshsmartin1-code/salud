import { describe, expect, it, vi } from 'vitest'

// Device finding (Salud Dev, Android 14): a Capacitor plugin is a Proxy that answers every property, so resolving a
// promise with it rejected with '"LocalNotifications.then()" is not implemented on android' and no rest alert was scheduled.
describe('localNotifications()', () => {
  it('resolves with a plain object (no then) that delegates to the plugin', async () => {
    vi.resetModules()
    const schedule = vi.fn(async () => ({ notifications: [] }))
    const proxy = new Proxy({}, { get: (_t, prop) => (prop === 'schedule' ? schedule : prop === 'then' ? () => { throw new Error('"then()" is not implemented on android') } : () => Promise.resolve()) })
    vi.doMock('@capacitor/local-notifications', () => ({ LocalNotifications: proxy }))
    const { localNotifications } = await import('./native')
    const plugin = await localNotifications()
    expect('then' in plugin).toBe(false)
    await plugin.schedule({ notifications: [] })
    expect(schedule).toHaveBeenCalledOnce()
    vi.doUnmock('@capacitor/local-notifications')
  })
})
