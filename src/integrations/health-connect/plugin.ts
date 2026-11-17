import { registerPlugin } from '@capacitor/core'
import type { HealthConnectPlugin } from './types'

/** Native plugin `HealthConnect` (android/app/.../healthconnect). On the web it resolves to the "unavailable" stub. */
export const HealthConnect = registerPlugin<HealthConnectPlugin>('HealthConnect', {
  web: () => import('./web').then((m) => new m.HealthConnectWeb()),
})
