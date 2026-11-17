/**
 * Android hardware Back button (Capacitor App plugin). Native only; on the web nothing is registered.
 * Registered once at app start by `<NativeBackBridge />` (mounted in UiProviders). The decision itself is
 * the pure `decideBack`; this module only gathers the state and executes the chosen action.
 */
import { Capacitor } from '@capacitor/core'
import { dismissStack } from '../ui/dismissStack'
import { activeLeaveGuard } from './leaveGuardRegistry'
import { decideBack, type BackAction } from './nativeBackLogic'

/** Router actions the executor needs; supplied by the bridge component (react-router hooks). */
export interface BackRouter {
  pathname: () => string
  /** react-router's location.key: 'default' for the first entry of the session. */
  locationKey: () => string
  navigate: (to: string | number, opts?: { replace?: boolean }) => void
}

export interface BackEnv {
  isNative: () => boolean
  canGoBack: () => boolean
  historyBack: () => void
  minimizeApp: () => Promise<void>
}

export const defaultBackEnv: BackEnv = {
  isNative: () => {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  },
  // react-router stores the position of the entry in history.state.idx (0 = first entry of this load).
  canGoBack: () => ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0,
  historyBack: () => window.history.back(),
  minimizeApp: async () => {
    const { App } = await import('@capacitor/app')
    await App.minimizeApp()
  },
}

/** Runs one Back press. Never throws; never exits the app, finishes or discards anything. */
export async function handleBack(router: BackRouter, env: BackEnv = defaultBackEnv): Promise<BackAction> {
  const guard = activeLeaveGuard()
  const action = decideBack({ overlays: dismissStack.size(), hasLeaveGuard: !!guard, pathname: router.pathname(), canGoBack: env.canGoBack() })
  try {
    switch (action) {
      case 'closeOverlay':
        dismissStack.top()?.close()
        break
      case 'confirmLeave':
        if (guard && (await guard.confirmLeave())) {
          if (env.canGoBack()) env.historyBack()
          else router.navigate(guard.fallback, { replace: true })
        }
        break
      case 'minimiseSession':
        // Same as the session's own "Minimizar sesión" button.
        if (router.locationKey() !== 'default') router.navigate(-1)
        else router.navigate('/entreno')
        break
      case 'historyBack':
        env.historyBack()
        break
      case 'minimizeApp':
        await env.minimizeApp()
        break
      case 'goHome':
        router.navigate('/', { replace: true })
        break
    }
  } catch {
    /* Back must never break the app */
  }
  return action
}

/** Registers the hardware Back listener once. Returns a function that removes it. No-op off Android. */
export function registerNativeBack(router: BackRouter, env: BackEnv = defaultBackEnv): () => void {
  if (!env.isNative()) return () => undefined
  let handle: { remove: () => Promise<void> } | null = null
  let cancelled = false
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('backButton', () => void handleBack(router, env)))
    .then((h) => {
      if (cancelled) void h.remove()
      else handle = h
    })
    .catch(() => undefined)
  return () => {
    cancelled = true
    void handle?.remove()
  }
}
