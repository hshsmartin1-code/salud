/**
 * Last-resort reporting of errors nobody handled (rejected promises, uncaught exceptions).
 * Never logs health data: only the error's name and message reach the console, never the event,
 * the stack, the rejected value's other fields or any row.
 */
export const GLOBAL_ERROR_TOAST = 'Algo no se guardó o falló. Revisa tu último cambio.'
export const GLOBAL_ERROR_INTERVAL_MS = 10_000

/** Name and message only; anything that is not an Error is reported by its type. */
export function describeError(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`.slice(0, 300)
  if (reason && typeof reason === 'object' && 'name' in reason && typeof (reason as { name: unknown }).name === 'string') return String((reason as { name: string }).name).slice(0, 100)
  return `valor no Error (${reason === null ? 'null' : typeof reason})`
}

/** Toast at most once every `interval` ms. Returns a function that says whether to show one now. */
export function makeThrottle(interval = GLOBAL_ERROR_INTERVAL_MS, now: () => number = Date.now): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < interval) return false
    last = t
    return true
  }
}
