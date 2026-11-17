import { useEffect, useRef, type ReactNode } from 'react'
import { ConfirmProvider } from './Confirm'
import { describeError, GLOBAL_ERROR_TOAST, makeThrottle } from './globalErrors'
import { ToastProvider, useToast } from './Toast'
import { NativeBackBridge } from '../app/NativeBackBridge'

/** Mount once at the app root: gives every screen `useConfirm()` and `useToast()`. */
export function UiProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <GlobalErrorReporter />
      <NativeBackBridge />
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}

/**
 * Mount inside the profile scope. A toast (and its "Deshacer" closure) belongs to the profile that
 * produced it, so every visible toast is dismissed, without running its action, when the profile changes.
 */
export function ToastProfileGuard({ profileId }: { profileId: string | undefined }) {
  const { dismiss } = useToast()
  const last = useRef(profileId)
  useEffect(() => {
    if (last.current !== profileId) dismiss()
    last.current = profileId
  }, [profileId, dismiss])
  return null
}

/** Benign browser noise that is not a failed action. */
const IGNORED = [/ResizeObserver loop/i, /^Script error.?$/i]

/**
 * Last-resort handler for rejected promises and uncaught errors nobody handled: one non-blocking toast
 * at most every 10 s, and only the error name/message in the console (never rows or health data).
 */
function GlobalErrorReporter() {
  const { show } = useToast()
  useEffect(() => {
    const allow = makeThrottle()
    const report = (reason: unknown) => {
      const text = describeError(reason)
      if (IGNORED.some((re) => re.test(reason instanceof Error ? reason.message : text))) return
      console.warn('[sin manejar]', text)
      if (allow()) show({ message: GLOBAL_ERROR_TOAST })
    }
    const onRejection = (e: PromiseRejectionEvent) => report(e.reason)
    const onError = (e: ErrorEvent) => report(e.error ?? new Error(e.message))
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [show])
  return null
}
