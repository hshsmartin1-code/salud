/**
 * Sleep-schedule chart: one floating bar per night from bedtime to wake time, clock times on the y axis
 * (time flows downwards). The shared TimeSeriesChart labels its y axis with plain numbers, which cannot
 * show "23:00", so this small local chart reuses the kit's geometry, panel context and scrubbing instead.
 */
import { useCallback, useContext, useMemo, useState } from 'react'
import { ChartPanelContext, useElementWidth } from '../../ui/charts/panelContext'
import { barPath, shortDate, timeScale, xTickIndices } from '../../ui/charts/geometry'
import { useScrub } from '../../ui/charts/useScrub'

export interface Night {
  date: string
  /** Minutes since 00:00 of the previous evening; after-midnight bedtimes are 1440 + minutes (series layer). */
  bed: number | null
  /** Minutes of the wake-up day, 0..1439. */
  wake: number | null
}

const col = (v: string, a?: number) => (a === undefined ? `rgb(var(--${v}))` : `rgb(var(--${v}) / ${a})`)
const hhmm = (v: number) => {
  const m = ((Math.round(v) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** [bed, wake] on one continuous axis (wake is the next morning). */
function span(n: Night): [number, number] | null {
  if (n.bed === null || n.wake === null) return null
  let w = n.wake
  while (w <= n.bed) w += 1440
  return [n.bed, w]
}

export function ScheduleChart({ nights, from, to, height = 220, ariaLabel }: { nights: Night[]; from: string; to: string; height?: number; ariaLabel: string }) {
  const ctx = useContext(ChartPanelContext)
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [localSel, setLocalSel] = useState<string | null>(null)
  const selected = ctx ? ctx.selectedDate : localSel
  const data = useMemo(() => nights.filter((n) => (n.bed !== null || n.wake !== null) && n.date >= from && n.date <= to).sort((a, b) => a.date.localeCompare(b.date)), [nights, from, to])

  const model = useMemo(() => {
    if (width <= 0 || !data.length) return null
    const vals: number[] = []
    for (const n of data) {
      const s = span(n)
      if (s) vals.push(...s)
      else vals.push((n.bed ?? n.wake) as number + (n.bed === null ? 1440 : 0))
    }
    const lo = Math.floor(Math.min(...vals) / 120) * 120
    const hi = Math.ceil(Math.max(...vals) / 120) * 120
    const step = hi - lo > 720 ? 240 : 120
    const ticks: number[] = []
    for (let t = lo; t <= hi + 0.1; t += step) ticks.push(t)
    const top = 10
    const bottom = height - 22
    const x0 = 44
    const x1 = width - 10
    const sc = timeScale(from, to, x0, Math.max(x0 + 1, x1))
    const yOf = (v: number) => top + ((v - lo) / (hi - lo || 1)) * (bottom - top)
    return { top, bottom, x0, x1, sc, yOf, ticks, lo, hi }
  }, [data, width, height, from, to])

  const dates = useMemo(() => data.map((n) => n.date), [data])
  const xs = useMemo(() => (model ? dates.map((d) => model.sc.x(d)) : []), [model, dates])
  const byDate = useMemo(() => new Map(data.map((n) => [n.date, n])), [data])

  const select = useCallback(
    (date: string | null) => {
      setLocalSel(date)
      const n = date ? byDate.get(date) : undefined
      const text = n ? (n.bed !== null && n.wake !== null ? `${hhmm(n.bed)} → ${hhmm(n.wake)}` : n.bed !== null ? `Acostarse ${hhmm(n.bed)}` : `Levantarse ${hhmm(n.wake as number)}`) : null
      ctx?.select(date, date && text ? { date, value: text, unit: '' } : null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDate, ctx?.select],
  )
  const handlers = useScrub({ enabled: true, wrapRef, dates, xs, selected, select })

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={`${ariaLabel}. ${data.length} noches con horario.`}
      tabIndex={0}
      {...handlers}
      className="relative w-full select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ height, touchAction: 'pan-y', WebkitUserSelect: 'none' }}
      data-testid="schedule-chart"
    >
      {model ? (
        <svg width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
          {model.ticks.map((t) => (
            <g key={t}>
              <line x1={model.x0} x2={model.x1 + 2} y1={model.yOf(t)} y2={model.yOf(t)} stroke={col('line')} strokeWidth={1} />
              <text x={model.x0 - 6} y={model.yOf(t) + 4} textAnchor="end" fill={col('muted')} className="num text-micro">
                {hhmm(t)}
              </text>
            </g>
          ))}
          {xTickIndices(model.sc.days, width < 300 ? 3 : 4).map((i) => (
            <text key={i} x={i === 0 ? model.x0 : i === model.sc.days - 1 ? model.x1 : model.sc.xAt(i)} y={model.bottom + 17} textAnchor={i === 0 ? 'start' : i === model.sc.days - 1 ? 'end' : 'middle'} fill={col('muted')} className="text-micro">
              {shortDate(model.sc.dateAt(i))}
            </text>
          ))}
          {data.map((n) => {
            const s = span(n)
            const x = model.sc.x(n.date)
            const w = Math.max(2, Math.min(14, model.sc.slot - 2))
            const on = n.date === selected
            if (s) return <path key={n.date} d={barPath(x - w / 2, w, model.yOf(s[1]), model.yOf(s[0]), Math.min(4, w / 2))} fill={col('sleep')} stroke={on ? col('ink') : 'none'} strokeWidth={1.5} />
            const v = n.bed ?? (n.wake as number) + 1440
            return <circle key={n.date} cx={x} cy={model.yOf(v)} r={on ? 5 : 3.5} fill={col('sleep')} stroke={on ? col('ink') : 'none'} strokeWidth={1.5} />
          })}
          {selected && byDate.has(selected) ? <line x1={model.sc.x(selected)} x2={model.sc.x(selected)} y1={model.top - 4} y2={model.bottom} stroke={col('line-strong')} strokeWidth={1} pointerEvents="none" /> : null}
        </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-label text-muted">Sin horarios en este periodo</div>
      )}
    </div>
  )
}
