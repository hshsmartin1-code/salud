import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerLeaveGuard } from '../../../app/leaveGuardRegistry'
import { useConfirm } from '../../../ui/Confirm'

/**
 * Asks before leaving with unsaved changes. The app uses a HashRouter (no route blockers), so this
 * intercepts clicks on in-app links (back arrow, bottom navigation, sidebar) while `dirty`, and asks the
 * browser to confirm when the tab itself is closed or reloaded. The browser's own Back button cannot be intercepted.
 * On Android the hardware Back button runs the same confirmation through the leave-guard registry
 * (`fallback` is where it goes when there is no history to go back to).
 */
export function useLeaveGuard(dirty: boolean, fallback = '/entreno') {
  const confirm = useConfirm()
  const nav = useNavigate()
  const asking = useRef(false)
  useEffect(() => {
    if (!dirty) return
    const ask = () =>
      confirm({
        title: '¿Salir sin guardar?',
        body: 'Los cambios de esta rutina se perderán.',
        confirmLabel: 'Salir sin guardar',
        cancelLabel: 'Seguir editando',
        tone: 'danger',
      })
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target instanceof Element ? e.target.closest('a[href]') : null) as HTMLAnchorElement | null
      const href = a?.getAttribute('href') ?? ''
      if (!a || a.target === '_blank' || !href.startsWith('#/')) return
      e.preventDefault()
      e.stopPropagation()
      if (asking.current) return
      asking.current = true
      void ask().then((ok) => {
        asking.current = false
        if (ok) nav(href.slice(1))
      })
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onUnload)
    const unregister = registerLeaveGuard({
      fallback,
      confirmLeave: async () => {
        if (asking.current) return false
        asking.current = true
        try {
          return await ask()
        } finally {
          asking.current = false
        }
      },
    })
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onUnload)
      unregister()
    }
  }, [dirty, confirm, nav, fallback])
}
