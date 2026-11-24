import { calcPlates, plateIncrement, type PlateStock } from './plates'

export interface WarmupStep {
  weight: number
  reps: number
}

/** Share of the working weight and reps of each ramp step (after the empty bar). */
const RAMP: readonly (readonly [number, number])[] = [
  [0.4, 5],
  [0.6, 3],
  [0.8, 1],
]

/**
 * Warm-up ramp towards a first working weight: the bar × 10 (barbell only), then ~40 % × 5, ~60 % × 3 and
 * ~80 % × 1. Weights are rounded to what can be loaded; steps at or below the bar, repeated weights and
 * steps at or above the working weight are dropped. `bar: null` is for dumbbells and machines (rounded to
 * the lightest plate step, nothing below it).
 */
export function warmupPlan(work: number, bar: number | null, stock: readonly PlateStock[]): WarmupStep[] {
  if (!Number.isFinite(work) || work <= 0) return []
  if (bar !== null && work <= bar) return []
  const base = bar ?? 0
  const step = plateIncrement(stock)
  const round = (w: number) => (bar === null ? Math.max(step, Math.round(w / step) * step) : calcPlates(w, bar, stock).achieved)
  const out: WarmupStep[] = []
  if (bar !== null && work >= bar * 1.25) out.push({ weight: bar, reps: 10 })
  for (const [pct, reps] of RAMP) {
    const w = round(work * pct)
    const last = out[out.length - 1]
    if (w <= base || w >= work || (last && w <= last.weight)) continue
    out.push({ weight: w, reps })
  }
  return out
}
