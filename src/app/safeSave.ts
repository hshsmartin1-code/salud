import { useCallback } from 'react'
import { useToast } from '../ui/Toast'

export const SAVE_FAILED = 'No se pudo guardar. Inténtalo de nuevo.'

/**
 * Runs a write and reports whether it resolved. A rejected write (quota full, closed database, a
 * failed transaction) calls `onError` with the standard message instead of failing silently, so the
 * caller keeps its form open with the values and fires its success toast only on `true`.
 */
export async function trySave(write: () => Promise<unknown>, onError: (message: string) => void): Promise<boolean> {
  try {
    await write()
    return true
  } catch (e) {
    console.warn('save failed', e)
    onError(SAVE_FAILED)
    return false
  }
}

/** `const save = useSafeSave(); if (await save(() => db.x.put(row))) { …success… }` */
export function useSafeSave(): (write: () => Promise<unknown>) => Promise<boolean> {
  const toast = useToast()
  return useCallback((write) => trySave(write, (message) => toast.show({ message })), [toast])
}

/** Marker returned by `tryWrite` when the write was rejected. */
export const SAVE_FAILED_RESULT: unique symbol = Symbol('save-failed')

/** Like `trySave`, but returns the write's value (e.g. an Undo) or SAVE_FAILED_RESULT. */
export async function tryWrite<T>(write: () => Promise<T>, onError: (message: string) => void): Promise<T | typeof SAVE_FAILED_RESULT> {
  let value: T | typeof SAVE_FAILED_RESULT = SAVE_FAILED_RESULT
  await trySave(async () => {
    value = await write()
  }, onError)
  return value
}

/** `const write = useSafeWrite(); const undo = await write(() => addWater(r, 250)); if (undo === SAVE_FAILED_RESULT) return` */
export function useSafeWrite(): <T>(write: () => Promise<T>) => Promise<T | typeof SAVE_FAILED_RESULT> {
  const toast = useToast()
  return useCallback(<T,>(write: () => Promise<T>) => tryWrite(write, (message) => toast.show({ message })), [toast])
}
