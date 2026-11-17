import { afterEach, expect, it, vi } from 'vitest'
import { _resetRestMemory, getRest, restKey, restStart } from './restTimer'

afterEach(() => { vi.unstubAllGlobals(); _resetRestMemory() })

it('reading expired session timers removes their persistent keys instead of retaining them forever', () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  })
  for (let i = 0; i < 25; i++) {
    data.set(restKey('synthetic-profile', `session-${i}`), JSON.stringify(restStart(60, Date.now() - 7 * 3600_000)))
    expect(getRest('synthetic-profile', `session-${i}`)).toBeNull()
  }
  expect(data.size).toBe(0)
})
