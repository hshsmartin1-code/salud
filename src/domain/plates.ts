/**
 * Plate calculator (pure). A barbell is loaded symmetrically: the weight of one side is built from the
 * plates the person owns (pairs per denomination), and the total is bar + 2 × side.
 *
 * Greedy is NOT used for the choice: with a limited inventory it can miss exact solutions (e.g. one pair
 * of 25 and two of 20 for 40 per side). The reachable per-side sums are enumerated exactly (bounded
 * knapsack over a handful of denominations) and the representation with the fewest plates is kept.
 */
export type PlateUnit = 'kg' | 'lb'

export interface PlateStock {
  /** Weight of one plate, in the calculator's unit. */
  plate: number
  /** Pairs owned (one plate on each side per pair). */
  pairs: number
}

export interface PlateCount {
  plate: number
  count: number
}

export const BARS: Record<PlateUnit, readonly number[]> = { kg: [20, 15, 10], lb: [45, 35] }
export const DEFAULT_BAR: Record<PlateUnit, number> = { kg: 20, lb: 45 }
const DENOMINATIONS: Record<PlateUnit, readonly number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5], lb: [45, 35, 25, 10, 5, 2.5] }
/** The optional 0.5 kg disc starts at 0 pairs; every other denomination starts at 6. */
const DEFAULT_PAIRS: Record<number, number> = { 0.5: 0 }
const DEFAULT_PAIRS_OTHER = 6
export const MAX_PAIRS = 20

export const plateDenominations = (unit: PlateUnit = 'kg'): readonly number[] => DENOMINATIONS[unit]

/** Inventory of a profile: `owned` maps a denomination (as text) to pairs; anything absent uses the default. */
export function plateInventory(owned: Readonly<Record<string, number>> | undefined, unit: PlateUnit = 'kg'): PlateStock[] {
  return DENOMINATIONS[unit].map((plate) => {
    const v = owned?.[String(plate)]
    const pairs = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(MAX_PAIRS, Math.floor(v))) : (DEFAULT_PAIRS[plate] ?? DEFAULT_PAIRS_OTHER)
    return { plate, pairs }
  })
}

export interface PlateResult {
  bar: number
  /** Plates of ONE side, heaviest first. */
  perSide: PlateCount[]
  /** Bar + both sides. */
  achieved: number
  exact: boolean
  /** Largest loadable weight ≤ target (null: the target is below the bar). */
  lower: number | null
  /** Smallest loadable weight ≥ target (null: more than the plates allow). */
  higher: number | null
}

const SCALE = 100
const units = (n: number) => Math.round(n * SCALE)

interface Reach {
  n: number
  counts: number[]
}

const usable = (stock: readonly PlateStock[]) => [...stock].filter((s) => s.pairs > 0 && s.plate > 0).sort((a, b) => b.plate - a.plate)

/** Same plate count: prefer the heavier plates (first differing denomination, heaviest first). */
function heavier(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/** Every per-side sum (in hundredths) the inventory can build, with its smallest plate count. */
function reachable(sorted: readonly PlateStock[]): Map<number, Reach> {
  let reach = new Map<number, Reach>([[0, { n: 0, counts: sorted.map(() => 0) }]])
  sorted.forEach((s, i) => {
    const next = new Map(reach)
    for (const [sum, r] of reach) {
      for (let c = 1; c <= s.pairs; c++) {
        const total = sum + c * units(s.plate)
        const n = r.n + c
        const cur = next.get(total)
        const counts = [...r.counts]
        counts[i] = c
        if (!cur || n < cur.n || (n === cur.n && heavier(counts, cur.counts))) next.set(total, { n, counts })
      }
    }
    reach = next
  })
  return reach
}

/** Plates per side for `target` total weight. Never throws; below the bar it returns the empty bar. */
export function calcPlates(target: number, bar: number, stock: readonly PlateStock[]): PlateResult {
  const sorted = usable(stock)
  const reach = reachable(sorted)
  const sums = [...reach.keys()].sort((a, b) => a - b)
  const total = (sum: number) => (bar * SCALE + 2 * sum) / SCALE
  const sideOf = (r: Reach): PlateCount[] => sorted.flatMap((s, i) => (r.counts[i]! > 0 ? [{ plate: s.plate, count: r.counts[i]! }] : []))
  if (!Number.isFinite(target) || target < bar) return { bar, perSide: [], achieved: bar, exact: false, lower: null, higher: bar }
  const side = units((target - bar) / 2)
  let lo = 0
  let hi: number | null = null
  for (const s of sums) {
    if (s <= side) lo = s
    if (s >= side && hi === null) hi = s
  }
  const exact = reach.get(side)
  if (exact) return { bar, perSide: sideOf(exact), achieved: total(side), exact: true, lower: total(side), higher: total(side) }
  const nearest = hi !== null && hi - side < side - lo ? hi : lo
  return { bar, perSide: sideOf(reach.get(nearest)!), achieved: total(nearest), exact: false, lower: total(lo), higher: hi === null ? null : total(hi) }
}

/** Smallest step between two loadable weights (2 × the lightest owned plate). */
export function plateIncrement(stock: readonly PlateStock[]): number {
  const owned = usable(stock).map((s) => s.plate)
  return owned.length ? 2 * Math.min(...owned) : 5
}

/** Text such as "2 × 20 + 5" (per side, heaviest first); an empty side reads "Solo la barra". */
export function describeSide(perSide: readonly PlateCount[], fmt: (n: number) => string): string {
  if (!perSide.length) return 'Solo la barra'
  return perSide.map((p) => (p.count > 1 ? `${p.count} × ${fmt(p.plate)}` : fmt(p.plate))).join(' + ')
}
