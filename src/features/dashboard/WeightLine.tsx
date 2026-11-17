import { daysBetween } from '../../domain/dates'
import type { DayValue } from './controlCenter'

/** Longest gap (days) a line is drawn across; the health series layer uses the same for weight. */
const MAX_GAP_DAYS = 4
const MIN_POINTS = 3
const W = 160
const H = 36

/**
 * Weigh-ins of the last 30 days: a dot per weigh-in, a line between consecutive ones when at most
 * {@link MAX_GAP_DAYS} days apart. Needs at least 3 weigh-ins, otherwise nothing is drawn.
 */
export function WeightLine({ days, weights }: { days: string[]; weights: DayValue[] }) {
  const from = days[0]!
  const pts = weights.filter((w) => w.value !== null && w.date >= from && w.date <= days[days.length - 1]!)
  if (pts.length < MIN_POINTS) return null
  const vals = pts.map((p) => p.value as number)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = (max - min) * 0.15 || 0.5
  const x = (d: string) => 3 + (daysBetween(from, d) / (days.length - 1)) * (W - 6)
  const y = (v: number) => H - 4 - ((v - (min - pad)) / (max + pad - (min - pad))) * (H - 8)
  let d = ''
  pts.forEach((p, i) => {
    const link = i > 0 && daysBetween(pts[i - 1]!.date, p.date) <= MAX_GAP_DAYS
    d += `${link ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value as number).toFixed(1)}`
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`Peso: ${pts.length} registros en 30 días, de ${min.toLocaleString('es-CO')} a ${max.toLocaleString('es-CO')} kg`} style={{ color: 'rgb(var(--body))' }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p) => (
        <ellipse key={p.date} cx={x(p.date)} cy={y(p.value as number)} rx="2.2" ry="2.2" fill="currentColor" />
      ))}
    </svg>
  )
}
