import type { ReactNode } from 'react'

const SIZE = {
  md: 'text-title',
  lg: 'text-readout',
  xl: 'text-display',
} as const

const TONE = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  accent: 'text-accent',
} as const

/**
 * A measured value: small label, big condensed figure with its unit stuck to it, an optional
 * delta line and at most one line of context. Replaces Stat, StatCard and HeroMetric.
 */
export function Metric({
  label,
  value,
  unit,
  delta,
  hint,
  size = 'md',
  tone,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  /** Usually a `<Delta />`. */
  delta?: ReactNode
  hint?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  tone?: 'good' | 'warn' | 'bad' | 'accent'
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-label font-medium text-muted">{label}</div>
      <div className={`readout mt-1.5 truncate leading-none ${SIZE[size]} ${tone ? TONE[tone] : 'text-ink'}`}>
        {value}
        {unit ? <span className="ml-1 text-label font-medium tracking-normal text-muted">{unit}</span> : null}
      </div>
      {delta ? <div className="mt-1.5 min-w-0">{delta}</div> : null}
      {hint ? <div className="mt-1 text-label text-muted">{hint}</div> : null}
    </div>
  )
}
