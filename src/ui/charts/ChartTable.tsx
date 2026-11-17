import { useMemo } from 'react'
import { addDays, dayNum, defaultFormat, shortDate } from './geometry'
import { byDate, pointText, type Formatter } from './seriesUtil'
import type { Series } from './types'

/**
 * Table alternative to a chart: one row per day that has data in any series (latest first), 48 px rows,
 * sticky header, scrolls inside a fixed height. Previous-period series are left out.
 */
export function ChartTable({
  series,
  from,
  to,
  formatValue = defaultFormat,
  caption,
}: {
  series: Series[]
  from: string
  to: string
  formatValue?: Formatter
  caption?: string
}) {
  const cols = useMemo(() => series.filter((s) => s.role !== 'previous'), [series])
  const rows = useMemo(() => {
    const maps = cols.map(byDate)
    const out: { date: string; cells: string[] }[] = []
    for (let d = to; dayNum(d) >= dayNum(from); d = addDays(d, -1)) {
      if (!maps.some((m) => m.has(d))) continue
      out.push({
        date: d,
        cells: cols.map((s, i) => {
          const p = maps[i]!.get(d)
          return p ? pointText(s, p, formatValue) + (p.estimated ? ' (est.)' : '') : '—'
        }),
      })
    }
    return out
  }, [cols, from, to, formatValue])

  return (
    <div className="max-h-[288px] overflow-y-auto rounded-xl border border-line" data-testid="chart-table">
      <table className="w-full border-collapse text-left text-label">
        <caption className="sr-only">{caption ?? 'Valores por día'}</caption>
        <thead className="sticky top-0 bg-surface2 text-muted">
          <tr>
            <th scope="col" className="h-10 px-3 font-medium">
              Fecha
            </th>
            {cols.map((s) => (
              <th key={s.id} scope="col" className="h-10 px-3 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-rows">
          {rows.map((r) => (
            <tr key={r.date} className="h-12">
              <th scope="row" className="px-3 font-normal text-muted">
                {shortDate(r.date)}
              </th>
              {r.cells.map((c, i) => (
                <td key={cols[i]!.id} className="num px-3 text-right text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr className="h-12">
              <td colSpan={cols.length + 1} className="px-3 text-muted">
                Sin registros en este periodo
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
