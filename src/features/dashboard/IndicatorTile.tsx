import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../ui/Icon'
import { Metric } from '../../ui/Metric'

/**
 * One indicator: domain icon and label, one read-out, one line of context (a `Delta` or a hint) and,
 * only when it is legible, a small visual. The whole tile links to the detail. `source` (where the
 * figure comes from, and its period) is the tooltip / description, so the visible text stays short.
 */
export function IndicatorTile({
  to,
  icon,
  label,
  colorVar,
  value,
  unit,
  delta,
  hint,
  source,
  testId,
  empty = false,
  children,
}: {
  to: string
  icon: IconName
  label: string
  colorVar: string
  value: ReactNode
  unit?: string
  delta?: ReactNode
  hint?: ReactNode
  source: string
  testId?: string
  /** No data yet: shows "Sin registros" and `hint` (how to log it) instead of a read-out. */
  empty?: boolean
  /** A small visual (36 px high). Omit when there is not enough data to read. */
  children?: ReactNode
}) {
  return (
    <Link to={to} title={source} data-testid={testId} className="tile flex min-h-[92px] min-w-0 flex-col !p-3.5 outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <Metric
        label={
          <span className="flex items-center gap-1.5">
            <span style={{ color: `rgb(var(--${colorVar}))` }} className="shrink-0">
              <Icon name={icon} size={16} strokeWidth={2.2} />
            </span>
            <span className="truncate">{label}</span>
          </span>
        }
        value={empty ? <span className="text-body font-medium tracking-normal text-muted">Sin registros</span> : value}
        unit={empty ? undefined : unit}
        delta={empty ? undefined : delta}
        hint={delta && !empty ? undefined : <span className="line-clamp-2">{hint}</span>}
      />
      {children ? <div className="mt-auto pt-3">{children}</div> : null}
    </Link>
  )
}
