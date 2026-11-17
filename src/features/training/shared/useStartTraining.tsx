import { useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRepo } from '../../../app/profile'
import type { Routine } from '../../../db/types'
import { useConfirm } from '../../../ui/Confirm'
import { getActiveSession, startSession } from '../session'

/**
 * Starts a session from a routine (or a free one). There is only ever one session in progress: if there
 * is one, the person is asked whether to continue it and nothing new is created.
 */
export function useStartTraining() {
  const r = useRepo()
  const nav = useNavigate()
  const confirm = useConfirm()
  const busy = useRef(false)
  return useCallback(
    async (routine?: Routine) => {
      if (busy.current) return
      busy.current = true
      try {
        const active = await getActiveSession(r)
        if (active) {
          const ok = await confirm({
            title: 'Ya hay un entrenamiento en curso',
            body: `«${active.name}» sigue abierto. Solo puede haber uno a la vez, así que no se crea otro.`,
            confirmLabel: 'Continuar entrenamiento',
            cancelLabel: 'Ahora no',
          })
          if (ok) nav(`/entreno/sesion/${active.id}`)
          return
        }
        const s = await startSession(r, { routine })
        nav(`/entreno/sesion/${s.id}`)
      } finally {
        busy.current = false
      }
    },
    [r, nav, confirm],
  )
}
