import { afterEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  source: { currentUser: { uid: 'synthetic-move' } as { uid: string } | null, authStateReady: async () => undefined },
  target: { currentUser: null as { uid: string } | null, authStateReady: async () => undefined },
}))
vi.mock('./firebase', () => ({
  PENDING_SESSION: 'pending', isNativeShell: () => false,
  profileServices: async (id: string) => ({ auth: id === 'pending' ? fake.source : fake.target }),
  disposeProfileServices: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  updateCurrentUser: async (auth: typeof fake.target, user: { uid: string }) => { auth.currentUser = user },
  signOut: async (auth: typeof fake.target) => {
    if (auth === fake.source) throw new Error('synthetic sign-out failure')
    auth.currentUser = null
  },
}))
import { adoptPendingSession } from './auth'
afterEach(() => vi.unstubAllGlobals())

it('removes the copied session if ending the pending session fails during adoption', async () => {
  vi.stubGlobal('localStorage', { getItem: () => '1', removeItem: vi.fn() })
  await expect(adoptPendingSession('synthetic-new-profile')).rejects.toThrow('synthetic sign-out failure')
  expect(fake.target.currentUser).toBeNull()
  expect(fake.source.currentUser?.uid).toBe('synthetic-move')
  expect(localStorage.removeItem).not.toHaveBeenCalled()
})
