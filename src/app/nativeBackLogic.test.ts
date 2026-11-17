import { describe, expect, it } from 'vitest'
import { decideBack, isRootTab, isSessionRoute, type BackState } from './nativeBackLogic'
import { activeLeaveGuard, registerLeaveGuard } from './leaveGuardRegistry'

const base: BackState = { overlays: 0, hasLeaveGuard: false, pathname: '/comida/buscar', canGoBack: true }
const d = (o: Partial<BackState>) => decideBack({ ...base, ...o })

describe('hardware Back decision', () => {
  it('closes an open overlay before anything else', () => {
    expect(d({ overlays: 1 })).toBe('closeOverlay')
    expect(d({ overlays: 2, hasLeaveGuard: true, pathname: '/entreno/sesion/abc', canGoBack: true })).toBe('closeOverlay')
  })
  it('asks before leaving a screen with unsaved changes (after overlays, before the session)', () => {
    expect(d({ hasLeaveGuard: true })).toBe('confirmLeave')
    expect(d({ hasLeaveGuard: true, canGoBack: false, pathname: '/entreno/rutinas/nueva' })).toBe('confirmLeave')
  })
  it('minimises the live session instead of finishing or discarding it', () => {
    expect(d({ pathname: '/entreno/sesion/s1' })).toBe('minimiseSession')
    expect(d({ pathname: '/entreno/sesion/s1/', canGoBack: false })).toBe('minimiseSession')
  })
  it('goes back in the app history when there is one', () => {
    expect(d({})).toBe('historyBack')
    expect(d({ pathname: '/entreno', canGoBack: true })).toBe('historyBack')
  })
  it('sends the app to the background on a root tab without history, never exits', () => {
    for (const p of ['/', '/comida', '/entreno', '/salud', '/entreno/']) expect(d({ pathname: p, canGoBack: false })).toBe('minimizeApp')
  })
  it('a deep screen reached without history goes to Hoy', () => {
    expect(d({ pathname: '/comida/buscar', canGoBack: false })).toBe('goHome')
    expect(d({ pathname: '/entreno/rutinas', canGoBack: false })).toBe('goHome')
  })
  it('classifies routes', () => {
    expect(isSessionRoute('/entreno/sesion/x')).toBe(true)
    expect(isSessionRoute('/entreno/sesion')).toBe(false)
    expect(isSessionRoute('/entreno/rutinas/sesion/x')).toBe(false)
    expect(isRootTab('/mas')).toBe(false)
    expect(isRootTab('')).toBe(true)
  })
})

describe('leave guard registry', () => {
  it('keeps the latest guard and only the owner can unregister it', () => {
    const g1 = { confirmLeave: async () => true, fallback: '/a' }
    const g2 = { confirmLeave: async () => false, fallback: '/b' }
    const off1 = registerLeaveGuard(g1)
    const off2 = registerLeaveGuard(g2)
    off1()
    expect(activeLeaveGuard()).toBe(g2)
    off2()
    expect(activeLeaveGuard()).toBeNull()
  })
})
