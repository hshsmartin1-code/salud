import type { Series } from './types'

const col = (v: string) => `rgb(var(--${v}))`

function Mark({ s }: { s: Series }) {
  const c = s.role === 'previous' ? col('muted') : col(s.colorVar)
  const isLine = s.role === 'trend' || s.role === 'previous' || (s.kind === 'line')
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true" className="shrink-0">
      {isLine ? (
        <line x1="1" x2="15" y1="5" y2="5" stroke={c} strokeWidth={s.role === 'previous' ? 1 : 2} strokeLinecap="round" />
      ) : s.kind === 'dots' ? (
        <circle cx="8" cy="5" r="4" fill={c} />
      ) : (
        <rect x="4" y="1" width="8" height="8" rx="2" fill={c} />
      )}
    </svg>
  )
}

/** Compact legend row: a mark sample plus the label in muted text (text never takes the series colour). */
const RANK = { measured: 0, trend: 1, previous: 2 } as const

export function ChartLegend({ series }: { series: Series[] }) {
  const ordered = [...series].sort((a, b) => RANK[a.role ?? 'measured'] - RANK[b.role ?? 'measured'])
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted" aria-label="Leyenda">
      {ordered.map((s) => (
        <li key={s.id} className="inline-flex items-center gap-1.5">
          <Mark s={s} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}
