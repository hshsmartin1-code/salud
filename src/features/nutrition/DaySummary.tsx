import { Link } from 'react-router-dom'
import type { NutrientCode } from '../../db/catalogTypes'
import { formatNutrient } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/kit'
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
  const pct = budget && kcal ? Math.min(1, kcal / budget) : 0
  const R = 46
  const C = 2 * Math.PI * R
  return (
    <div className="card p-4" data-testid="day-summary">
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
            <circle cx="56" cy="56" r={R} fill="none" stroke="rgb(var(--surface2))" strokeWidth="10" />
            {budget ? (
              <circle
                cx="56"
                cy="56"
                r={R}
                fill="none"
                stroke={kcal !== undefined && kcal > budget * 1.05 ? 'rgb(var(--warn))' : 'rgb(var(--kcal))'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${C * pct} ${C}`}
                className="transition-[stroke-dasharray] duration-700"
              />
            ) : null}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-2xl font-bold leading-none" data-testid="kcal-total">
              {kcal === undefined ? (day.logs.length ? '—' : '0') : formatNutrient('kcal', kcal, false)}
            </span>
            <span className="mt-0.5 text-[11px] text-muted">kcal{partialKcal ? '*' : ''}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {budget !== null ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted">Objetivo</span>
              <span className="num text-sm font-semibold">{formatNumber(budget, 0)} kcal</span>
            </div>
          ) : (
            <Link to="/perfil" className="flex items-center gap-1 text-sm font-medium text-accent">
              <Icon name="target" size={16} /> Definir objetivos
            </Link>
          )}
          {remaining !== null ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted">{remaining >= 0 ? 'Restante' : 'Excedido'}</span>
              <span className={`num text-lg font-bold ${remaining < 0 ? 'text-warn' : 'text-accent'}`}>{formatNumber(Math.abs(remaining), 0)}</span>
            </div>
          ) : null}
          {day.activityKcal !== null ? (
            <div className="text-xs text-muted">
              Actividad: {formatNumber(day.activityKcal, 0)} kcal {day.goal && day.kcalBudget !== day.goal.kcal ? '(sumada)' : '(informativa)'}
            </div>
          ) : null}
        </div>
      </div>
      {!compact || day.goal ? (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {ROWS.map((row) => {
            const v = day.totals[row.code]
            const t = day.goal ? day.goal[row.target] : null
            return (
              <div key={row.code}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-medium">{row.es}</span>
                  <span className="num text-muted">
                    {v === undefined ? (day.logs.length ? '—' : '0') : formatNumber(v, 0)}
                    {day.partial.includes(row.code) ? '*' : ''}
                    {t !== null && t !== undefined ? ` / ${formatNumber(t, 0)} g` : ' g'}
                  </span>
                </div>
                <ProgressBar value={v} max={t ?? undefined} colorVar={row.color} />
              </div>
            )
          })}
        </div>
      ) : null}
      {day.partial.length ? (
        <p className="mt-3 text-[11px] text-faint">* Parcial: {day.partial.length} nutrientes sin dato en algún alimento; el total real puede ser mayor.</p>
      ) : null}
    </div>
  )
}
