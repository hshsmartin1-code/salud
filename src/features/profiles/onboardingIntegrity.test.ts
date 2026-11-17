import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], clicks: new Map<string, () => void>(),
  restore: vi.fn(), adopt: vi.fn(), link: vi.fn(), remove: vi.fn(), unlink: vi.fn(), signOut: vi.fn(),
}))
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { fake.effects.push(effect) },
}))
vi.mock('react/jsx-dev-runtime', async (original) => {
  const actual = await original<typeof import('react/jsx-dev-runtime')>()
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    const p = args[1] as Record<string, unknown>
    if (p?.['data-testid'] && p.onClick) fake.clicks.set(String(p['data-testid']), p.onClick as () => void)
    return actual.jsxDEV(...args)
  } }
})
vi.mock('../../sync/auth', () => ({ adoptPendingSession: fake.adopt, signOutProfile: fake.signOut }))
vi.mock('../../sync/link', () => ({ createProfileFromAccount: fake.restore, linkProfile: fake.link, unlinkProfile: fake.unlink }))
vi.mock('../../sync/service', () => ({ remoteFor: async () => ({}), refreshScheduler: vi.fn() }))
vi.mock('../../sync/firebase', () => ({ PENDING_SESSION: 'pending' }))
vi.mock('../../db/schema', () => ({ db: {} }))
vi.mock('../../db/profiles', () => ({ createProfile: vi.fn(), deleteProfile: fake.remove }))
vi.mock('../backup/BackupPage', () => ({ TABLE_LABEL: {} }))
import { ExistingAccount, LinkStep } from './Onboarding'

const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
const account = { uid: 'synthetic-onboarding', email: null, displayName: 'Perfil sintetico' }
const profile = { id: 'synthetic-profile', name: 'Perfil sintetico', sex: 'female' as const, birthDate: null, heightCm: null, activity: null, color: 'sky' as const, settings: { addActivityKcal: false }, createdAt: '', updatedAt: '' }
beforeEach(() => {
  fake.effects = []
  fake.clicks.clear()
  for (const fn of [fake.restore, fake.adopt, fake.link, fake.remove, fake.unlink, fake.signOut]) fn.mockReset().mockResolvedValue(undefined)
})

it('removes a new download finishing after the restore screen has closed', async () => {
  let finish!: (r: { profileId: string }) => void
  fake.restore.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const onRestored = vi.fn()
  renderToStaticMarkup(createElement(ExistingAccount, {
    pending: { account, preview: { counts: {}, total: 0, meta: null, hasData: true, usedBy: null } },
    onRestored, onFresh: vi.fn(), onBack: vi.fn(),
  }))
  const cleanups = fake.effects.map((effect) => effect())
  fake.clicks.get('restore-account')!()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  finish({ profileId: profile.id })
  await flush()
  await flush()
  expect(onRestored).not.toHaveBeenCalled()
  expect(fake.adopt).not.toHaveBeenCalled()
  expect(fake.remove).toHaveBeenCalledWith(profile.id, expect.anything())
})

it('rolls back a session adoption finishing after the link screen has closed', async () => {
  let finish!: () => void
  fake.adopt.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  fake.link.mockResolvedValue({ verify: { ok: true } })
  const onLinked = vi.fn()
  const adoptedRef = { current: null as string | null }
  renderToStaticMarkup(createElement(LinkStep, { profile, account, adoptedRef, onLinked, onSkip: vi.fn() }))
  const cleanups = fake.effects.map((effect) => effect())
  fake.clicks.get('pending-link')!()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  finish()
  await flush()
  await flush()
  expect(onLinked).not.toHaveBeenCalled()
  expect(fake.link).not.toHaveBeenCalled()
  expect(fake.signOut).toHaveBeenCalledWith(profile.id)
  expect(adoptedRef.current).toBeNull()
})

it('removes a downloaded profile when closing after a failed session adoption', async () => {
  fake.restore.mockResolvedValue({ profileId: profile.id })
  fake.adopt.mockRejectedValue(new Error('synthetic offline'))
  const onRestored = vi.fn()
  renderToStaticMarkup(createElement(ExistingAccount, {
    pending: { account, preview: { counts: {}, total: 0, meta: null, hasData: true, usedBy: null } },
    onRestored, onFresh: vi.fn(), onBack: vi.fn(),
  }))
  const cleanups = fake.effects.map((effect) => effect())
  fake.clicks.get('restore-account')!()
  await flush()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  await flush()
  expect(onRestored).not.toHaveBeenCalled()
  expect(fake.remove).toHaveBeenCalledWith(profile.id, expect.anything())
})

it('does not leave a link behind when synchronization finishes after closing', async () => {
  let finish!: (r: { verify: { ok: boolean } }) => void
  fake.link.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const onLinked = vi.fn()
  const adoptedRef = { current: null as string | null }
  renderToStaticMarkup(createElement(LinkStep, { profile, account, adoptedRef, onLinked, onSkip: vi.fn() }))
  const cleanups = fake.effects.map((effect) => effect())
  fake.clicks.get('pending-link')!()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  finish({ verify: { ok: true } })
  await flush()
  await flush()
  expect(onLinked).not.toHaveBeenCalled()
  expect(fake.unlink).toHaveBeenCalledWith(expect.anything(), profile.id)
  expect(fake.signOut).toHaveBeenCalledWith(profile.id)
})
