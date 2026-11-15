import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

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
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
      el?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-[rgb(8_12_16/0.5)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`anim-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong/70 sm:hidden" />
        {title ? (
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
            <h2 id={titleId} className="text-[19px] font-semibold tracking-tight">
              {title}
            </h2>
            <button className="btn-ghost -mr-2 p-2" onClick={onClose} aria-label="Cerrar">
              <Icon name="x" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
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
      <div className="truncate text-[13px] font-medium text-muted">{label}</div>
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
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex w-full rounded-xl bg-surface2 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-lg font-medium transition-colors ${
            size === 'sm' ? 'min-h-[30px] px-2 py-1 text-xs' : 'min-h-[36px] px-3 py-1.5 text-sm'
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
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  )
}

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
        <span className="block truncate text-[15px] font-medium">{title}</span>
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
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

/**
 * Graduated progress readout (tape-measure ticks every 10 % of the target). The fill stops at the
 * target; anything above it is drawn as an overflow segment in the warning colour, never hidden.
 */
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
