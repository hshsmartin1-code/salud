export interface ToastData {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  /** Milliseconds before it goes away on its own. */
  duration: number
}

export interface ToastState {
  current: ToastData | null
  seq: number
}

export type ToastInput = Omit<ToastData, 'id' | 'duration'> & { duration?: number }

export type ToastAction = { type: 'show'; toast: ToastInput } | { type: 'dismiss'; id?: number }

export const DEFAULT_TOAST_MS = 5000
export const initialToastState: ToastState = { current: null, seq: 0 }

/** One toast at a time: a new one replaces the old; dismissing an old id never hides a newer toast. */
export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  if (action.type === 'show') {
    const seq = state.seq + 1
    const duration = action.toast.duration !== undefined && action.toast.duration > 0 ? action.toast.duration : DEFAULT_TOAST_MS
    return { seq, current: { ...action.toast, id: seq, duration } }
  }
  if (!state.current) return state
  if (action.id !== undefined && action.id !== state.current.id) return state
  return { ...state, current: null }
}

/** Time left on a toast whose countdown has run for `elapsed` ms in total. */
export function remainingMs(duration: number, elapsed: number): number {
  return Math.max(0, duration - Math.max(0, elapsed))
}
