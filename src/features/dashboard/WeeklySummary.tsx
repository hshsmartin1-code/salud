import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Delta } from '../../ui/Delta'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import type { Comparison } from './controlCenter'

const PERIOD = 'vs. semana previa'

/** `Delta`, except an exact zero reads in words. */
function Change({ value, unit, goodWhen }: { value: number; unit?: string; goodWhen?: 'up' | 'down' }) {
  if (value === 0) return <span className="text-muted">Igual que la semana previa</span>
  return <Delta value={value} unit={unit} period={PERIOD} goodWhen={goodWhen} />
}

function WeekRow({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="pt-0.5 text-body text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="num text-body font-semibold text-ink">
          {value}
          {unit ? <span className="ml-1 text-label font-normal text-muted">{unit}</span> : null}
        </span>
        <span className="block text-label">{sub}</span>
      </span>
    </div>
  )
}

/** Mean of a comparison; the delta only appears with enough days in both weeks (see `compare`). */
function CompareRow({ label, c, unit, deltaUnit, digits = 0, goodWhen }: { label: string; c: Comparison; unit: string; deltaUnit?: string; digits?: number; goodWhen?: 'up' | 'down' }) {
  if (c.current.mean === null) return <WeekRow label={label} value="—" sub={<span className="text-muted">Sin datos en estos 7 días</span>} />
  return (
    <WeekRow
      label={label}
      value={formatNumber(c.current.mean, digits)}
      unit={unit}
      sub={c.delta === null ? <span className="text-muted">{`${c.current.days}/${c.current.total} días · sin comparación`}</span> : <Change value={c.delta} unit={deltaUnit} goodWhen={goodWhen} />}
    />
  )
}

/**
 * Weekly summary: the last 7 complete days against the 7 before. A change is coloured only for metrics
 * that have a goal direction (protein, steps, sleep: more is better); the rest stays neutral.
 */
export function WeeklySummary({
  from,
  to,
  kcal,
  protein,
  steps,
  sleep,
  sessions,
  weight,
}: {
  from: string
  to: string
  kcal: Comparison
  protein: Comparison
  steps: Comparison
  sleep: Comparison
  sessions: { current: number; previous: number; volumeCurrent: number; volumePrevious: number }
  weight: { current: number | null; delta: number | null }
}) {
  // The two most relevant figures, in the closed row: the first two of energy, protein, steps, sleep that have data.
  const lead = [
    { c: kcal, unit: 'kcal/día', d: 0 },
    { c: protein, unit: 'g/día', d: 0 },
    { c: steps, unit: 'pasos/día', d: 0 },
    { c: sleep, unit: 'h/noche', d: 1 },
  ]
    .filter((x) => x.c.current.mean !== null)
    .slice(0, 2)
    .map((x) => `${formatNumber(x.c.current.mean as number, x.d)} ${x.unit}`)
  return (
    <section data-testid="range-stats">
      <Disclosure
        tone="section"
        testId="week-disclosure"
        summary={
          <span className="block min-w-0 text-left">
            <span className="block">Resumen de la semana</span>
            {lead.length ? <span className="block text-label font-normal text-muted">{lead.join(' · ')}</span> : null}
          </span>
        }
      >
      <p className="text-label text-muted">{`Últimos 7 días completos (${formatDateEs(from)} – ${formatDateEs(to)}) frente a los 7 anteriores. Medias de días con datos; comparación desde 3 días por semana.`}</p>
      <div className="divide-rows mt-1">
        <CompareRow label="Energía consumida" c={kcal} unit="kcal/día" deltaUnit="kcal" />
        <CompareRow label="Proteína" c={protein} unit="g/día" deltaUnit="g" goodWhen="up" />
        <CompareRow label="Pasos" c={steps} unit="/día" goodWhen="up" />
        <CompareRow label="Sueño" c={sleep} unit="h/noche" deltaUnit="h" digits={1} goodWhen="up" />
        <WeekRow
          label="Entrenamiento"
          value={sessions.current}
          unit={sessions.current === 1 ? 'sesión' : 'sesiones'}
          sub={
            <>
              {sessions.previous > 0 ? <Change value={sessions.current - sessions.previous} /> : <span className="text-muted">Sin sesiones la semana previa</span>}
              {sessions.current > 0 || sessions.volumeCurrent > 0 ? <span className="block text-muted">{`${formatNumber(sessions.volumeCurrent, 0)} kg de volumen${sessions.previous > 0 ? ` (antes ${formatNumber(sessions.volumePrevious, 0)} kg)` : ''}`}</span> : null}
            </>
          }
        />
        <WeekRow
          label="Peso (tendencia)"
          value={weight.current !== null ? formatNumber(weight.current, 1) : '—'}
          unit={weight.current !== null ? 'kg' : undefined}
          sub={weight.delta !== null ? <Change value={weight.delta} unit="kg" /> : <span className="text-muted">Se necesitan pesos en ambas semanas</span>}
        />
      </div>
      <Link to="/progreso" className="btn-ghost mt-1 w-full text-label">
        <Icon name="chart" size={16} /> Ver gráficas de progreso
      </Link>
      </Disclosure>
    </section>
  )
}
