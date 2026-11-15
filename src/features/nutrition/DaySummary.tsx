import { Link } from 'react-router-dom'
import type { NutrientCode } from '../../db/catalogTypes'
import { formatNutrient } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { ScaleBar } from '../../ui/kit'
import type { DayNutrition } from './useDayNutrition'

const ROWS: { code: NutrientCode; es: string; color: string; target: 'protein' | 'carbs' | 'fat' | 'fiber' }[] = [
  { code: 'protein', es: 'Proteína', color: 'protein', target: 'protein' },
  { code: 'carbs', es: 'Carbohidratos', color: 'carbs', target: 'carbs' },
  { code: 'fat', es: 'Grasa', color: 'fat', target: 'fat' },
  { code: 'fiber', es: 'Fibra', color: 'fiber', target: 'fiber' },
]

/** Consumed vs target for one day. Targets come only from the stored goal. */
export function DaySummary({ day, compact = false }: { day: DayNutrition; compact?: boolean }) {
  const kcal = day.totals.kcal
  const budget = day.kcalBudget
  const remaining = budget !== null && kcal !== undefined ? budget - kcal : budget
  const partialKcal = day.partial.includes('kcal')
  const over = remaining !== null && remaining < 0
  return (
    <div className="card p-4 sm:p-5" data-testid="day-summary">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-muted">Energía consumida</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="readout text-[52px] sm:text-[60px]" data-testid="kcal-total">
              {kcal === undefined ? (day.logs.length ? '—' : '0') : formatNutrient('kcal', kcal, false)}
            </span>
            <span className="text-sm text-muted">
              {budget !== null ? <>de <span className="num font-semibold text-ink">{formatNumber(budget, 0)}</span> kcal</> : 'kcal'}
              {partialKcal ? '*' : ''}
            </span>
          </div>
        </div>
        {remaining !== null ? (
          <div className="shrink-0 text-right">
            <div className={`flex items-center justify-end gap-1 text-[13px] font-medium ${over ? 'text-warn' : 'text-muted'}`}>
              {over ? <Icon name="alert" size={14} /> : null}
              {over ? 'Excedido' : 'Restante'}
            </div>
            <div className={`readout mt-1.5 text-[32px] ${over ? 'text-warn' : ''}`}>{formatNumber(Math.abs(remaining), 0)}</div>
          </div>
        ) : (
          <Link to="/perfil" className="btn-secondary shrink-0 px-3 text-sm">
            <Icon name="target" size={16} /> Definir objetivos
          </Link>
        )}
      </div>
      {budget !== null ? (
        <div className="mt-3">
          <ScaleBar value={kcal} target={budget} label="Energía frente al objetivo" />
        </div>
      ) : null}
      {day.activityKcal !== null ? (
        <div className="mt-2 text-xs text-muted">
          Actividad: {formatNumber(day.activityKcal, 0)} kcal {day.goal && day.kcalBudget !== day.goal.kcal ? '(sumada al objetivo)' : '(informativa, no se suma)'}
        </div>
      ) : null}
      {!compact || day.goal ? (
        <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          {ROWS.map((row) => {
            const v = day.totals[row.code]
            const t = day.goal ? day.goal[row.target] : null
            return (
              <div key={row.code} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] text-muted">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: `rgb(var(--${row.color}))` }} aria-hidden />
                  {row.es}
                </div>
                <div className="mb-1.5 mt-1 flex items-baseline gap-1">
                  <span className="readout text-[22px]">
                    {v === undefined ? (day.logs.length ? '—' : '0') : formatNumber(v, 0)}
                    {day.partial.includes(row.code) ? '*' : ''}
                  </span>
                  <span className="num text-xs text-muted">{t !== null && t !== undefined ? `/ ${formatNumber(t, 0)} g` : 'g'}</span>
                </div>
                <ScaleBar value={v} target={t ?? undefined} colorVar={row.color} height={6} label={row.es} />
              </div>
            )
          })}
        </div>
      ) : null}
      {day.partial.length ? (
        <p className="mt-4 text-xs text-faint">* Parcial: {day.partial.length} nutrientes sin dato en algún alimento; el total real puede ser mayor.</p>
      ) : null}
    </div>
  )
}
