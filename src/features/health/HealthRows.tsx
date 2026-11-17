/**
 * Read-only Health Connect rows for the detail lists (same source rules as the charts: imported data is
 * shown with its source and is never edited here; review and exclusion live in Health Connect).
 */
import { useState } from 'react'
import type { HealthMetric, HealthRecord } from '../../db/types'
import { formatDateEs } from '../../domain/dates'
import { rowSubtitle, rowTitle } from '../../integrations/health-connect/format'
import { Icon } from '../../ui/Icon'
import { Row } from '../../ui/Row'
import type { DateRange } from './series'

/** Usable (not excluded) Health Connect rows of the given metrics inside the range, newest first. */
export function hcRowsFor(health: readonly HealthRecord[], metrics: readonly HealthMetric[], range: DateRange): HealthRecord[] {
  return health
    .filter((h) => h.provider === 'health-connect' && !h.excluded && h.value !== null && metrics.includes(h.metric) && h.date >= range.from && h.date <= range.to)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? '').localeCompare(a.start ?? ''))
}

export function HealthRows({ rows, limit = 30 }: { rows: readonly HealthRecord[]; limit?: number }) {
  if (!rows.length) return null
  return (
    <div data-testid="hc-rows">
      <div className="divide-rows">
        {rows.slice(0, limit).map((h) => (
          <Row key={h.id} dense leading={<Icon name="link" size={18} />} title={rowTitle(h)} subtitle={`Health Connect · ${rowSubtitle(h, (d) => formatDateEs(d, 'weekday'))}`} trailing={null} />
        ))}
      </div>
      {rows.length > limit ? <p className="mt-2 text-label text-muted">Se muestran {limit} de {rows.length} registros importados.</p> : null}
    </div>
  )
}

export const originLabel = (origin: string | undefined): string => (origin === 'phase0' ? 'Importado' : 'Manual')

/** Long lists show their first rows and a button for the rest. */
export function useLimit(total: number, initial = 12): { shown: number; more: React.ReactNode } {
  const [all, setAll] = useState(false)
  const shown = all ? total : Math.min(total, initial)
  const more =
    total > initial ? (
      <button type="button" className="btn-ghost mt-1 w-full" onClick={() => setAll((v) => !v)} data-testid="list-more">
        {all ? 'Ver menos' : `Ver los ${total} registros`}
      </button>
    ) : null
  return { shown, more }
}
