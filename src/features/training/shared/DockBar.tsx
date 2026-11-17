import { useEffect, useRef, type ReactNode } from 'react'
import { observeDockInset } from '../../../ui/dockInset'
import { useKeyboardInset } from './useKeyboardInset'

/**
 * Action bar fixed to the bottom, above the app's bottom navigation (62 px) and the safe area. With the
 * keyboard open it rides on top of the keyboard, so the primary action never hides behind it. On desktop
 * (the navigation is a sidebar) it is a sticky bar at the foot of the page. Place it last in the page:
 * it renders its own spacer so no content ends up underneath.
 */
export function DockBar({ children, label }: { children: ReactNode; label: string }) {
  const kb = useKeyboardInset()
  const el = useRef<HTMLDivElement>(null)
  // Publish the bar's height so the toast host sits above it (summed into --dock-inset with the
  // "Sesión en curso" bar, see ui/dockInset.ts; removed on unmount).
  useEffect(() => {
    const node = el.current
    if (!node) return
    return observeDockInset('dock', node)
  }, [])
  // Above the bottom navigation, and above the "Sesión en curso" bar when a session is in progress.
  const bottom = kb > 0 ? `${kb}px` : 'calc(62px + env(safe-area-inset-bottom) + var(--session-bar-inset, 0px))'
  return (
    <>
      <div aria-hidden="true" className="h-12 lg:hidden" />
      <div
        ref={el}
        role="region"
        aria-label={label}
        data-testid="dock-bar"
        style={{ ['--dock-bottom' as string]: bottom }}
        className="fixed inset-x-0 bottom-[var(--dock-bottom)] z-30 border-t border-line bg-bg/90 backdrop-blur-xl lg:sticky lg:inset-x-auto lg:bottom-0 lg:mt-8 lg:bg-bg/90"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5 lg:max-w-none lg:px-0">{children}</div>
      </div>
    </>
  )
}
