/**
 * Shared layout of the Salud detail pages: header with back and period, optional tabs, a primary action,
 * then content. `MetricBlock` is the standard content for one metric: interactive chart with goal line,
 * "Comparar con el periodo anterior", day/week/month grouping, the sentence from the series layer and a
 * summary strip (media, mínimo, máximo, cobertura).
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { formatMinutes } from '../../integrations/health-connect/format'
import { Disclosure } from '../../ui/Disclosure'
import { Metric } from '../../ui/Metric'
import { PageHeader, Segmented } from '../../ui/kit'
import { PeriodPicker } from '../../ui/PeriodPicker'
import { Skeleton } from '../../ui/Skeleton'
import { Tabs, tabPanelId, type TabItem } from '../../ui/Tabs'
import { ChartPanel } from '../../ui/charts/ChartPanel'
import { ChartTable } from '../../ui/charts/ChartTable'
import { TimeSeriesChart } from '../../ui/charts/TimeSeriesChart'
import { metricDef, type MetricId } from './metrics'
import { PERIOD_OPTIONS, comparisonLabel, periodTitle, rangeText, withPeriod, type ResolvedPeriod } from './period'
import type { BucketUnit, HealthInput, SeriesOptions } from './series'
import { buildView, chartSeries, defaultGroup, figure, groupLabel, sourceLabel, type MetricView } from './view'

// ───────────── Shell ─────────────
export function MetricDetail<T extends string>({
  title,
  subtitle,
  period,
  onPeriod,
  tabs,
  tab,
  onTab,
  tabsLabel,
  action,
  children,
  testId,
}: {
  title: ReactNode
  subtitle?: ReactNode
  period: ResolvedPeriod
  onPeriod: (v: string) => void
  tabs?: readonly TabItem<T>[]
  tab?: T
  onTab?: (v: T) => void
  tabsLabel?: string
  action?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const base = useId()
  return (
    <div data-testid={testId} className="space-y-4">
      <PageHeader title={title} subtitle={subtitle} back={withPeriod('/salud', period.value)} actions={action} />
      <div className="-mt-2">
        <PeriodPicker value={period.value} onChange={onPeriod} options={PERIOD_OPTIONS} allowCustom />
      </div>
      {tabs && tab !== undefined && onTab ? <Tabs value={tab} onChange={onTab} tabs={tabs} idBase={base} ariaLabel={tabsLabel ?? 'Secciones'} /> : null}
      <div role={tabs ? 'tabpanel' : undefined} id={tabs && tab !== undefined ? tabPanelId(base, tab) : undefined} aria-labelledby={tabs && tab !== undefined ? `${base}-tab-${tab}` : undefined} className="space-y-4">
        {children}
      </div>
    </div>
  )
}

// ───────────── Summary strip ─────────────
function plain(id: MetricId, v: number | null) {
  if (id === 'bloodPressure') return v === null ? { value: '—', unit: 'sistólica' } : { value: formatNumber(v, 0), unit: 'mmHg sistólica' }
  return figure(id, v)
}

/** Media, mínimo, máximo and coverage of the metric in the period. */
export function SummaryStrip({ v }: { v: MetricView }) {
  const s = v.summary
  const mean = v.id === 'bloodPressure' ? figure(v.id, s.mean, { low: s.meanLow }) : plain(v.id, s.mean)
  const min = plain(v.id, s.min)
  const max = plain(v.id, s.max)
  return (
    <div className="metric-strip grid-cols-2 sm:grid-cols-4" data-testid="summary-strip">
      <Metric label="Media" value={mean.value} unit={mean.unit} />
      <Metric label="Mínimo" value={min.value} unit={min.unit} />
      <Metric label="Máximo" value={max.value} unit={max.unit} />
      <Metric label="Cobertura" value={s.coverage.days} unit={`de ${s.coverage.total} días`} hint={s.excludedToday ? 'Sin contar hoy' : undefined} />
    </div>
  )
}

// ───────────── Chart block ─────────────
export interface MetricBlockProps {
  id: MetricId
  input: HealthInput | undefined
  period: ResolvedPeriod
  today: string
  seriesOptions?: SeriesOptions
  /** Panel title (default: the metric's label). */
  title?: string
  /** Label of the measured series in the legend. */
  label?: string
  /** Rendered above the chart (method picker, context filter…). */
  controls?: ReactNode
  /** Method notes, source precedence, caveats: folded under "Cómo se calcula" (advanced level), never deleted. */
  footnote?: ReactNode | ((v: MetricView) => ReactNode)
  /** Button for the empty state of the chart. */
  emptyAction?: ReactNode
  /** Extra text for the selected point (e.g. glucose context). */
  pointNote?: (date: string, v: MetricView) => string | null
}

const NO_UNIT: ReadonlySet<MetricId> = new Set<MetricId>(['sleep'])

/** `formatValue` for the chart: only the metrics whose figure is not "number + unit". */
function chartFormat(id: MetricId): ((v: number, unit: string) => string) | undefined {
  if (id === 'sleep') return (v) => formatMinutes(Math.round(v * 60))
  return undefined
}

export function MetricBlock({ id, input, period, today, seriesOptions, title, label, controls, footnote, emptyAction, pointNote }: MetricBlockProps) {
  const def = metricDef(id)
  const comparison = comparisonLabel(period)
  const [compare, setCompare] = useState(false)
  const [groupChoice, setGroupChoice] = useState<BucketUnit | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const v = useMemo(() => (input ? buildView(id, input, period.range, period.previous, { today, comparison, series: seriesOptions }) : null), [input, id, period, today, comparison, seriesOptions])

  const canGroup = def.kind === 'bar' && period.days > 14
  const group: BucketUnit = canGroup ? (groupChoice ?? defaultGroup(period.days)) : 'day'
  const groupOptions = (['day', 'week', ...(period.days >= 60 ? ['month'] : [])] as BucketUnit[]).map((g) => ({ value: g, label: groupLabel[g] }))

  const series = useMemo(() => {
    if (!v) return []
    const s = chartSeries(v, { group, compare, range: period.range, previous: period.previous, label })
    return NO_UNIT.has(id) ? s.map((x) => ({ ...x, unit: '' })) : s
  }, [v, group, compare, period, label, id])

  const name = title ?? def.label
  const range = periodTitle(period)
  if (!v) {
    return (
      <div className="space-y-4" data-testid="detail-loading">
        <Skeleton height={44} label="Cargando controles" />
        <ChartPanel title={name} value={null} unit="" period={range} loading>
          <span />
        </ChartPanel>
        <Skeleton height={96} label="Cargando resumen" />
      </div>
    )
  }

  const note = typeof footnote === 'function' ? footnote(v) : footnote
  const pt = selected ? v.points.find((p) => p.date === selected) : undefined
  const caption =
    selected && group === 'day'
      ? [formatDateEs(selected, 'weekday'), pt?.source ? `Fuente: ${sourceLabel(pt.source)}` : null, pt?.method ? `Método: ${pt.method}` : null, pt?.context ? `Contexto: ${pt.context === 'mixto' ? 'mezclado' : pt.context}` : null, pt?.n && pt.n > 1 ? `${pt.n} lecturas` : null, pointNote?.(selected, v) ?? null].filter(Boolean).join(' · ')
      : null

  return (
    <div className="space-y-4">
      {controls}
      <ChartPanel
        title={name}
        value={v.main.value}
        unit={v.main.unit}
        delta={v.delta}
        period={`${v.mainKind ? `${v.mainKind} · ` : ''}${range}`}
        pointCount={v.count}
        action={emptyAction}
        table={<ChartTable series={series} from={period.range.from} to={period.range.to} caption={`${name} por día`} formatValue={chartFormat(id)} />}
      >
        <TimeSeriesChart
          series={series}
          from={period.range.from}
          to={period.range.to}
          goal={v.goal ?? undefined}
          zeroBaseline={def.kind === 'bar'}
          height={220}
          ariaLabel={`${name}, ${range.toLowerCase()}${compare ? ', con el periodo anterior' : ''}`}
          formatValue={chartFormat(id)}
          maxGapDays={def.maxGapDays}
          onSelect={setSelected}
          legendExtra={
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {canGroup ? (
                <div className="w-[150px]">
                  <Segmented ariaLabel="Agrupar por" size="sm" value={group} onChange={setGroupChoice} options={groupOptions} />
                </div>
              ) : null}
              <button type="button" className={`chip min-h-[44px] ${compare ? 'chip-on' : ''}`} aria-pressed={compare} onClick={() => setCompare((x) => !x)} data-testid="compare-toggle">
                Comparar con el periodo anterior
              </button>
            </div>
          }
        />
        <p className="min-h-[18px] text-label text-muted" data-testid="point-caption" aria-live="polite">
          {caption}
        </p>
        {compare ? (
          <p className="text-label text-muted" data-testid="compare-note">
            Línea fina: {rangeText(period.previous)}.
          </p>
        ) : null}
      </ChartPanel>
      <SummaryStrip v={v} />
      <Disclosure summary="Cómo se calcula" testId="metric-how">
        <p className="text-label text-muted" data-testid="metric-sentence">
          {v.sentence}
        </p>
        {note}
      </Disclosure>
    </div>
  )
}

export { type MetricView }
