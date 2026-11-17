import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { rovingIndex, tabStopIndex } from './roving'
import { useDismissable } from './useDismissable'

/** Bottom sheet on mobile, centered dialog on ≥sm. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useDismissable(open, onClose)
  useEffect(() => {
    if (!open || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => {
      const next = { top: vv.offsetTop, height: vv.height }
      setViewport((prev) => prev?.top === next.top && prev.height === next.height ? prev : next)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const isTop = () => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      return dialogs[dialogs.length - 1] === ref.current
    }
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]') ?? [])]
      .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0)
    const onKey = (e: KeyboardEvent) => {
      if (!isTop() || e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = focusable()
        const first = items[0]
        const last = items[items.length - 1]
        if (!first) {
          e.preventDefault()
          ref.current?.focus()
        } else if (!ref.current?.contains(document.activeElement) || document.activeElement === ref.current ||
          (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first)?.focus()
        }
      }
    }
    const onFocus = (e: FocusEvent) => {
      if (!isTop()) return
      if (!ref.current?.contains(e.target as Node)) (focusable()[0] ?? ref.current)?.focus()
      else if (e.target instanceof HTMLElement && e.target.matches('input, select, textarea')) {
        // A keyboard can shrink the visual viewport after focus; keep the field in the sheet's scroll area.
        const field = e.target
        window.setTimeout(() => { if (field.isConnected) field.scrollIntoView({ block: 'nearest' }) }, 100)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
      el?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      document.body.style.overflow = prev
      window.clearTimeout(t)
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-x-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      style={{ top: viewport?.top ?? 0, height: viewport?.height ?? '100dvh' }}
    >
      <div className="anim-fade absolute inset-0 bg-[rgb(8_12_16/0.5)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`anim-sheet relative flex max-h-[92%] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong/70 sm:hidden" />
        {title ? (
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
            <h2 id={titleId} className="text-[19px] font-semibold tracking-tight">
              {title}
            </h2>
            <IconButton icon="x" label="Cerrar" onClick={onClose} className="-mr-2" />
          </div>
        ) : null}
        <div className="sheet-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-line px-5 py-3 pb-safe">{footer}</div> : <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-1">
        {back ? (
          <Link to={back} className="btn-ghost -ml-3 mt-0.5 p-2" aria-label="Volver">
            <Icon name="chevronLeft" />
          </Link>
        ) : null}
        <div className="min-w-0">
          <h1 className="title-wide text-balance break-words text-[24px] font-bold leading-[1.15] sm:text-[26px]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

/** @deprecated use Metric */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  hint?: ReactNode
  tone?: 'good' | 'warn' | 'bad' | 'accent'
}) {
  const toneCls =
    tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : ''
  return (
    <div className="min-w-0">
      <div className="truncate text-label font-medium text-muted">{label}</div>
      <div className={`readout mt-1.5 truncate text-[28px] ${toneCls}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-medium tracking-normal text-muted [font-stretch:100%]">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 truncate text-xs text-faint">{hint}</div> : null}
    </div>
  )
}

export function EmptyState({
  icon = 'info',
  title,
  children,
  action,
}: {
  icon?: IconName
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start rounded-2xl border border-line bg-surface px-5 py-6 sm:items-center sm:px-6 sm:py-9 sm:text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-muted">
        <Icon name={icon} size={20} />
      </div>
      <div className="font-semibold">{title}</div>
      {children ? <div className="mt-1 max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * Single choice among a few options (role="radiogroup"). Roving tabindex: only the selected option
 * is in the Tab order; arrow keys, Home and End move and select. Each option has a 44 px hit area.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: ReactNode }[]
  size?: 'sm' | 'md'
  ariaLabel?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)
  const stop = tabStopIndex(selected, options.length)
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((el) => el === document.activeElement)
    const next = rovingIndex({ key: e.key, index: from < 0 ? stop : from, count: options.length })
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(options[next]!.value)
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown} className="inline-flex w-full rounded-xl bg-surface2 p-[3px]">
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === stop ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={`hit-44 min-w-[44px] flex-1 whitespace-nowrap rounded-lg font-medium transition-colors duration-state ${
            size === 'sm' ? 'min-h-[30px] px-2 py-1 text-label' : 'min-h-[36px] px-3 py-1.5 text-sm'
          } ${value === o.value ? 'bg-surface text-ink shadow-lift ring-1 ring-line' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`hit-44 relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  )
}

/** @deprecated use Meter variant="bar" */
export function ProgressBar({
  value,
  max,
  colorVar = 'accent',
  height = 6,
}: {
  value: number | undefined
  max: number | undefined
  colorVar?: string
  height?: number
}) {
  const pct = value !== undefined && max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const over = value !== undefined && max ? value > max * 1.05 : false
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface2" style={{ height }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: over ? 'rgb(var(--warn))' : `rgb(var(--${colorVar}))` }}
      />
    </div>
  )
}

/** @deprecated use Row */
export function ListRow({
  icon,
  title,
  subtitle,
  right,
  to,
  onClick,
}: {
  icon?: IconName
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  to?: string
  onClick?: () => void
}) {
  const inner = (
    <>
      {icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface2 text-muted">
          <Icon name={icon} size={18} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      {right ?? (to || onClick ? <Icon name="chevronRight" size={18} className="text-faint" /> : null)}
    </>
  )
  const cls = 'flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface2/50'
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    )
  return <div className={cls}>{inner}</div>
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' | 'bad' | 'good' }) {
  const cls = {
    muted: 'bg-surface2 text-muted',
    accent: 'bg-accent/10 text-accent',
    warn: 'bg-warn/10 text-warn',
    bad: 'bg-bad/10 text-bad',
    good: 'bg-good/10 text-good',
  }[tone]
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-micro font-semibold ${cls}`}>{children}</span>
}

/**
 * Graduated progress readout (tape-measure ticks every 10 % of the target). The fill stops at the
 * target; anything above it is drawn as an overflow segment in the warning colour, never hidden.
 */
/** @deprecated use Meter variant="scale" */
export function ScaleBar({
  value,
  target,
  colorVar = 'ink',
  height = 10,
  label,
}: {
  value: number | undefined
  target: number | undefined
  colorVar?: string
  height?: number
  label?: string
}) {
  const has = value !== undefined && !!target && target > 0
  const ratio = has ? value! / target! : 0
  const pct = Math.min(100, Math.max(0, ratio * 100))
  const over = has && ratio > 1.05
  return (
    <div
      className="scale-track relative w-full overflow-hidden rounded-[3px]"
      style={{ height }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={target ?? 0}
      aria-valuenow={value ?? 0}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: over ? 'rgb(var(--warn))' : `rgb(var(--${colorVar}))` }}
      />
    </div>
  )
}
