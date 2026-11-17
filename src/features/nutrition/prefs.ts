import { useCallback, useState } from 'react'

/** Device-only UI preferences of the nutrition module, kept per profile in localStorage (never synced). */
const keepAddingKey = (profileId: string) => `salud:nutrition:keepAdding:${profileId}`

export function readKeepAdding(profileId: string): boolean {
  try {
    return localStorage.getItem(keepAddingKey(profileId)) !== '0'
  } catch {
    return true
  }
}

export function writeKeepAdding(profileId: string, on: boolean): void {
  try {
    localStorage.setItem(keepAddingKey(profileId), on ? '1' : '0')
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
}

/** "Seguir agregando": on by default, remembered per profile on this device. */
export function useKeepAdding(profileId: string): [boolean, (on: boolean) => void] {
  const [state, setState] = useState(() => ({ profileId, on: readKeepAdding(profileId) }))
  const on = state.profileId === profileId ? state.on : readKeepAdding(profileId)
  const set = useCallback(
    (next: boolean) => {
      writeKeepAdding(profileId, next)
      setState({ profileId, on: next })
    },
    [profileId],
  )
  return [on, set]
}

const ideasHiddenKey = (profileId: string, date: string) => `salud:nutrition:ideasHidden:${profileId}:${date}`

/** "Ocultar por hoy": the ideas section hidden for one diary date, remembered on this device (never synced). */
export function useIdeasHidden(profileId: string, date: string): [boolean, (hidden: boolean) => void] {
  const read = () => {
    try {
      return localStorage.getItem(ideasHiddenKey(profileId, date)) === '1'
    } catch {
      return false
    }
  }
  const [state, setState] = useState(() => ({ k: `${profileId}:${date}`, v: read() }))
  const k = `${profileId}:${date}`
  const hidden = state.k === k ? state.v : read()
  const set = useCallback(
    (next: boolean) => {
      try {
        if (next) localStorage.setItem(ideasHiddenKey(profileId, date), '1')
        else localStorage.removeItem(ideasHiddenKey(profileId, date))
      } catch {
        /* blocked storage: the choice then lasts for this visit only */
      }
      setState({ k: `${profileId}:${date}`, v: next })
    },
    [profileId, date],
  )
  return [hidden, set]
}
