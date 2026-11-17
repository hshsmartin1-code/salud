import { formatNumber } from '../../../domain/units'
import { deltaState } from '../../../ui/deltaLogic'
import { Metric } from '../../../ui/Metric'
import { SectionHeader } from '../../../ui/SectionHeader'
import { formatMinutes, type WeekSummary as Week } from '../trainingStats'
import { plural } from '../routines'
import { weekRange } from '../shared/format'

const thousands = (n: number) => formatNumber(Math.round(n), 0)

/**
 * Change against the previous week at the same point (a plain number through the app's formatter, thousands
 * separator included; the shared `Delta` strips it). Muted and without judgement: no percentage, no colour.
 */
function WeekDelta({ value, unit, period }: { value: number; unit?: string; period: string }) {
  const { dir } = deltaState(value)
  const spoken = dir === 'flat' ? 'Sin cambio' : dir === 'up' ? 'Sube' : 'Baja'
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 text-label text-muted">
      <span className="num inline-flex items-center gap-1 font-medium">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0 self-center fill-current">
          {dir === 'up' ? <path d="M5 1.5 9 8H1z" /> : dir === 'down' ? <path d="M5 8.5 1 2h8z" /> : <rect x="1" y="4" width="8" height="2" rx="1" />}
        </svg>
        <span className="sr-only">{spoken} </span>
        <span>{`${dir === 'flat' ? '0' : formatNumber(Math.abs(value), 0)}${unit ? ` ${unit}` : ''}`}</span>
      </span>
      <span>{period}</span>
    </span>
  )
}

/** "3 sesiones · 57 series · 22.246 kg" (the previous week in words, no judgement). */
export function weekLine(w: Week): string {
  return `${plural(w.sessions, 'sesión', 'sesiones')} · ${plural(w.workSets, 'serie', 'series')} · ${thousands(w.volume)} kg`
}

/**
 * Four condensed read-outs for the week with a neutral comparison.
 * `prev` is the previous week up to the same weekday as today (the week so far against the same stretch of the
 * last one) and `prevFull` the whole previous week. With no finished session this week there is nothing to
 * compare yet: no deltas, a line saying so and the last week as a reference.
 */
export function WeekReadouts({ week, prev, prevFull, today }: { week: Week; prev: Week; prevFull: Week; today: string }) {
  const cmp = week.sessions > 0 && prev.sessions > 0
  const period = 'vs. sem. anterior'
  const time = week.timedSessions > 0 ? formatMinutes(week.durationMin) : null
  const timeDelta = cmp && week.timedSessions > 0 && prev.timedSessions > 0 ? Math.round(week.durationMin - prev.durationMin) : null
  const partial = today < week.weekEnd
  let note: string | null
  if (week.sessions === 0) note = prevFull.sessions > 0 ? 'Aún no has entrenado esta semana.' : 'Aún no has entrenado esta semana. La semana anterior tampoco tuvo sesiones.'
  else if (prev.sessions === 0) note = prevFull.sessions > 0 ? 'En este punto de la semana pasada no habías entrenado: no hay con qué comparar.' : 'La semana anterior no tuvo sesiones: no hay con qué comparar.'
  else note = partial ? 'Comparado con la semana pasada hasta este mismo día.' : null
  return (
    <section aria-labelledby="week-title" data-testid="week-summary">
      <SectionHeader title={<span id="week-title">Esta semana</span>} hint={weekRange(week.weekStart, week.weekEnd)} />
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4" data-testid="week-readouts">
        <Metric label="Sesiones" value={week.sessions} size="lg" delta={cmp ? <WeekDelta value={week.sessions - prev.sessions} period={period} /> : undefined} />
        <Metric label="Series de trabajo" value={week.workSets} size="lg" delta={cmp ? <WeekDelta value={week.workSets - prev.workSets} period={period} /> : undefined} />
        <Metric label="Volumen" value={thousands(week.volume)} unit="kg" size="lg" delta={cmp ? <WeekDelta value={Math.round(week.volume - prev.volume)} unit="kg" period={period} /> : undefined} />
        <Metric
          label="Tiempo"
          value={time ? time.value : '—'}
          unit={time?.unit}
          size="lg"
          delta={timeDelta !== null ? <WeekDelta value={timeDelta} unit="min" period={period} /> : undefined}
          hint={
            week.sessions === 0 ? undefined : week.timedSessions === 0 ? 'Sin duración registrada' : week.untimedSessions > 0 ? `${week.timedSessions} de ${week.sessions} sesiones con duración` : undefined
          }
        />
      </div>
      {note ? (
        <p className="mt-4 text-label text-muted" data-testid="week-note">
          {note}
        </p>
      ) : null}
      {week.sessions === 0 && prevFull.sessions > 0 ? (
        <p className="mt-1 text-label text-muted" data-testid="week-reference">
          La semana pasada: {weekLine(prevFull)}
        </p>
      ) : null}
    </section>
  )
}
