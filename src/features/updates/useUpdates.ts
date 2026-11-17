import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { OTA_BUILD } from '../../ota/config'
import { nativeAppInfo } from '../../ota/installer.capgo'
import type { UpdateService, VersionInfo } from './service'
import { appUpdates, isNativeShell } from './shared'

export interface UpdateDetails { bundleId: string | null; channel: string; manifestHost: string; keyIds: string[] }

/** Subscribes to the update service and loads the installed versions once. Nothing here touches the network. */
export function useUpdates(service?: UpdateService) {
  const [svc] = useState(() => service ?? appUpdates())
  const state = useSyncExternalStore(svc.subscribe, svc.getState)
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [installedNotes, setInstalledNotes] = useState('')
  const [bundleId, setBundleId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    svc.currentVersion().then((v) => { if (live) { setVersion(v); setInstalledNotes(svc.installedNotes()) } }).catch(() => { if (live) setFailed(true) })
    if (isNativeShell()) nativeAppInfo().then((i) => { if (live) setBundleId((i as { id?: string }).id ?? null) }).catch(() => undefined)
    return () => { live = false }
  }, [svc])
  const check = useCallback(() => { void svc.check() }, [svc])
  const download = useCallback(() => { void svc.download() }, [svc])
  const apply = useCallback(() => { void svc.apply() }, [svc])
  let manifestHost = ''
  try { manifestHost = OTA_BUILD.manifestUrl ? new URL(OTA_BUILD.manifestUrl).host : '' } catch { manifestHost = '' }
  const details: UpdateDetails = { bundleId, channel: OTA_BUILD.channel, manifestHost, keyIds: Object.keys(OTA_BUILD.publicKeys) }
  return { state, version, versionFailed: failed, installedNotes, details, check, download, apply }
}
