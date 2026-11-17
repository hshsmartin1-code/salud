/**
 * Implementation A: hand-written SVG time-series chart (the project notes §4).
 * - Container width is measured (ResizeObserver) and drawn 1:1 in px, so text never stretches.
 * - Static layer (`Plot`) is memoised; scrubbing only re-renders the small selection overlay.
 * - No animation of any kind, so `prefers-reduced-motion` is satisfied by construction.
 */
import { memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  barPath,
  dayNum,
  defaultFormat,
  fmtNumber,
  linePath,
  shortDate,
  tickDecimals,
  timeScale,
  xTickIndices,
  yDomain,
  type TimeScale,
  type YDomain,
} from './geometry'
import { ChartPanelContext, useElementWidth } from './panelContext'
import { ChartLegend } from './ChartLegend'
import { ChartTable } from './ChartTable'
import { useScrub } from './useScrub'
import { byDate, dataDates, hasValue, pointText, primaryOf, readoutFor, summaryLabel } from './seriesUtil'
import type { Point, Series, TimeSeriesProps } from './types'

const col = (v: string, a?: number) => (a === undefined ? `rgb(var(--${v}))` : `rgb(var(--${v}) / ${a})`)
const MUTED = col('muted')
const SURFACE = col('surface')
const LINE = col('line')

interface Drawn {
  s: Series
  pts: Point[] // in range, with data, ascending
}

interface Model {
  width: number
  height: number
  x0: number
  x1: number
  top: number
  bottom: number
  compact: boolean
  sc: TimeScale
  dom: YDomain
  yOf: (v: number) => number
  drawn: Drawn[]
  goal: number | [number, number] | undefined
  maxGap: number
  tickText: (v: number) => string
  xTicks: number[]
  rangeW: number
  gap: number
}

function buildModel(p: {
  series: Series[]
  from: string
  to: string
  goal?: number | [number, number]
  width: number
  height: number
  compact: boolean
  zeroBaseline?: boolean
  integerTicks?: boolean
  maxGapDays: number
  formatTick?: (v: number) => string
}): Model {
  const { series, from, to, width, height, compact } = p
  const a = dayNum(from)
  const b = dayNum(to)
  const drawn: Drawn[] = series.map((s) => ({
    s,
    pts: s.points
      .filter((pt) => hasValue(pt) && dayNum(pt.date) >= a && dayNum(pt.date) <= b)
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)),
  }))
  const vals: number[] = []
  for (const d of drawn)
    for (const pt of d.pts) {
      vals.push(pt.value as number)
      if (d.s.kind === 'range') {
        if (pt.low !== undefined) vals.push(pt.low)
        if (pt.high !== undefined) vals.push(pt.high)
      }
    }
  if (typeof p.goal === 'number') vals.push(p.goal)
  else if (p.goal) vals.push(...p.goal)
  const zero = !!p.zeroBaseline || series.some((s) => s.kind === 'bar' && s.role !== 'previous')
  const dom = yDomain(vals, { zero, integer: p.integerTicks })
  const top = compact ? 6 : 10
  const bottom = height - (compact ? 4 : 22)
  const tickText = p.formatTick ?? ((t: number) => fmtNumber(t, tickDecimals(dom.step)))
  const gutter = compact ? 4 : Math.max(...dom.ticks.map((t) => tickText(t).length)) * 6.4 + 12
  const x0 = gutter
  const x1 = width - (compact ? 4 : 10)
  const sc = timeScale(from, to, x0, Math.max(x0 + 1, x1))
  const span = dom.max - dom.min || 1
  const gap = Math.min(2, sc.slot * 0.4)
  return {
    width,
    height,
    x0,
    x1,
    top,
    bottom,
    compact,
    sc,
    dom,
    yOf: (v) => bottom - ((v - dom.min) / span) * (bottom - top),
    drawn,
    goal: p.goal,
    maxGap: p.maxGapDays,
    tickText,
    xTicks: compact ? [] : xTickIndices(sc.days, width < 300 ? 3 : 4),
    gap,
    rangeW: Math.max(2, Math.min(4, sc.slot - 2)),
  }
}

/** Blood-pressure style mark: a thin capsule from low to high with a small cap at each end. */
function rangeMark(key: string, x: number, y1: number, y2: number, w: number, fill: string, hollow: boolean, stroke: string, strokeW: number) {
  const cap = Math.max(3, w)
  return (
    <g key={key}>
      <rect x={x - w / 2} y={y1} width={w} height={Math.max(w, y2 - y1)} rx={w / 2} fill={hollow ? 'none' : fill} stroke={hollow ? fill : stroke} strokeWidth={hollow ? 1 : strokeW} />
      <line x1={x - cap} x2={x + cap} y1={y1} y2={y1} stroke={fill} strokeWidth={2} />
      <line x1={x - cap} x2={x + cap} y1={y2} y2={y2} stroke={fill} strokeWidth={2} />
    </g>
  )
}

/** Geometry of one bar (shared by the static layer and the selection highlight). */
function barGeom(m: Model, p: Point) {
  const span = p.span ?? 1
  const w = Math.max(1, Math.min(40, m.sc.slot * span - m.gap))
  const x = m.sc.x(p.date) + ((span - 1) * m.sc.slot) / 2 - w / 2
  return barPath(x, w, m.yOf(Math.max(0, m.dom.min)), m.yOf(p.value as number), 4)
}

const Plot = memo(function Plot({ m }: { m: Model }) {
  const { x0, x1, bottom, sc, dom, yOf, compact } = m
  const fmtTick = m.tickText
  const out: React.ReactNode[] = []

  // Grid and y labels (recessive).
  if (!compact) {
    for (const t of dom.ticks) {
      const y = yOf(t)
      out.push(<line key={`g${t}`} x1={x0} x2={x1 + 2} y1={y} y2={y} stroke={LINE} strokeWidth={1} />)
      out.push(
        <text key={`yl${t}`} x={x0 - 6} y={y + 4} textAnchor="end" fill={MUTED} className="num text-micro">
          {fmtTick(t)}
        </text>,
      )
    }
    for (const i of m.xTicks) {
      const anchor = i === 0 ? 'start' : i === sc.days - 1 ? 'end' : 'middle'
      const x = i === 0 ? x0 : i === sc.days - 1 ? x1 : sc.xAt(i)
      out.push(
        <text key={`xl${i}`} x={x} y={bottom + 17} textAnchor={anchor} fill={MUTED} className="text-micro">
          {shortDate(sc.dateAt(i))}
        </text>,
      )
    }
  } else {
    out.push(<line key="base" x1={x0} x2={x1} y1={bottom} y2={bottom} stroke={LINE} strokeWidth={1} />)
  }

  // Goal: band for ranges, dashed line for a single value, with its label.
  const color0 = m.drawn[0]?.s.colorVar ?? 'muted'
  if (m.goal !== undefined) {
    if (Array.isArray(m.goal)) {
      const [lo, hi] = m.goal
      out.push(<rect key="band" x={x0} y={yOf(hi)} width={x1 - x0} height={Math.max(0, yOf(lo) - yOf(hi))} fill={col(color0, 0.1)} />)
      if (!compact)
        out.push(
          <text key="gl" x={x1 - 2} y={yOf(hi) - 4} textAnchor="end" fill={MUTED} style={{ paintOrder: 'stroke' }} stroke={SURFACE} strokeWidth={3} className="num text-micro">
            {`Meta ${fmtNumber(lo, 1)}–${fmtNumber(hi, 1)}`}
          </text>,
        )
    } else {
      const y = yOf(m.goal)
      out.push(<line key="goal" x1={x0} x2={x1} y1={y} y2={y} stroke={MUTED} strokeWidth={1} strokeDasharray="4 4" />)
      if (!compact)
        out.push(
          <text key="gl" x={x1 - 2} y={y - 5} textAnchor="end" fill={MUTED} style={{ paintOrder: 'stroke' }} stroke={SURFACE} strokeWidth={3} className="num text-micro">
            {`Meta ${fmtNumber(m.goal, m.goal >= 100 ? 0 : 1)}`}
          </text>,
        )
    }
  }

  const order = (d: { s: Series }) => (d.s.role === 'previous' ? 0 : d.s.role === 'trend' ? 2 : 1)
  const layers = [...m.drawn].sort((a, b) => order(a) - order(b))
  for (const { s, pts } of layers) {
    if (!pts.length) continue
    const c = col(s.colorVar)
    const x = (d: string) => sc.x(d)
    if (s.role === 'previous') {
      out.push(<path key={s.id} d={linePath(pts, x, yOf, m.maxGap)} fill="none" stroke={MUTED} strokeWidth={1} strokeLinejoin="round" />)
      continue
    }
    if (s.role === 'trend') {
      out.push(<path key={s.id} d={linePath(pts, x, yOf, m.maxGap)} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)
      continue
    }
    if (s.kind === 'bar') {
      const solid = pts.filter((p) => !p.estimated)
      const est = pts.filter((p) => p.estimated)
      if (solid.length) out.push(<path key={s.id} d={solid.map((p) => barGeom(m, p)).join('')} fill={c} />)
      if (est.length) out.push(<path key={`${s.id}e`} d={est.map((p) => barGeom(m, p)).join('')} fill={col(s.colorVar, 0.15)} stroke={c} strokeWidth={1.5} />)
    } else if (s.kind === 'range') {
      pts.forEach((p) => {
        if (p.low === undefined || p.high === undefined) return
        out.push(rangeMark(`${s.id}${p.date}`, sc.x(p.date), yOf(p.high), yOf(p.low), m.rangeW, c, !!p.estimated, 'none', 0))
      })
    } else {
      if (s.kind === 'line') out.push(<path key={s.id} d={linePath(pts, x, yOf, m.maxGap)} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)
      // Adaptive markers: sparse data keeps full 8 px ringed markers; when points are closer than 12 px on average
      // they shrink to 5 px dots without ring (the trend line is drawn on top of them).
      const spacing = pts.length > 1 ? (sc.x(pts[pts.length - 1]!.date) - sc.x(pts[0]!.date)) / (pts.length - 1) : Infinity
      const small = compact || spacing < 12
      if (!(s.kind === 'line' && compact && pts.length > 12))
        for (const p of pts) {
          const cx = sc.x(p.date)
          const cy = yOf(p.value as number)
          out.push(
            p.estimated ? (
              <circle key={`${s.id}${p.date}`} cx={cx} cy={cy} r={small ? 2.5 : 4} fill={SURFACE} stroke={c} strokeWidth={small ? 1.5 : 2} />
            ) : small ? (
              <circle key={`${s.id}${p.date}`} cx={cx} cy={cy} r={compact ? 3 : 2.5} fill={c} />
            ) : (
              <circle key={`${s.id}${p.date}`} cx={cx} cy={cy} r={5} fill={c} stroke={SURFACE} strokeWidth={2} />
            ),
          )
        }
    }
  }
  return <>{out}</>
})

function Selection({ m, date }: { m: Model; date: string }) {
  const x = m.sc.x(date)
  const bars = m.drawn.find((d) => d.s.kind === 'bar' && d.s.role !== 'previous')
  const hasBars = !!bars
  const bandSpan = bars?.pts.find((q) => q.date === date)?.span ?? 1
  const items: React.ReactNode[] = []
  for (const { s, pts } of m.drawn) {
    const p = pts.find((q) => q.date === date)
    if (!p) continue
    const c = col(s.colorVar)
    if (s.role === 'previous') continue // the comparison line never takes a selection marker
    if (s.kind === 'bar') items.push(<path key={s.id} d={barGeom(m, p)} fill={c} stroke={col('ink')} strokeWidth={1.5} />)
    else if (s.kind === 'range' && p.low !== undefined && p.high !== undefined) items.push(rangeMark(s.id, x, m.yOf(p.high), m.yOf(p.low), m.rangeW, c, false, col('ink'), 1.5))
    else if (s.role === 'trend') items.push(<circle key={s.id} cx={x} cy={m.yOf(p.value as number)} r={4.5} fill={c} stroke={SURFACE} strokeWidth={2} />)
    else items.push(<circle key={s.id} cx={x} cy={m.yOf(p.value as number)} r={7} fill={c} stroke={SURFACE} strokeWidth={2} />)
  }
  return (
    <g pointerEvents="none">
      {hasBars ? <rect x={x - m.sc.slot / 2} y={m.top} width={m.sc.slot * bandSpan} height={m.bottom - m.top} fill={col('ink', 0.08)} /> : null}
      <line x1={x + ((bandSpan - 1) * m.sc.slot) / 2} x2={x + ((bandSpan - 1) * m.sc.slot) / 2} y1={m.top - 4} y2={m.bottom} stroke={col('line-strong')} strokeWidth={1} />
      {items}
    </g>
  )
}

export function TimeSeriesChart(props: TimeSeriesProps) {
  const { series, from, to, goal, zeroBaseline, ariaLabel, formatValue = defaultFormat } = props
  const ctx = useContext(ChartPanelContext)
  const compact = props.compact ?? ctx?.compact ?? false
  const height = props.height ?? (compact ? 56 : 176)
  const maxGapDays = props.maxGapDays ?? 3
  const { formatTick, legendExtra } = props
  const [localSel, setLocalSel] = useState<string | null>(null)
  const selected = props.selectedDate !== undefined ? props.selectedDate : ctx ? ctx.selectedDate : localSel
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [showTable, setShowTable] = useState(false)
  const uid = useId()

  const m = useMemo(
    () => (width > 0 ? buildModel({ series, from, to, goal, width, height, compact, zeroBaseline, integerTicks: props.integerTicks, maxGapDays, formatTick }) : null),
    [series, from, to, goal, width, height, compact, zeroBaseline, maxGapDays, props.integerTicks, formatTick],
  )

  const primary = useMemo(() => primaryOf(series), [series])
  const dates = useMemo(() => (primary ? dataDates(primary).filter((d) => dayNum(d) >= dayNum(from) && dayNum(d) <= dayNum(to)) : []), [primary, from, to])
  const xs = useMemo(() => (m ? dates.map((d) => m.sc.x(d)) : []), [m, dates])
  const primaryMap = useMemo(() => (primary ? byDate(primary) : new Map<string, Point>()), [primary])

  const selRef = useRef<string | null>(selected)
  useEffect(() => {
    selRef.current = selected
  }, [selected])
  const select = useCallback(
    (date: string | null) => {
      selRef.current = date
      const pt = date ? primaryMap.get(date) : undefined
      setLocalSel(date)
      ctx?.select(date, date && pt && primary ? readoutFor(primary, pt, formatValue) : null)
      props.onSelect?.(date)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primary, primaryMap, formatValue, ctx?.select, props.onSelect],
  )
  const handlers = useScrub({ enabled: !compact, wrapRef, dates, xs, selected, select })

  const announce =
    selected && primary
      ? `${shortDate(selected)}: ` +
        series
          .map((s) => {
            const p = byDate(s).get(selected)
            return p ? `${s.label} ${pointText(s, p, formatValue)}` : null
          })
          .filter(Boolean)
          .join(', ')
      : ''

  const externalTable = !!ctx?.externalTable
  const label = summaryLabel(series, ariaLabel, from, to)
  const inRange = primary ? primary.points.filter((p) => hasValue(p) && dayNum(p.date) >= dayNum(from) && dayNum(p.date) <= dayNum(to)).length : 0
  const empty = inRange < 2
  const toggle =
    !compact && !externalTable && !empty ? (
      <button
        type="button"
        className="-mr-2 ml-auto inline-flex min-h-[44px] items-center rounded-lg px-2 text-label text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-pressed={showTable}
        onClick={() => setShowTable((v) => !v)}
      >
        {showTable ? 'Ver gráfica' : 'Ver tabla'}
      </button>
    ) : null
  const legend = !compact && !empty && !showTable && series.length >= 2 ? <ChartLegend series={series} /> : null

  return (
    <div data-testid="ts-chart">
      {legend || toggle || legendExtra ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {legend ?? <span />}
          {legendExtra}
          {toggle}
        </div>
      ) : null}
      {empty ? (
        <div className={`flex items-center justify-center px-3 text-center text-muted ${compact ? '' : 'rounded-lg bg-surface2/40'}`} style={{ height }} data-testid="chart-empty">
          <span className={compact ? 'text-micro' : 'text-label'}>Aún no hay datos suficientes en este periodo</span>
        </div>
      ) : showTable && !externalTable && !compact ? (
        <ChartTable series={series} from={from} to={to} formatValue={formatValue} caption={ariaLabel} />
      ) : (
        <div
          ref={wrapRef}
          role="img"
          aria-label={label}
          aria-describedby={compact ? undefined : `${uid}-hint`}
          tabIndex={compact ? undefined : 0}
          {...handlers}
          className="relative w-full select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ height, touchAction: compact ? 'auto' : 'pan-y', WebkitUserSelect: 'none' }}
        >
          {m ? (
            <svg width={m.width} height={m.height} aria-hidden="true" style={{ display: 'block' }}>
              <Plot m={m} />
              {selected && !compact ? <Selection m={m} date={selected} /> : null}
            </svg>
          ) : null}
        </div>
      )}
      {!compact && !empty ? (
        <>
          <span id={`${uid}-hint`} className="sr-only">
            Use las flechas izquierda y derecha para recorrer los días y Escape para soltar.
          </span>
          <span className="sr-only" role="status" aria-live="polite">
            {announce}
          </span>
        </>
      ) : null}
    </div>
  )
}
