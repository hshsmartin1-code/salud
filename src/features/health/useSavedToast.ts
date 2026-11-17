import { useCallback } from 'react'
import { useRepo } from '../../app/profile'
import { useToast } from '../../ui/Toast'
import { undoWrite, type Undo } from './writers'

/**
 * "Guardado" toast for a record just written. With an {@link Undo} it offers "Deshacer" for 5 s, which
 * removes exactly the rows that were written (never anything else).
 */
export function useSavedToast() {
  const toast = useToast()
  const r = useRepo()
  return useCallback(
    (message: string, undo: Undo | null) => {
      toast.show({ message, ...(undo ? { actionLabel: 'Deshacer', onAction: () => void undoWrite(r, undo) } : {}) })
    },
    [toast, r],
  )
}
