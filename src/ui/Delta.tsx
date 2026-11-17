import { formatNumber } from '../domain/units'
import { deltaState } from './deltaLogic'

const TONE = { neutral: 'text-muted', good: 'text-good', bad: 'text-bad' } as const

/**
 * Change against a previous period. Neutral (muted arrow and figure) unless `goodWhen` says which
 * direction is the good one; then good is green and the other direction is red. Never colour alone:
 * the arrow and a spoken text carry the direction.
 */
export function Delta({
  value,
  unit,
  period,
  goodWhen,
}: {
  value: number
  unit?: string
  /** What it is compared with, e.g. "vs. 7 d anteriores". */
  period?: string
  goodWhen?: 'up' | 'down'
}) {
  const { dir, tone } = deltaState(value, goodWhen)
  const shown = formatNumber(Math.abs(value), Math.abs(value) < 10 ? 1 : 0)
  const spoken = dir === 'flat' ? 'Sin cambio' : dir === 'up' ? 'Sube' : 'Baja'
  return (
    <span className={`inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 text-label ${TONE[tone]}`}>
      <span className="num inline-flex items-center gap-1 font-medium">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0 self-center fill-current">
          {dir === 'up' ? <path d="M5 1.5 9 8H1z" /> : dir === 'down' ? <path d="M5 8.5 1 2h8z" /> : <rect x="1" y="4" width="8" height="2" rx="1" />}
        </svg>
        <span className="sr-only">{spoken} </span>
        <span>{`${dir === 'flat' ? '0' : shown}${unit ? ` ${unit}` : ''}`}</span>
      </span>
      {period ? <span className="text-muted">{period}</span> : null}
    </span>
  )
}
