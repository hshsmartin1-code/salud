import { useCallback } from 'react'
import { useToast } from '../../../ui/Toast'

export const SAVE_FAILED = 'No se pudo guardar. Inténtalo de nuevo.'

/**
 * Direct writes of the session screens (set completion, applying values, menus, sheets) never fail
 * silently: a rejected write shows "No se pudo guardar. Inténtalo de nuevo." and resolves to undefined.
 * Only the error type is logged, never values (health data).
 */
export function useSaveGuard(): <T>(p: Promise<T>) => Promise<T | undefined> {
  const toast = useToast()
  return useCallback(
    <T,>(p: Promise<T>) =>
      p.catch((e: unknown) => {
        console.warn('No se pudo guardar un cambio de la sesión', e instanceof Error ? e.name : 'error')
        toast.show({ message: SAVE_FAILED })
        return undefined
      }),
    [toast],
  )
}
