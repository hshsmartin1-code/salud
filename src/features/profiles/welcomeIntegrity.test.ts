import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// SSR keeps React's real state/ref hooks. Capture effects and DOM callbacks to exercise
// async lifetimes without a browser, a server, or a Google/Firebase connection.
const fake = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  click: null as null | (() => void),
  signIn: vi.fn(), signOut: vi.fn(), preview: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { fake.effects.push(effect) },
}))
vi.mock('react/jsx-runtime', async (original) => {
  const actual = await original<typeof import('react/jsx-runtime')>()
  const capture = (fn: typeof actual.jsx) => (type: Parameters<typeof fn>[0], props: Parameters<typeof fn>[1], key?: string) => {
    const p = props as Record<string, unknown>
    if (p?.['data-testid'] === 'welcome-google') fake.click = p.onClick as () => void
    return fn(type, props, key)
  }
  return { ...actual, jsx: capture(actual.jsx), jsxs: capture(actual.jsxs) }
})
vi.mock('react/jsx-dev-runtime', async (original) => {
  const actual = await original<typeof import('react/jsx-dev-runtime')>()
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    const p = args[1] as Record<string, unknown>
    if (p?.['data-testid'] === 'welcome-google') fake.click = p.onClick as () => void
    return actual.jsxDEV(...args)
  } }
})
vi.mock('react-router-dom', () => ({ Link: 'a' }))
vi.mock('../../sync/config', () => ({ SYNC_CONFIG: {} }))
vi.mock('../../sync/auth', () => ({ signInPending: fake.signIn, signOutPending: fake.signOut }))
vi.mock('../../sync/service', () => ({ remoteFor: async () => ({}) }))
vi.mock('../../sync/firebase', () => ({ PENDING_SESSION: 'pending' }))
vi.mock('../../sync/link', () => ({ previewAccount: fake.preview }))
import { Welcome } from './Welcome'

const account = { uid: 'synthetic-welcome', email: null, displayName: 'Perfil sintetico' }
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
beforeEach(() => {
  fake.effects = []
  fake.click = null
  fake.signIn.mockReset()
  fake.signOut.mockReset().mockResolvedValue(undefined)
  fake.preview.mockReset().mockResolvedValue({ hasData: false })
})
afterEach(() => vi.restoreAllMocks())

it('signs out a popup result arriving after welcome unmounted, without handing it to another flow', async () => {
  let finish!: (value: typeof account) => void
  fake.signIn.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const onSignedIn = vi.fn()
  renderToStaticMarkup(createElement(Welcome, { onLocal: vi.fn(), onSignedIn }))
  const cleanups = fake.effects.map((effect) => effect())
  await flush()
  fake.signOut.mockClear()
  fake.click!()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  finish(account)
  await flush()
  await flush()
  expect(onSignedIn).not.toHaveBeenCalled()
  expect(fake.signOut).toHaveBeenCalled()
})

it('opens Google only once for two calls before the button can rerender as disabled', async () => {
  fake.signIn.mockImplementation(() => new Promise(() => undefined))
  renderToStaticMarkup(createElement(Welcome, { onLocal: vi.fn(), onSignedIn: vi.fn() }))
  fake.effects.forEach((effect) => effect())
  await flush()
  fake.click!()
  fake.click!()
  await flush()
  expect(fake.signIn).toHaveBeenCalledTimes(1)
})

it('waits for stale sign-out before starting a new pending session', async () => {
  let finish!: () => void
  fake.signOut.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  fake.signIn.mockResolvedValue(account)
  const onSignedIn = vi.fn()
  renderToStaticMarkup(createElement(Welcome, { onLocal: vi.fn(), onSignedIn }))
  fake.effects.forEach((effect) => effect())
  await flush()
  fake.click!()
  await flush()
  expect(fake.signIn).not.toHaveBeenCalled()
  finish()
  await flush()
  await flush()
  expect(onSignedIn).toHaveBeenCalledTimes(1)
  expect(fake.signOut).toHaveBeenCalledTimes(1) // the handed-off session stays available for confirmation
})

it('discards an account preview arriving after welcome unmounted', async () => {
  let finish!: (value: { hasData: boolean }) => void
  fake.signIn.mockResolvedValue(account)
  fake.preview.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const onSignedIn = vi.fn()
  renderToStaticMarkup(createElement(Welcome, { onLocal: vi.fn(), onSignedIn }))
  const cleanups = fake.effects.map((effect) => effect())
  await flush()
  fake.signOut.mockClear()
  fake.click!()
  await flush()
  for (const cleanup of cleanups) cleanup?.()
  finish({ hasData: true })
  await flush()
  await flush()
  expect(onSignedIn).not.toHaveBeenCalled()
  expect(fake.signOut).toHaveBeenCalledTimes(1)
})
