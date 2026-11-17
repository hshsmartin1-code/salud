import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Account } from '../../sync/link'
import { getLive, subscribeLive } from '../../sync/service'
import type { LiveSyncState } from '../../sync/status'

/** Session of one profile's Firebase instance: undefined while loading, null when signed out. */
export function useAccount(profileId: string): { account: Account | null | undefined; error: string | null } {
  const [state, setState] = useState<{ pid: string; account: Account | null | undefined; error: string | null }>({ pid: profileId, account: undefined, error: null })
  useEffect(() => {
    let unsub: (() => void) | undefined
    let alive = true
    void import('../../sync/auth')
      .then(({ onAccountChange }) => onAccountChange(profileId, (account) => alive && setState({ pid: profileId, account, error: null })))
      .then((u) => {
        if (alive) unsub = u
        else u()
      })
      .catch(() => alive && setState({ pid: profileId, account: null, error: 'No se pudo cargar Firebase. Revisa la conexión.' }))
    return () => {
      alive = false
      unsub?.()
    }
  }, [profileId])
  return state.pid === profileId ? { account: state.account, error: state.error } : { account: undefined, error: null }
}

export function useSyncLive(profileId: string): LiveSyncState {
  return useSyncExternalStore(subscribeLive, () => getLive(profileId))
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
  )
}
