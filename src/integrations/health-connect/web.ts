import type { HealthConnectPlugin, HcStatus } from './types'

const MSG = 'Health Connect solo está disponible en la app de Android.'
const no = (): Promise<never> => Promise.reject(Object.assign(new Error(MSG), { code: 'UNAVAILABLE' }))

/** Browser/PWA implementation: always "not available". */
export class HealthConnectWeb implements HealthConnectPlugin {
  getStatus(): Promise<HcStatus> {
    return Promise.resolve({ available: false, reason: 'web' })
  }
  openInstallOrUpdate = no
  openSettings = no
  getGrantedPermissions = no
  requestReadPermissions = no
  revokeAll = no
  readDailyAggregates = no
  readRecords = no
  getChangesToken = no
  getChanges = no
}
