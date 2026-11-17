import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Sheet } from './kit'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel: string
  /** Label of the safe action. Default "Cancelar". */
  cancelLabel?: string
  /** 'danger' paints the confirm button in the error colour. */
  tone?: 'default' | 'danger'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Promise-based confirmation: `if (await confirm({ title, confirmLabel })) …`.
 * Renders as a Sheet; the safe action (cancel) has initial focus; Escape, the close button and the
 * backdrop all resolve `false`. Calling it again while one is open resolves the first with `false`.
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm needs <ConfirmProvider> (mounted by <UiProviders> at the app root)')
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)
  const pending = useRef<((v: boolean) => void) | null>(null)

  const settle = useCallback((v: boolean) => {
    pending.current?.(v)
    pending.current = null
    setState(null)
  }, [])

  const confirm = useCallback<ConfirmFn>((options) => {
    pending.current?.(false)
    return new Promise<boolean>((resolve) => {
      pending.current = resolve
      setState({ options, resolve })
    })
  }, [])

  // A provider that unmounts must not leave a caller waiting forever.
  useEffect(
    () => () => {
      pending.current?.(false)
      pending.current = null
    },
    [],
  )

  const value = useMemo(() => confirm, [confirm])
  const o = state?.options
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Sheet
        open={!!state}
        onClose={() => settle(false)}
        title={o?.title}
        footer={
          o ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" data-autofocus className="btn-secondary sm:min-w-[120px]" onClick={() => settle(false)}>
                {o.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                type="button"
                className={`btn sm:min-w-[120px] ${o.tone === 'danger' ? 'bg-bad text-ink-contrast hover:brightness-110' : 'btn-primary'}`}
                onClick={() => settle(true)}
              >
                {o.confirmLabel}
              </button>
            </div>
          ) : undefined
        }
      >
        {o?.body ? <div className="pb-2 text-body text-muted">{o.body}</div> : <div className="pb-1" />}
      </Sheet>
    </ConfirmContext.Provider>
  )
}
