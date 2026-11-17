import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import type { WeeklyTdeePoint } from './adaptive'

/**
 * Weekly evolution of the observed expenditure: one dot per week with its ±1.96·SE range (95 %),
 * against the formula estimate (dashed). Weeks without enough data are shown as empty slots.
 * It is an estimate from imperfect records, not a measurement.
 */
export function TdeeTrend({ points, formula }: { points: WeeklyTdeePoint[]; formula: number | null }) {
  const ok = points.filter((p) => p.status === 'ok' && p.observed !== null)
  if (ok.length < 2)
    return (
      <p className="text-xs text-muted" data-testid="tdee-trend-empty">
        La evolución semanal aparece cuando hay al menos dos semanas con datos suficientes ({ok.length} de 8 por ahora).
      </p>
    )
  const W = 320
  const H = 120
  const padL = 40
  const padR = 8
  const padT = 8
  const padB = 20
  const lows = ok.map((p) => (p.observed as number) - 1.96 * (p.observedSe ?? 0))
  const highs = ok.map((p) => (p.observed as number) + 1.96 * (p.observedSe ?? 0))
  let lo = Math.min(...lows, formula ?? Infinity)
  let hi = Math.max(...highs, formula ?? -Infinity)
  const pad = Math.max(50, (hi - lo) * 0.1)
  lo = Math.floor((lo - pad) / 100) * 100
  hi = Math.ceil((hi + pad) / 100) * 100
  const x = (i: number) => padL + ((i + 0.5) / points.length) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const ticks = [lo, Math.round((lo + hi) / 200) * 100, hi]
  const last = ok[ok.length - 1]!
  const label = `Gasto observado por semana: última estimación ${formatNumber(last.observed as number, 0)} kcal al ${formatDateEs(last.to)}${formula ? `; fórmula ${formatNumber(formula, 0)} kcal` : ''}.`
  return (
    <figure className="space-y-1.5" data-testid="tdee-trend">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-ink">Gasto observado por semana</span>
        <span className="text-faint">punto = estimación · barra = rango 95 %</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="rgb(var(--faint))" className="num">
              {formatNumber(t, 0)}
            </text>
          </g>
        ))}
        {formula ? <line x1={padL} x2={W - padR} y1={y(formula)} y2={y(formula)} stroke="rgb(var(--muted))" strokeWidth={1.25} strokeDasharray="4 3" /> : null}
        {points.map((p, i) =>
          p.status === 'ok' && p.observed !== null ? (
            <g key={p.to}>
              <title>{`${formatDateEs(p.to)}: ${formatNumber(p.observed, 0)} ± ${formatNumber(1.96 * (p.observedSe ?? 0), 0)} kcal (${p.validIntakeDays} días de comida, ${p.weighIns} pesajes)`}</title>
              <line x1={x(i)} x2={x(i)} y1={y(p.observed + 1.96 * (p.observedSe ?? 0))} y2={y(p.observed - 1.96 * (p.observedSe ?? 0))} stroke="rgb(var(--energy) / 0.45)" strokeWidth={6} strokeLinecap="round" />
              <circle cx={x(i)} cy={y(p.observed)} r={4} fill="rgb(var(--energy))" stroke="rgb(var(--surface))" strokeWidth={2} />
            </g>
          ) : (
            <g key={p.to}>
              <title>{`${formatDateEs(p.to)}: datos insuficientes`}</title>
              <circle cx={x(i)} cy={H - padB - 2} r={2} fill="rgb(var(--line-strong))" />
            </g>
          ),
        )}
        {points.map((p, i) =>
          i % 2 === 1 || i === points.length - 1 ? (
            <text key={'l' + p.to} x={x(i)} y={H - 5} textAnchor="middle" fontSize={11} fill="rgb(var(--faint))">
              {formatDateEs(p.to).replace(/ \d{4}$/, '')}
            </text>
          ) : null,
        )}
      </svg>
      <p className="text-[11px] leading-snug text-faint">Línea discontinua: estimación por fórmula. Cada punto usa la misma ventana y reglas que la estimación actual. Es una estimación a partir de tus registros, no una medición del metabolismo.</p>
    </figure>
  )
}
