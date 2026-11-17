import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Delta } from '../Delta'
import { Skeleton } from '../Skeleton'
import { ChartPanelContext, type PanelCtx } from './panelContext'
import { panelValueText, shortDate } from './geometry'
import type { Readout } from './types'

export interface ChartPanelProps {
  title: string
  /** Heading level of the title. h2 by default (page-level panel); pass h3 inside a section that already has an h2. */
  headingLevel?: 'h2' | 'h3'
  /** Detail route. Non-compact: the title is a link. Compact: the whole panel is one link. */
  to?: string
  /** Latest value shown while nothing is selected (already formatted, es-CO). */
  value: string | number | null
  unit: string
  /** Change against the previous period (rendered with the kit's `Delta`). */
  delta?: { value: number; unit?: string; period?: string; goodWhen?: 'up' | 'down' }
  /** e.g. "Últimos 30 días". */
  period: string
  /** e.g. "26 de 30 días con dato". */
  coverage?: string
  note?: string
  size?: 'default' | 'compact'
  children: ReactNode
  /** Table alternative (e.g. `<ChartTable/>`). The panel owns the "Ver tabla" button, top right. */
  table?: ReactNode
  /** Number of points with data in the period. Fewer than 2 shows a message (and `action`) instead of the plot. */
  pointCount?: number
  /** Optional call to action for the empty state (e.g. a "Registrar" button). Never shown in compact panels. */
  action?: ReactNode
  /** Renders a skeleton instead of the content. */
  loading?: boolean
  /** Compact control in the header row, right-aligned before "Ver tabla" (e.g. a period selector). Not shown in compact panels. */
  headerAction?: ReactNode
}

/**
 * Panel = title + big read-out + chart + coverage. The panel owns the selection: the chart inside reports
 * the touched point through context and the header swaps "latest value" for that point's value and date.
 * Text never takes the series colour (values in ink, context in muted).
 */
export function ChartPanel({ title, headingLevel = 'h2', to, value, unit, delta, period, coverage, note, size = 'default', children, table, pointCount, action, loading, headerAction }: ChartPanelProps) {
  const compact = size === 'compact'
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [showTable, setShowTable] = useState(false)
  const empty = pointCount !== undefined && pointCount < 2

  const select = useCallback((date: string | null, r: Readout | null) => {
    setSelectedDate(date)
    setReadout(r)
  }, [])
  const ctx = useMemo<PanelCtx>(() => ({ selectedDate, select, compact, externalTable: !!table && !compact }), [selectedDate, select, compact, table])

  const shown = readout ? readout.value : panelValueText(value)
  const shownUnit = readout ? readout.unit : unit
  const sub = readout ? shortDate(readout.date) : period
  const deltaEl = !readout && delta ? <Delta {...delta} /> : null

  if (compact) {
    const body = loading ? (
      <>
        <div className="text-label font-medium text-muted">{title}</div>
        <div className="mt-2">
          <Skeleton height={22} label={`Cargando ${title}`} />
        </div>
        <div className="min-h-[18px]" />
        <div className="mt-2">
          <Skeleton height={56} label="" />
        </div>
      </>
    ) : (
      <>
        <div className="truncate text-label font-medium text-muted">{title}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="readout text-readout text-ink">
            {shown}
          </span>
          <span className="truncate text-label text-muted">{shownUnit}</span>
        </div>
        <div className="min-h-[18px] truncate">{deltaEl}</div>
        <div className="mt-2">
          <ChartPanelContext.Provider value={ctx}>{children}</ChartPanelContext.Provider>
        </div>
      </>
    )
    const cls = 'block min-w-0 rounded-2xl border border-line bg-surface p-3'
    return to && !loading ? (
      <Link to={to} className={`${cls} outline-none transition-colors duration-state focus-visible:ring-2 focus-visible:ring-accent active:bg-surface2`} data-testid="chart-panel">
        {body}
      </Link>
    ) : (
      <section className={cls} aria-label={title} data-testid="chart-panel">
        {body}
      </section>
    )
  }

  const Heading = headingLevel
  const titleEl = to ? (
    <Link to={to} className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg text-label font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">
      {title}
    </Link>
  ) : (
    <Heading className="text-label font-medium text-muted">{title}</Heading>
  )

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={title} data-testid="chart-panel" aria-busy={loading || undefined}>
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        {titleEl}
        <div className="flex shrink-0 items-center gap-1">
        {headerAction}
        {table && !loading && !empty ? (
          <button
            type="button"
            className="-mr-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-label text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Ver gráfica' : 'Ver tabla'}
          </button>
        ) : null}
        </div>
      </div>
      {loading ? (
        <div className="space-y-3" data-testid="chart-loading">
          <Skeleton height={28} label={`Cargando ${title}`} />
          <Skeleton height={176} label="" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="readout text-readout text-ink" data-testid="panel-value">
              {shown}
            </span>
            <span className="text-label text-muted">{shownUnit}</span>
            {deltaEl ? <span className="ml-1">{deltaEl}</span> : null}
          </div>
          <div className="mb-2 text-label text-muted" data-testid="panel-sub">
            {sub}
          </div>
          {empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-surface2/40 px-4 py-8 text-center" data-testid="panel-empty">
              <p className="text-label text-muted">Aún no hay datos suficientes en este periodo</p>
              {action}
            </div>
          ) : (
            <ChartPanelContext.Provider value={ctx}>{table && showTable ? table : children}</ChartPanelContext.Provider>
          )}
          {coverage || note ? <div className="mt-1 text-micro text-muted">{[coverage, note].filter(Boolean).join(' · ')}</div> : null}
        </>
      )}
    </section>
  )
}
