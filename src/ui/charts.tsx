/**
 * Lightweight SVG chart primitives for summaries (dashboard tiles, detail headers). No chart library:
 * they render instantly on the first screen. Full interactive charts stay in the lazily loaded
 * Progress page (Recharts).
 *
 * Rules: colours come from CSS tokens (`colorVar` = token name, e.g. 'energy'); every chart has an
 * accessible label; missing days are drawn as gaps, never as zero.
 */
import { useId, type ReactNode } from 'react'

const col = (v: string, a?: number) => (a === undefined ? `rgb(var(--${v}))` : `rgb(var(--${v}) / ${a})`)

/** One progress ring. Values above the target draw a second, darker lap (never hidden). */
export function Ring({
  value,
  max,
  colorVar,
  size = 72,
  stroke = 8,
  label,
  children,
}: {
  value: number | null | undefined
  max: number | null | undefined
  colorVar: string
  size?: number
  stroke?: number
  label: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const has = value !== null && value !== undefined && !!max && max > 0
  const ratio = has ? Math.max(0, value! / max!) : 0
  const first = Math.min(1, ratio)
  const second = ratio > 1 ? Math.min(1, ratio - 1) : 0
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col(colorVar, 0.16)} strokeWidth={stroke} />
        {first > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={col(colorVar)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${first * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
          />
        ) : null}
        {second > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={col(colorVar)}
            strokeOpacity={0.55}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${second * c} ${c}`}
            style={{ filter: 'brightness(0.6)' }}
          />
        ) : null}
      </svg>
      {children ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div> : null}
    </div>
  )
}

export interface RingSpec {
  key: string
  value: number | null | undefined
  max: number | null | undefined
  colorVar: string
  label: string
}

/** Concentric rings (outermost first). */
export function RingStack({ rings, size = 132, stroke = 12, gap = 3, label }: { rings: RingSpec[]; size?: number; stroke?: number; gap?: number; label: string }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      {rings.map((g, i) => {
        const s = size - i * 2 * (stroke + gap)
        return (
          <div key={g.key} className="absolute" style={{ left: (size - s) / 2, top: (size - s) / 2 }} aria-hidden>
            <Ring value={g.value} max={g.max} colorVar={g.colorVar} size={s} stroke={stroke} label={g.label} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * Line sparkline. `points` are evenly spaced (one per day); null = no data (gap). Optional `trend`
 * series is drawn bold on top of a thin raw line (scale weight vs trend weight).
 */
export function Sparkline({
  points,
  trend,
  colorVar,
  height = 44,
  width = 160,
  label,
  area = false,
}: {
  points: (number | null)[]
  trend?: (number | null)[]
  colorVar: string
  height?: number
  width?: number
  label: string
  area?: boolean
}) {
  const gid = useId()
  const all = [...points, ...(trend ?? [])].filter((v): v is number => v !== null && Number.isFinite(v))
  if (points.filter((v) => v !== null).length < 2) return <div style={{ height }} className="flex items-center text-xs text-faint" role="img" aria-label={`${label}: datos insuficientes`}>Sin datos suficientes</div>
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min) * 0.12 || 1
  const lo = min - pad
  const hi = max + pad
  const n = Math.max(points.length, trend?.length ?? 0)
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2)
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo)) * (height - 6)
  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const raw = path(points)
  const lastIdx = (() => {
    const src = trend ?? points
    for (let i = src.length - 1; i >= 0; i--) if (src[i] !== null) return i
    return -1
  })()
  const lastVal = lastIdx >= 0 ? (trend ?? points)[lastIdx]! : null
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="block overflow-visible">
      {area && !trend ? (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={col(colorVar, 0.28)} />
              <stop offset="1" stopColor={col(colorVar, 0)} />
            </linearGradient>
          </defs>
          {points.every((v) => v !== null) ? <path d={`${raw}L${x(points.length - 1)},${height}L${x(0)},${height}Z`} fill={`url(#${gid})`} /> : null}
        </>
      ) : null}
      <path d={raw} fill="none" stroke={col(colorVar, trend ? 0.45 : 1)} strokeWidth={trend ? 1.25 : 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {trend ? <path d={path(trend)} fill="none" stroke={col(colorVar)} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
      {lastVal !== null ? <circle cx={x(lastIdx)} cy={y(lastVal)} r={3} fill={col(colorVar)} stroke="rgb(var(--surface))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  )
}

/**
 * Small bar chart, one bar per period. null = no data (a faint stub, not a zero bar). An optional
 * target is drawn as a dashed line. `highlight` marks one index (e.g. today) at full colour.
 */
export function MiniBars({
  values,
  colorVar,
  target,
  height = 44,
  label,
  highlight,
  labels,
}: {
  values: (number | null)[]
  colorVar: string
  target?: number | null
  height?: number
  label: string
  highlight?: number
  labels?: string[]
}) {
  const vmax = Math.max(1, ...values.map((v) => v ?? 0), target ?? 0)
  const n = values.length
  const bw = 100 / n
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="block">
        {values.map((v, i) => {
          const h = v === null ? 2 : Math.max(2, (v / vmax) * (height - 2))
          const on = highlight === undefined || highlight === i
          return (
            <rect
              key={i}
              x={i * bw + bw * 0.18}
              y={height - h}
              width={bw * 0.64}
              height={h}
              rx={Math.min(2, bw * 0.3)}
              fill={v === null ? 'rgb(var(--line-strong) / 0.5)' : col(colorVar, on ? 1 : 0.42)}
            />
          )
        })}
        {target ? (
          <line x1={0} x2={100} y1={height - (target / vmax) * (height - 2)} y2={height - (target / vmax) * (height - 2)} stroke="rgb(var(--muted))" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {labels ? (
        <div className="mt-1 grid text-center text-[10px] text-faint" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
          {labels.map((l, i) => (
            <span key={i} className={highlight === i ? 'font-semibold text-muted' : ''}>
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Segmented progress bar (discrete steps); overflow above the target is shown in the warning colour. */
export function Segments({ value, max, colorVar, segments = 24, height = 22, label }: { value: number | null | undefined; max: number | null | undefined; colorVar: string; segments?: number; height?: number; label: string }) {
  const has = value !== null && value !== undefined && !!max && max > 0
  const ratio = has ? value! / max! : 0
  const lit = Math.round(Math.min(1, ratio) * segments)
  const over = ratio > 1.05
  return (
    <div className="flex w-full gap-[3px]" style={{ height }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? 0} aria-valuenow={value ?? 0}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[2px] transition-colors duration-500"
          style={{ background: i < lit ? (over && i >= segments - 3 ? 'rgb(var(--warn))' : col(colorVar, 0.45 + (0.55 * (i + 1)) / segments)) : 'rgb(var(--surface2))' }}
        />
      ))}
    </div>
  )
}
