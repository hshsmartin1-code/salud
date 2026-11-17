import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * Standard list row: 52 px (48 px dense), leading slot, title with optional subtitle, trailing slot.
 * Interactive when `to` (link) or `onClick` (button) is given, and then shows a chevron unless
 * `trailing` is provided. Stack rows with `divide-rows`.
 */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  to,
  onClick,
  dense = false,
  disabled = false,
  ariaLabel,
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  to?: string
  onClick?: () => void
  dense?: boolean
  disabled?: boolean
  /** Accessible name when the visible text alone is not enough (e.g. includes the metric name). */
  ariaLabel?: string
}) {
  const interactive = !!to || !!onClick
  const inner = (
    <>
      {leading ? <span className="flex shrink-0 items-center justify-center text-muted">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        {subtitle ? <span className="line-clamp-2 block text-label text-muted">{subtitle}</span> : null}
      </span>
      {trailing !== undefined && trailing !== null ? (
        <span className="num flex shrink-0 items-center gap-2 text-body text-ink">{trailing}</span>
      ) : interactive ? (
        <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
      ) : null}
    </>
  )
  const cls = `flex w-full items-center gap-3 py-2 text-left ${dense ? 'min-h-[48px]' : 'min-h-[52px]'} ${
    // Flat: no border, radius or surface of its own. The hover/pressed tint is a pseudo-element that
    // bleeds 8 px sideways, so the hairline between rows (divide-rows) stays straight.
    interactive
      ? 'relative isolate before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:transition-colors before:duration-state hover:before:bg-surface2/50 active:before:bg-surface2 focus-visible:outline-offset-4'
      : ''
  } ${disabled ? 'pointer-events-none opacity-50' : ''}`
  if (to && !disabled)
    return (
      <Link to={to} className={cls} aria-label={ariaLabel}>
        {inner}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls} aria-label={ariaLabel}>
        {inner}
      </button>
    )
  return <div className={cls}>{inner}</div>
}
