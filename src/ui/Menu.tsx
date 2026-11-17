import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { Sheet } from './kit'
import { popoverPosition } from './menuLogic'
import { rovingIndex } from './roving'
import { useDismissable } from './useDismissable'

export interface MenuItem {
  label: string
  icon?: IconName
  tone?: 'default' | 'danger'
  disabled?: boolean
  onSelect: () => void
}

/** True below the `sm` breakpoint (640 px), where menus open as a bottom action sheet. */
function useCompact(): boolean {
  const query = '(max-width: 639.98px)'
  const [compact, setCompact] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setCompact(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return compact
}

const ITEM =
  'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-body font-medium outline-none transition-colors duration-state focus-visible:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent hover:bg-surface2 disabled:pointer-events-none disabled:opacity-40'

/**
 * Action menu opened from a "⋯" button. role="menu"/"menuitem", Arrow keys, Home/End, Escape;
 * focus goes to the first item on open and back to the trigger on close. On phones (< 640 px) it is
 * a bottom action sheet; otherwise an anchored popover that stays inside the viewport.
 */
export function Menu({
  label,
  items,
  triggerIcon = 'dots',
  disabled = false,
}: {
  /** Accessible name of the trigger and title of the action sheet, e.g. "Más acciones de la sesión". */
  label: string
  items: readonly MenuItem[]
  triggerIcon?: IconName
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [focusLast, setFocusLast] = useState(false)
  const compact = useCompact()
  const menuId = useId()
  const triggerWrap = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const disabledFlags = items.map((i) => !!i.disabled)

  const triggerEl = () => triggerWrap.current?.querySelector<HTMLButtonElement>('button') ?? null
  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    setPos(null)
    if (returnFocus) window.setTimeout(() => triggerEl()?.focus(), 0)
  }, [])

  // The anchored popover (not the compact sheet, which registers itself) is dismissable by hardware Back.
  useDismissable(open && !compact, () => close(false))

  // Popover geometry (desktop only; the sheet positions itself).
  useLayoutEffect(() => {
    if (!open || compact) return
    const place = () => {
      const t = triggerEl()
      const p = popRef.current
      if (!t || !p) return
      setPos(
        popoverPosition(t.getBoundingClientRect(), { width: p.offsetWidth, height: p.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, compact, items.length])

  // Initial focus (popover; the sheet focuses its [data-autofocus] item itself).
  useEffect(() => {
    if (!open || compact) return
    const start = focusLast ? disabledFlags.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0).pop() : disabledFlags.findIndex((d) => !d)
    itemRefs.current[start ?? 0]?.focus()
  }, [open, compact])

  // Outside press closes the popover.
  useEffect(() => {
    if (!open || compact) return
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node
      if (popRef.current?.contains(n) || triggerWrap.current?.contains(n)) return
      close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, compact, close])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !compact) {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab' && !compact) {
      close(false)
      return
    }
    const from = itemRefs.current.findIndex((el) => el === document.activeElement)
    const next = rovingIndex({ key: e.key, index: from, count: items.length, orientation: 'vertical', disabled: disabledFlags })
    if (next === null) return
    e.preventDefault()
    itemRefs.current[next]?.focus()
  }

  const select = (item: MenuItem) => {
    if (item.disabled) return
    // Close first so focus is back on the trigger before the action runs (the action may move focus).
    close(!compact)
    window.setTimeout(item.onSelect, 0)
  }

  const firstEnabled = disabledFlags.findIndex((d) => !d)
  const list = (
    <div role="menu" aria-label={label} onKeyDown={onMenuKey} className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          ref={(el) => {
            itemRefs.current[i] = el
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          data-autofocus={i === firstEnabled ? '' : undefined}
          onClick={() => select(item)}
          className={`${ITEM} ${item.tone === 'danger' ? 'text-bad' : 'text-ink'}`}
        >
          {item.icon ? <Icon name={item.icon} size={20} className={item.tone === 'danger' ? 'text-bad' : 'text-muted'} /> : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <span ref={triggerWrap} className="inline-flex">
        <IconButton
          icon={triggerIcon}
          label={label}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open && !compact ? menuId : undefined}
          onClick={() => {
            setFocusLast(false)
            setOpen((o) => !o)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setFocusLast(e.key === 'ArrowUp')
              setOpen(true)
            }
          }}
        />
      </span>
      {compact ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={label}>
          <div className="pb-2">{list}</div>
        </Sheet>
      ) : open
        ? createPortal(
            <div
              ref={popRef}
              id={menuId}
              className="fixed z-[55] min-w-[220px] max-w-[min(320px,calc(100vw-16px))] rounded-2xl border border-line bg-surface p-1.5 shadow-pop"
              style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
            >
              {list}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
