/**
 * Data contract of V3 charts (the project notes §4). Shared by every implementation.
 * `span` lets a bar cover several days (weekly bins). `low`/`high` extend the contract for `kind: 'range'` (e.g. blood pressure: low = diastolic,
 * high = systolic); `value` stays the point's representative number (e.g. the mean) or null.
 */
export type Point = {
  date: string // YYYY-MM-DD
  value: number | null
  estimated?: boolean
  source?: string
  low?: number
  high?: number
  /** Days covered by this point (bars only; weekly bins use 7, `date` is the first day). Default 1. */
  span?: number
}

export type SeriesKind = 'line' | 'bar' | 'dots' | 'range'
export type SeriesRole = 'measured' | 'trend' | 'previous'

export type Series = {
  id: string
  label: string
  unit: string
  colorVar: string
  kind: SeriesKind
  role?: SeriesRole
  points: Point[]
  /** Range series: text of a "low–high" reading (default "high/low unit"). */
  formatRange?: (low: number, high: number) => string
}

export type Goal = number | [number, number]

export interface TimeSeriesProps {
  series: Series[]
  from: string
  to: string
  goal?: Goal
  height?: number
  zeroBaseline?: boolean
  /** Whole-number y ticks only (counts). */
  integerTicks?: boolean
  maxGapDays?: number
  selectedDate?: string | null
  onSelect?: (date: string | null) => void
  ariaLabel: string
  formatValue?: (v: number, unit: string) => string
  /** Small, non-interactive variant (no axes, no table). */
  compact?: boolean
  /** Y-axis tick label (default: the number). For clock times, durations… */
  formatTick?: (v: number) => string
  /** Rendered at the right of the legend row (e.g. a comparison toggle). */
  legendExtra?: import('react').ReactNode
}

/** What the panel header shows while a point is selected. */
export interface Readout {
  date: string
  value: string
  unit: string
}
