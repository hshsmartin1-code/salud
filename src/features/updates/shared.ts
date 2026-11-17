import { createAppUpdateService } from './index'
import type { UpdateService } from './service'

let shared: UpdateService | undefined

/** The one update service of the app, created on first use (never at import time, never touching the network). */
export function appUpdates(): UpdateService {
  shared ??= createAppUpdateService()
  return shared
}

/** True inside the Android shell; the browser/PWA keeps its own service-worker prompt. */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}
