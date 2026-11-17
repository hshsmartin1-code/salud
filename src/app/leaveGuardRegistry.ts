/**
 * The screen that currently warns before leaving (routine editor with unsaved changes) registers here so
 * the Android Back handler can run the very same confirmation. Only one guard is active at a time.
 */
export interface LeaveGuard {
  /** Shows the screen's own "¿Salir sin guardar?" confirmation; resolves true when leaving is confirmed. */
  confirmLeave: () => Promise<boolean>
  /** Where to go if there is no history to go back to (the screen's own back target). */
  fallback: string
}

let current: LeaveGuard | null = null

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  current = guard
  return () => {
    if (current === guard) current = null
  }
}

export const activeLeaveGuard = (): LeaveGuard | null => current
