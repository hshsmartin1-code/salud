import { describe, expect, it, vi } from 'vitest'
import { AUTO_CHECK_INTERVAL_MS, AUTO_CHECK_KEY, createAutoChecker, decideAutoCheck, startAutoChecks, type AutoCheckInput, type ForegroundPort } from './autoCheck'
import type { UpdateState } from './state'

const H = 3600_000
const base: AutoCheckInput = { status: 'idle', working: false, online: true, now: 100 * H, last: null }

describe('decideAutoCheck', () => {
  it.each<[string, Partial<AutoCheckInput>, string]>([
    ['first run, nothing stored', {}, 'check'],
    ['exactly 6 h after the last attempt', { last: 94 * H }, 'check'],
    ['5 h 59 min after the last attempt', { last: 94 * H + 60_000 }, 'too-soon'],
    ['just after the last attempt', { last: 100 * H - 1 }, 'too-soon'],
    ['much later', { last: 10 * H }, 'check'],
    ['clock moved backwards (last attempt is in the future)', { last: 150 * H }, 'check'],
    ['same instant as the last attempt', { last: 100 * H }, 'too-soon'],
    ['offline', { online: false }, 'offline'],
    ['offline and recent: offline is reported first', { online: false, last: 99 * H }, 'offline'],
    ['an operation of this module is running', { working: true }, 'busy'],
    ['a manual check is running', { status: 'checking' }, 'busy'],
    ['a download is running', { status: 'downloading' }, 'busy'],
    ['a bundle is ready to restart', { status: 'ready-to-restart' }, 'ready'],
    ['an offer is already shown', { status: 'available' }, 'ready'],
    ['the one-time notice has not been seen', { status: 'applied' }, 'ready'],
    ['the rollback notice has not been seen', { status: 'rolled-back' }, 'ready'],
    ['previous manual error', { status: 'error' }, 'check'],
    ['previous incompatibility', { status: 'incompatible' }, 'check'],
    ['previous "none"', { status: 'none' }, 'check'],
    ['busy wins over offline', { status: 'downloading', online: false }, 'busy'],
  ])('%s', (_name, over, expected) => {
    expect(decideAutoCheck({ ...base, ...over })).toBe(expected)
  })
  it('uses a 6 hour interval', () => { expect(AUTO_CHECK_INTERVAL_MS).toBe(6 * H) })
})

class Store { values = new Map<string, string>(); getItem(k: string) { return this.values.get(k) ?? null } setItem(k: string, v: string) { this.values.set(k, v) } }
type Kv = { getItem(k: string): string | null; setItem(k: string, v: string): void }
function setup(over: { status?: UpdateState['status']; online?: boolean; check?: () => Promise<UpdateState>; storage?: Kv } = {}) {
  const clock = { t: 1_000 * H }
  const status = { value: over.status ?? 'idle' }
  const check = vi.fn(over.check ?? (async () => ({ status: 'idle' }) as UpdateState))
  const store = new Store()
  const net = { online: over.online ?? true }
  const service = { getState: () => ({ status: status.value }) as UpdateState, check }
  const checker = createAutoChecker({ service, storage: over.storage ?? store, now: () => clock.t, online: () => net.online })
  return { clock, status, check, store, net, checker }
}

describe('createAutoChecker', () => {
  it('checks silently, remembers the attempt and waits 6 h', async () => {
    const f = setup()
    expect(await f.checker.run()).toBe('check')
    expect(f.check).toHaveBeenCalledWith({ silent: true })
    expect(f.store.getItem(AUTO_CHECK_KEY)).toBe(String(f.clock.t))
    f.clock.t += 5 * H
    expect(await f.checker.run()).toBe('too-soon')
    f.clock.t += H
    expect(await f.checker.run()).toBe('check')
    expect(f.check).toHaveBeenCalledTimes(2)
  })
  it('does not stamp or call the service when offline, and checks as soon as the network is back', async () => {
    const f = setup({ online: false })
    expect(await f.checker.run()).toBe('offline')
    expect(f.check).not.toHaveBeenCalled()
    expect(f.store.values.size).toBe(0)
    f.net.online = true
    expect(await f.checker.run()).toBe('check')
  })
  it('never starts while the service downloads, checks or waits for the restart', async () => {
    const f = setup()
    for (const status of ['downloading', 'checking', 'ready-to-restart'] as const) { f.status.value = status; await f.checker.run() }
    expect(f.check).not.toHaveBeenCalled()
  })
  it('refuses a second concurrent run while one is in flight', async () => {
    let finish!: () => void
    const f = setup({ check: () => new Promise((resolve) => { finish = () => resolve({ status: 'idle' }) }) })
    const first = f.checker.run()
    expect(await f.checker.run()).toBe('busy')
    finish(); await first
    expect(f.check).toHaveBeenCalledTimes(1)
  })
  it('swallows a failing service call and still waits the interval', async () => {
    const f = setup({ check: async () => { throw Error('offline') } })
    await expect(f.checker.run()).resolves.toBe('check')
    expect(await f.checker.run()).toBe('too-soon')
  })
  it('falls back to an in-memory timestamp when storage throws (still at most once per interval)', async () => {
    const broken: Kv = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') } }
    const f = setup({ storage: broken })
    expect(await f.checker.run()).toBe('check')
    f.clock.t += H
    expect(await f.checker.run()).toBe('too-soon')
    f.clock.t += 5 * H
    expect(await f.checker.run()).toBe('check')
  })
  it('ignores a corrupt stored value and recovers from a clock that moved backwards', async () => {
    const f = setup()
    f.store.setItem(AUTO_CHECK_KEY, 'not a number')
    expect(await f.checker.run()).toBe('check')
    f.clock.t -= 400 * H // the device clock was set back
    expect(await f.checker.run()).toBe('check')
    expect(f.store.getItem(AUTO_CHECK_KEY)).toBe(String(f.clock.t))
    f.clock.t += H
    expect(await f.checker.run()).toBe('too-soon')
  })
})

describe('startAutoChecks', () => {
  function foreground() {
    let onActive: () => void = () => undefined
    const off = vi.fn()
    const port: ForegroundPort = { subscribe: async (cb) => { onActive = cb; return off } }
    return { port, off, fire: () => onActive() }
  }
  it('runs once now and again on each return to the foreground, until stopped', async () => {
    const run = vi.fn(async () => 'check' as const)
    const fg = foreground()
    const stop = startAutoChecks({ run }, fg.port)
    await Promise.resolve(); await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    fg.fire(); fg.fire()
    expect(run).toHaveBeenCalledTimes(3)
    stop()
    expect(fg.off).toHaveBeenCalledTimes(1)
    fg.fire()
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('removes the listener if it was stopped before the plugin answered, and survives a plugin failure', async () => {
    const run = vi.fn(async () => 'check' as const)
    const off = vi.fn()
    let release!: (fn: () => void) => void
    const slow: ForegroundPort = { subscribe: () => new Promise((resolve) => { release = resolve }) }
    const stop = startAutoChecks({ run }, slow)
    stop(); release(off); await Promise.resolve(); await Promise.resolve()
    expect(off).toHaveBeenCalledTimes(1)
    const failing: ForegroundPort = { subscribe: async () => { throw Error('no plugin') } }
    expect(() => startAutoChecks({ run }, failing)).not.toThrow()
  })
})
