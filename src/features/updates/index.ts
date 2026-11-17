import { APP_VERSION } from '../../db/backup'
import { SCHEMA_VERSION } from '../../db/schema'
import { OTA_BUILD } from '../../ota/config'
import { createCapgoInstaller, nativeAppInfo } from '../../ota/installer.capgo'
import { createUpdateService } from './service'

export { createUpdateService, OTA_STORAGE_KEY, type UpdateService, type VersionInfo } from './service'
export { UPDATE_REASONS, type UpdateState } from './state'

/** Create one instance per app lifetime, outside React render. Does not check or fetch automatically. */
export function createAppUpdateService() {
  const native = typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  return createUpdateService({ config: OTA_BUILD, platform: native ? 'native' : 'web', builtInVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION, installer: createCapgoInstaller(OTA_BUILD), storage: localStorage, appInfo: nativeAppInfo })
}
