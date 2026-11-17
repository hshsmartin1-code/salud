/**
 * What the Android hardware Back button does. A pure function of the current state so it is unit-tested
 * without Capacitor or React; `nativeBack.ts` executes the returned action.
 *
 * Priority: 1) close the topmost open overlay, 2) unsaved-changes guard (same confirmation as the in-app
 * back), 3) live session in focus mode: minimise it, 4) go back in the app's own history, 5) on a root
 * tab: send the app to the background (never exit), 6) anywhere else without history: go to Hoy.
 */
export type BackAction = 'closeOverlay' | 'confirmLeave' | 'minimiseSession' | 'historyBack' | 'minimizeApp' | 'goHome'

export interface BackState {
  /** Number of overlays registered in the dismiss stack. */
  overlays: number
  /** A screen with unsaved changes registered a leave guard. */
  hasLeaveGuard: boolean
  /** Router pathname, without the hash. */
  pathname: string
  /** The app's history has an earlier entry (react-router's history.state.idx > 0). */
  canGoBack: boolean
}

export const ROOT_TABS: readonly string[] = ['/', '/comida', '/entreno', '/salud']

export const isSessionRoute = (pathname: string): boolean => /^\/entreno\/sesion\/[^/]+\/?$/.test(pathname)

export function isRootTab(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return ROOT_TABS.includes(p || '/')
}

export function decideBack(s: BackState): BackAction {
  if (s.overlays > 0) return 'closeOverlay'
  if (s.hasLeaveGuard) return 'confirmLeave'
  if (isSessionRoute(s.pathname)) return 'minimiseSession'
  if (s.canGoBack) return 'historyBack'
  if (isRootTab(s.pathname)) return 'minimizeApp'
  return 'goHome'
}
