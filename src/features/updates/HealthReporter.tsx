import { useEffect, useRef } from 'react'
import { useProfiles } from '../../app/profile'
import { OTA_BUILD } from '../../ota/config'
import { createAutoChecker, startAutoChecks } from './autoCheck'
import { appUpdates, isNativeShell } from './shared'

/**
 * Tells the updater that THIS interface rendered and the database opened. Rendered once, inside ProfileProvider:
 * `profiles !== undefined` means Dexie opened and its first query answered, and two animation frames mean the
 * tree around it painted. It never waits for Firebase, sync or any network request. Only runs in the Android
 * shell; a bundle that never gets here is rolled back by the native plugin.
 *
 * Once the start is confirmed healthy (and only then), and OTA is enabled in this build, the automatic update check
 * starts: one silent attempt now and one every time the app returns to the foreground, at most every 6 hours (autoCheck.ts).
 */
export function HealthReporter() {
  const { profiles } = useProfiles()
  const reported = useRef(false)
  const ready = profiles !== undefined
  useEffect(() => {
    if (!ready || reported.current || !isNativeShell()) return
    reported.current = true
    let cancelled = false
    let stopChecks: (() => void) | null = null
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return
      const updates = appUpdates()
      updates.start().then(() => updates.reportHealthy({ rendered: true, databaseOpened: true })).then(() => {
        if (cancelled || !OTA_BUILD.enabled) return
        stopChecks = startAutoChecks(createAutoChecker({ service: updates, storage: { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }, now: Date.now, online: () => navigator.onLine !== false }))
      }).catch((error: unknown) => {
        console.warn('[updates] no se pudo confirmar el arranque', error)
      })
    }))
    return () => { cancelled = true; stopChecks?.(); cancelAnimationFrame(frame); reported.current = false }
  }, [ready])
  return null
}
