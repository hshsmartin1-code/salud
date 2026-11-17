import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  initialToastState,
  remainingMs,
  toastReducer,
  type ToastData,
  type ToastInput,
} from './toastLogic'

export type ToastOptions = ToastInput

interface ToastApi {
  show: (toast: ToastOptions) => void
  dismiss: () => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** `show({ message, actionLabel?, onAction?, duration? })`. One toast at a time; 5000 ms by default. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs <ToastProvider> (mounted by <UiProviders> at the app root)')
  return api
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, initialToastState)
  const show = useCallback((toast: ToastOptions) => dispatch({ type: 'show', toast }), [])
  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), [])
  const done = useCallback((id: number) => dispatch({ type: 'dismiss', id }), [])
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])
  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The live region exists before any toast so screen readers announce the first one too. */}
      <div className="toast-host" role="status" aria-live="polite" aria-atomic="true">
        {state.current ? <ToastView key={state.current.id} toast={state.current} onDone={done} /> : null}
      </div>
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onDone }: { toast: ToastData; onDone: (id: number) => void }) {
  // Countdown that pauses while the toast is hovered or holds focus.
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const paused = hover || focus
  const elapsed = useRef(0)
  const startedAt = useRef<number | null>(null)
  useEffect(() => {
    if (paused) return
    startedAt.current = Date.now()
    const left = remainingMs(toast.duration, elapsed.current)
    const t = window.setTimeout(() => onDone(toast.id), left)
    return () => {
      window.clearTimeout(t)
      if (startedAt.current !== null) elapsed.current += Date.now() - startedAt.current
      startedAt.current = null
    }
  }, [paused, toast.id, toast.duration, onDone])

  return (
    <div
      className="anim-toast pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-pop"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false)
      }}
    >
      <p className="min-w-0 flex-1 py-1.5 text-body text-ink">{toast.message}</p>
      {toast.actionLabel ? (
        <button
          type="button"
          className="btn-ghost shrink-0 px-3 font-semibold text-accent hover:text-accent"
          onClick={() => {
            toast.onAction?.()
            onDone(toast.id)
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
    </div>
  )
}
