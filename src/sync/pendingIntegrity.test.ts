import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'synthetic-account' }, authStateReady: async () => undefined },
  signOut: vi.fn(), dispose: vi.fn(),
}))
vi.mock('./firebase', () => ({
  PENDING_SESSION: 'pending', isNativeShell: () => false,
  profileServices: async () => ({ auth: fake.auth }), disposeProfileServices: fake.dispose,
}))
vi.mock('firebase/auth', () => ({ signOut: fake.signOut }))
import { signOutPending } from './auth'

beforeEach(() => {
  const values = new Map([['salud-pending-session', '1']])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  })
  fake.signOut.mockReset()
  fake.dispose.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

it('retries stale cleanup after sign-out failed instead of forgetting the persisted session', async () => {
  fake.signOut.mockRejectedValueOnce(new Error('synthetic storage failure')).mockResolvedValueOnce(undefined)
  await expect(signOutPending()).rejects.toThrow('synthetic storage failure')
  expect(localStorage.getItem('salud-pending-session')).toBe('1')
  await signOutPending({ onlyIfStale: true })
  expect(fake.signOut).toHaveBeenCalledTimes(2)
  expect(localStorage.getItem('salud-pending-session')).toBeNull()
})
