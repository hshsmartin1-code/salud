import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { FoodLog, MealKey } from '../../db/types'
import { addDays } from '../../domain/dates'
import { useToast } from '../../ui/Toast'
import { logSnapshots, type LoggedBatch, type LogEntry } from './quickAdd'
import { SUGGESTION_WINDOW_DAYS } from './suggestions'

/** The profile's food logs from `days` before `date` up to `date` (live). Undefined while loading. */
export function useRecentLogs(date: string, days = SUGGESTION_WINDOW_DAYS): FoodLog[] | undefined {
  const r = useRepo()
  return useLiveQuery(() => r.range('foodLogs', addDays(date, -days), date), [r, date, days])
}

export interface QuickLogOptions {
  /** After rows were created (by a one-tap add, a repeat, or a quantity sheet). */
  onLogged?: (batch: LoggedBatch) => void
  /** After "Deshacer" removed them. */
  onUndone?: (batch: LoggedBatch) => void
}

/**
 * One-tap logging: an in-flight guard, an undo toast and a "done" set for optimistic hiding.
 * `run(key, ...)` ignores a second call with the same key while the first is still writing, and after it
 * succeeded until it is undone (or until `cooldownMs`), so a double tap can never log twice.
 */
export function useQuickLog({ onLogged, onUndone }: QuickLogOptions = {}) {
  const toast = useToast()
  const r = useRepo()
  const busy = useRef(new Set<string>())
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())

  const forget = useCallback((key: string) => {
    busy.current.delete(key)
    setDone((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  }, [])

  /** Shows "Deshacer" for rows that already exist. */
  const announce = useCallback(
    (key: string, batch: LoggedBatch, message: string) => {
      onLogged?.(batch)
      toast.show({
        message,
        actionLabel: 'Deshacer',
        onAction: () => {
          void batch.undo().then(() => {
            forget(key)
            onUndone?.(batch)
          }).catch((e: unknown) => toast.show({ message: e instanceof Error ? e.message : 'No se pudo deshacer.' }))
        },
      })
    },
    [toast, onLogged, onUndone, forget],
  )

  const run = useCallback(
    async (key: string, work: () => Promise<LoggedBatch>, message: (b: LoggedBatch) => string, cooldownMs?: number): Promise<boolean> => {
      if (busy.current.has(key)) return false
      busy.current.add(key)
      setDone((s) => new Set(s).add(key))
      try {
        const batch = await work()
        if (batch.ids.length === 0) {
          forget(key)
          toast.show({ message: 'No hay nada que agregar.' })
          return false
        }
        announce(key, batch, message(batch))
        if (cooldownMs !== undefined) window.setTimeout(() => forget(key), cooldownMs)
        return true
      } catch (e) {
        forget(key)
        toast.show({ message: e instanceof Error ? e.message : 'No se pudo agregar.' })
        return false
      }
    },
    [toast, announce, forget],
  )

  const add = useCallback(
    (key: string, entries: readonly LogEntry[], date: string, meal: MealKey, message: string, cooldownMs?: number) =>
      run(key, () => logSnapshots(r, entries, date, meal), () => message, cooldownMs),
    [r, run],
  )

  return { add, run, announce, done }
}
