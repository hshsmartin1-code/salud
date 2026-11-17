import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], cue: vi.fn() }))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  useEffect: (effect: () => void | (() => void)) => { fake.effects.push(effect) },
}))
vi.mock('../../integrations/notifications', () => ({ playRestEndCue: fake.cue, cancelRestAlert: vi.fn(), scheduleRestAlert: vi.fn() }))
import { _resetRestMemory, getRest, restView, startRest, useRestTimer } from './restTimer'

const base = 1_800_000_000_000
let now = base
function renderTimer(profile: string) {
  fake.effects = []
  renderToStaticMarkup(createElement(() => { useRestTimer(profile, 'synthetic-session'); return null }))
  const cleanups = fake.effects.map((effect) => effect())
  cleanups.forEach((cleanup) => cleanup?.())
}
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) })
  vi.stubGlobal('document', new EventTarget())
  now = base
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  _resetRestMemory()
  fake.cue.mockClear()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('plays one cue across bar, pill and popover subscribers at the same end', () => {
  const profile = 'synthetic-cue-profile'
  startRest(profile, 'synthetic-session', 5)
  renderTimer(profile)
  expect(fake.cue).not.toHaveBeenCalled()
  now += 5000
  renderTimer(profile)
  renderTimer(profile)
  renderTimer(profile)
  expect(fake.cue).toHaveBeenCalledTimes(1)
})

it('reloads the original deadline and exercise without restarting or crossing profiles', () => {
  startRest('synthetic-profile-a', 'synthetic-session', 90, { exerciseId: 'synthetic:exercise-a' })
  now += 35000
  _resetRestMemory()
  const state = getRest('synthetic-profile-a', 'synthetic-session')
  expect(state?.endsAt).toBe(base + 90000)
  expect(state?.exerciseId).toBe('synthetic:exercise-a')
  expect(restView(state, now).leftSec).toBe(55)
  expect(getRest('synthetic-profile-b', 'synthetic-session')).toBeNull()
})
