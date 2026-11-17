import { Link } from 'react-router-dom'
import { formatNumber } from '../../domain/units'
import { RingStack } from '../../ui/charts'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { SectionHeader } from '../../ui/SectionHeader'
import { dayLabel, dayRings } from './daySummaryRings'

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : formatNumber(n, d))

/** What is left of a target, in words ("Faltan 61 g"); never a judgement. */
export function remaining(value: number | null, target: number | null, unit: string): string {
  if (!target) return 'Sin objetivo'
  if (value === null) return 'Sin datos'
  const left = target - value
  if (Math.abs(left) < 0.5) return 'Objetivo alcanzado'
  const n = [formatNumber(Math.abs(left), 0), unit].filter(Boolean).join(' ')
  return left > 0 ? `Faltan ${n}` : `${n} por encima`
}

function Line({
  colorVar,
  label,
  value,
  target,
  unit,
  shownUnit = unit,
  testId,
  bare = false,
}: {
  colorVar: string
  label: string
  value: number | null
  target: number | null
  unit: string
  shownUnit?: string
  testId?: string
  /** No goal and no ring: only the figure with its unit; the dot stays as an invisible spacer so the labels align and no «remaining» filler. */
  bare?: boolean
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 text-label text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={bare ? undefined : { background: `rgb(var(--${colorVar}))` }} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        {bare ? null : <span className="shrink-0">{target ? remaining(value, target, '') : 'Sin objetivo'}</span>}
      </div>
      {value === null ? (
        <div className="text-body text-muted">Sin datos hoy</div>
      ) : (
        <div className="readout truncate text-readout text-ink">
          {fmt(value)}
          <span className="ml-1 text-label font-medium tracking-normal text-muted">{target ? `/ ${formatNumber(target, 0)} ${shownUnit}`.trim() : shownUnit}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Today's rings, each paired with consumed / target and what is left. Flat on the page. Steps get a ring only
 * with a step goal; without one the line is just the figure («329 pasos»).
 */
export function DaySummary({
  kcal,
  kcalTarget,
  protein,
  proteinTarget,
  steps,
  stepGoal,
  footnote,
  partialWarning,
}: {
  kcal: number | null
  kcalTarget: number | null
  protein: number | null
  proteinTarget: number | null
  steps: number | null
  stepGoal: number | null
  /** Where each figure comes from: advanced level, folded. */
  footnote: string
  partialWarning: boolean
}) {
  const day = { kcal, kcalTarget, protein, proteinTarget, steps, stepGoal }
  const rings = dayRings(day)
  const stepsRing = rings.some((r) => r.key === 'move')
  return (
    <section aria-labelledby="hoy-title" data-testid="day-summary">
      <SectionHeader
        title={<span id="hoy-title">Tu día</span>}
        action={
          <Link to="/comida" className="-my-2.5 inline-flex min-h-11 items-center gap-0.5 text-label font-medium text-accent">
            Diario <Icon name="chevronRight" size={16} />
          </Link>
        }
      />
      <div className="mt-1 flex items-center gap-4">
        <RingStack size={stepsRing ? 104 : 92} stroke={stepsRing ? 10 : 11} label={dayLabel(day)} rings={rings} />
        <div className="grid min-w-0 flex-1 gap-2">
          <Line colorVar="energy" label="Energía" value={kcal} target={kcalTarget} unit="kcal" testId="hero-kcal" />
          <Line colorVar="protein" label="Proteína" value={protein} target={proteinTarget} unit="g" />
          <Line colorVar="move" label="Pasos" value={steps} target={stepsRing ? stepGoal : null} unit="" shownUnit={stepsRing ? '' : 'pasos'} bare={!stepsRing} testId="hero-steps" />
        </div>
      </div>
      {partialWarning ? <p className="mt-2 text-label text-warn">Resumen parcial: faltan nutrientes en algunos alimentos.</p> : null}
      <Disclosure summary="De dónde salen estos datos" testId="day-sources">
        <p className="text-label text-muted">{footnote}</p>
      </Disclosure>
    </section>
  )
}
