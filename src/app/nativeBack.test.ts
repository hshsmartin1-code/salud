import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissStack } from '../ui/dismissStack'
import { registerLeaveGuard } from './leaveGuardRegistry'
import { handleBack, registerNativeBack, type BackEnv, type BackRouter } from './nativeBack'

function setup(over: { pathname?: string; key?: string; canGoBack?: boolean } = {}) {
  const calls: string[] = []
  const router: BackRouter = {
    pathname: () => over.pathname ?? '/comida/buscar',
    locationKey: () => over.key ?? 'abc',
    navigate: (to, o) => calls.push(`nav:${to}${o?.replace ? ':replace' : ''}`),
  }
  const env: BackEnv = {
    isNative: () => true,
    canGoBack: () => over.canGoBack ?? true,
    historyBack: () => calls.push('history.back'),
    minimizeApp: async () => void calls.push('minimizeApp'),
  }
  return { calls, router, env }
}

const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('handleBack executor', () => {
  it('closes only the topmost overlay', async () => {
    const { calls, router, env } = setup()
    const a = vi.fn()
    const b = vi.fn()
    cleanup.push(dismissStack.push(a), dismissStack.push(b))
    expect(await handleBack(router, env)).toBe('closeOverlay')
    expect(b).toHaveBeenCalledOnce()
    expect(a).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('leave guard: stays when the person keeps editing, leaves when confirmed', async () => {
    const { calls, router, env } = setup({ pathname: '/entreno/rutinas/nueva' })
    let answer = false
    cleanup.push(registerLeaveGuard({ fallback: '/entreno', confirmLeave: async () => answer }))
    await handleBack(router, env)
    expect(calls).toEqual([])
    answer = true
    await handleBack(router, env)
    expect(calls).toEqual(['history.back'])
  })

  it('leave guard without history navigates to the screen fallback', async () => {
    const { calls, router, env } = setup({ canGoBack: false, pathname: '/entreno/rutinas/nueva' })
    cleanup.push(registerLeaveGuard({ fallback: '/entreno', confirmLeave: async () => true }))
    await handleBack(router, env)
    expect(calls).toEqual(['nav:/entreno:replace'])
  })

  it('session: minimises like its own button (back, or Entreno on a cold start), never finishes', async () => {
    const warm = setup({ pathname: '/entreno/sesion/s1', key: 'k1' })
    await handleBack(warm.router, warm.env)
    expect(warm.calls).toEqual(['nav:-1'])
    const cold = setup({ pathname: '/entreno/sesion/s1', key: 'default' })
    await handleBack(cold.router, cold.env)
    expect(cold.calls).toEqual(['nav:/entreno'])
  })

  it('root tab without history minimises the app (never exits)', async () => {
    const { calls, router, env } = setup({ pathname: '/', canGoBack: false })
    await handleBack(router, env)
    expect(calls).toEqual(['minimizeApp'])
  })

  it('an error in a step never escapes', async () => {
    const { router, env } = setup({ pathname: '/', canGoBack: false })
    env.minimizeApp = async () => {
      throw new Error('plugin missing')
    }
    await expect(handleBack(router, env)).resolves.toBe('minimizeApp')
  })

  it('registers nothing off Android', () => {
    const { router, env } = setup()
    env.isNative = () => false
    expect(() => registerNativeBack(router, env)()).not.toThrow()
  })
})
