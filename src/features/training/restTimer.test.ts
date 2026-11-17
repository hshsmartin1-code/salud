import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetRestMemory, freshNow, addRest, clearRest, getRest, pauseRest, restAdd, restKey, restPause, restResume, restStart, restView, resumeRest, skipRest, startRest, subscribeRest, sweepRestTimers } from './restTimer'

/** Minimal localStorage double (the store reads globalThis.localStorage lazily). */
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  keys() {
    return [...this.m.keys()]
  }
  get length() {
    return this.m.size
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
}
let store: MemStorage
beforeEach(() => {
  store = new MemStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = store
  _resetRestMemory()
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  _resetRestMemory()
})

const T0 = 1_800_000_000_000

describe('rest timer arithmetic (timestamps only)', () => {
  it('counts down from the start and reports over-time after the end', () => {
    const s = restStart(90, T0)
    expect(restView(s, T0)).toMatchObject({ status: 'running', leftSec: 90, totalSec: 90, fraction: 1 })
    expect(restView(s, T0 + 30_000)).toMatchObject({ status: 'running', leftSec: 60 })
    expect(restView(s, T0 + 30_400).leftSec).toBe(60) // rounded up
    expect(restView(s, T0 + 90_000)).toMatchObject({ status: 'over', leftSec: 0, overSec: 0 })
    expect(restView(s, T0 + 100_000)).toMatchObject({ status: 'over', overSec: 10 })
  })

  it('pause freezes the remaining time and resume continues from it, however long the pause', () => {
    let s = restStart(120, T0)
    s = restPause(s, T0 + 20_000)
    expect(restView(s, T0 + 20_000)).toMatchObject({ status: 'paused', leftSec: 100 })
    expect(restView(s, T0 + 3_600_000)).toMatchObject({ status: 'paused', leftSec: 100 }) // an hour later
    s = restResume(s, T0 + 3_600_000)
    expect(restView(s, T0 + 3_600_000 + 40_000)).toMatchObject({ status: 'running', leftSec: 60 })
    expect(restPause(restPause(s, T0), T0)).toEqual(restPause(s, T0)) // idempotent
    expect(restResume(s, T0 + 1)).toBe(s) // already running
  })

  it('a long background period is just elapsed time (no ticking needed)', () => {
    const s = restStart(60, T0)
    // The app was in the background for 10 minutes: no interval ran meanwhile.
    expect(restView(s, T0 + 600_000)).toMatchObject({ status: 'over', overSec: 540 })
  })

  it('±seconds adjusts the end and the bar total, never below zero', () => {
    let s = restStart(60, T0)
    s = restAdd(s, 15, T0 + 10_000)
    expect(restView(s, T0 + 10_000)).toMatchObject({ leftSec: 65, totalSec: 75 })
    s = restAdd(s, -15, T0 + 10_000)
    expect(restView(s, T0 + 10_000)).toMatchObject({ leftSec: 50, totalSec: 60 })
    s = restAdd(s, -600, T0 + 10_000)
    expect(restView(s, T0 + 10_000)).toMatchObject({ status: 'over', leftSec: 0 })
    let p = restPause(restStart(60, T0), T0 + 30_000)
    p = restAdd(p, 15, T0 + 99_000)
    expect(restView(p, T0 + 99_000)).toMatchObject({ status: 'paused', leftSec: 45 })
  })
})

describe('device store', () => {
  it('is keyed by profile + session and survives a reload (fresh memory, same storage)', () => {
    const now = Date.now()
    startRest('p1', 's1', 90, { now, restAlert: false })
    startRest('p2', 's1', 30, { now, restAlert: false })
    expect(store.keys().sort()).toEqual([restKey('p1', 's1'), restKey('p2', 's1')].sort())
    _resetRestMemory() // "reload"
    expect(restView(getRest('p1', 's1'), now + 20_000)).toMatchObject({ status: 'running', leftSec: 70 })
    expect(restView(getRest('p2', 's1'), now + 20_000)).toMatchObject({ status: 'running', leftSec: 10 })
    expect(getRest('p1', 'other')).toBeNull()
  })

  it('pause, resume, add and skip go through the store and notify subscribers', () => {
    const now = Date.now()
    let calls = 0
    const unsub = subscribeRest(() => calls++)
    startRest('p', 's', 100, { now, restAlert: false })
    pauseRest('p', 's', { now: now + 10_000, restAlert: false })
    _resetRestMemory()
    expect(restView(getRest('p', 's'), now + 500_000)).toMatchObject({ status: 'paused', leftSec: 90 })
    resumeRest('p', 's', { now: now + 500_000, restAlert: false })
    addRest('p', 's', 30, { now: now + 500_000, restAlert: false })
    expect(restView(getRest('p', 's'), now + 500_000)).toMatchObject({ status: 'running', leftSec: 120 })
    skipRest('p', 's')
    expect(getRest('p', 's')).toBeNull()
    expect(store.keys()).toEqual([])
    expect(calls).toBe(5)
    unsub()
    // Operations on a missing timer are no-ops.
    expect(pauseRest('p', 's', { restAlert: false })).toBeNull()
    clearRest('p', 's')
  })

  it('a snapshot is stable between reads (safe for useSyncExternalStore)', () => {
    startRest('p', 's', 60, { restAlert: false })
    expect(getRest('p', 's')).toBe(getRest('p', 's'))
  })

  it('works without storage (private mode): memory only', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    startRest('p', 's', 60, { restAlert: false })
    expect(getRest('p', 's')).not.toBeNull()
  })

  it('ignores garbage and forgets a rest that ended long ago', () => {
    store.setItem(restKey('p', 'bad'), '{not json')
    expect(getRest('p', 'bad')).toBeNull()
    store.setItem(restKey('p', 'old'), JSON.stringify({ ...restStart(60, Date.now() - 7 * 3600_000) }))
    expect(getRest('p', 'old')).toBeNull()
  })
  it('remembers which exercise the rest follows through pause, ± and resume (and a reload)', () => {
    const now = Date.now()
    startRest('p', 'x', 90, { restAlert: false, exerciseId: 'fedb:Barbell_Squat', now })
    expect(getRest('p', 'x')?.exerciseId).toBe('fedb:Barbell_Squat')
    pauseRest('p', 'x', { restAlert: false, now: now + 1000 })
    addRest('p', 'x', 15, { restAlert: false, now: now + 2000 })
    resumeRest('p', 'x', { restAlert: false, now: now + 3000 })
    _resetRestMemory()
    expect(getRest('p', 'x')?.exerciseId).toBe('fedb:Barbell_Squat')
    // Without one, the stored state has no exerciseId field at all (same shape as before).
    expect('exerciseId' in restStart(60, now)).toBe(false)
  })
})

describe('abandoned timers', () => {
  it('an expired timer is removed from storage when read', () => {
    store.setItem(restKey('p', 'old'), JSON.stringify(restStart(60, Date.now() - 7 * 3600_000)))
    expect(getRest('p', 'old')).toBeNull()
    expect(store.keys()).toEqual([])
  })
  it('the sweep removes only expired keys of the given profile', () => {
    const now = Date.now()
    store.setItem(restKey('p', 'old'), JSON.stringify(restStart(60, now - 7 * 3600_000)))
    store.setItem(restKey('p', 'garbage'), '{nope')
    store.setItem(restKey('p', 'live'), JSON.stringify(restStart(90, now)))
    store.setItem(restKey('p', 'paused-forever'), JSON.stringify(restPause(restStart(90, now - 30 * 3600_000), now - 30 * 3600_000 + 1000)))
    store.setItem(restKey('other', 'old'), JSON.stringify(restStart(60, now - 7 * 3600_000)))
    store.setItem('unrelated', 'x')
    expect(sweepRestTimers('p', now)).toBe(3)
    expect(store.keys().sort()).toEqual([restKey('other', 'old'), restKey('p', 'live'), 'unrelated'].sort())
  })
})

describe('first painted value of a new rest', () => {
  it('ignores a tick sampled for an older state and reads the real clock', () => {
    const old = restStart(90, 1_000)
    const staleTick = { now: 1_000, token: old }
    const t0 = 31_000 // 30 s later the person completes a set
    const fresh = restStart(90, t0)
    // Using the stale tick would show 90 + 30 = 120 s (2:00/2:01).
    expect(restView(fresh, staleTick.now).leftSec).toBe(120)
    expect(restView(fresh, freshNow(staleTick, fresh, t0)).leftSec).toBe(90)
  })
  it('keeps the sampled tick while it belongs to the same state', () => {
    const s = restStart(90, 0)
    expect(freshNow({ now: 5_000, token: s }, s, 9_999)).toBe(5_000)
  })
})
