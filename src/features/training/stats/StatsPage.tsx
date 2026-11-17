import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays } from '../../../domain/dates'
import { formatNumber } from '../../../domain/units'
import { Icon } from '../../../ui/Icon'
import { Meter } from '../../../ui/Meter'
import { Row } from '../../../ui/Row'
import { SectionHeader } from '../../../ui/SectionHeader'
import { Skeleton } from '../../../ui/Skeleton'
import { EmptyState, PageHeader, Segmented } from '../../../ui/kit'
import { ChartPanel } from '../../../ui/charts/ChartPanel'
import { TimeSeriesChart } from '../../../ui/charts/TimeSeriesChart'
import type { Series } from '../../../ui/charts/types'
import { useDesktop } from '../../nutrition/useDesktop'
import { exercisePath } from '../exerciseKnowledge'
import { groupLabel } from '../muscles'
import { plural } from '../routines'
import { shortDay } from '../shared/format'
import { useTrainingData } from '../shared/useTrainingData'
import {
  allRecords,
  bestLifts,
  headlineRecords,
  minutesText,
  recentRecords,
  trainingTotals,
  weeklySeries,
  weeklyVolumeMean,
  workSetsPerGroupRange,
  type TrainingTotals,
  type WeekSummary,
} from '../trainingStats'

const WEEKS = 12
const SECTION = 'border-t border-line pt-6'

type Metric = 'duration' | 'volume' | 'sets'
const METRICS: Record<Metric, { label: string; unit: string; title: string; of: (w: WeekSummary) => number; aria: string }> = {
  duration: { label: 'Duración', unit: 'min', title: 'Duración por semana', of: (w) => Math.round(w.durationMin), aria: 'Duración semanal en minutos' },
  volume: { label: 'Volumen', unit: 'kg', title: 'Volumen por semana', of: (w) => Math.round(w.volume), aria: 'Volumen semanal en kilogramos' },
  sets: { label: 'Series', unit: 'series', title: 'Series por semana', of: (w) => w.workSets, aria: 'Series de trabajo por semana' },
}

const kg = (n: number) => `${formatNumber(Math.round(n), 0)} kg`
const duration = (min: number) => (min > 0 ? minutesText(min) : '—')

/**
 * Weekly bars with a metric switch (Duración, Volumen, Series). The week in progress is drawn but marked as
 * such and kept out of the mean (complete weeks only).
 */
function WeeklyChart({ weeks, today }: { weeks: WeekSummary[]; today: string }) {
  const [metric, setMetric] = useState<Metric>('volume')
  const desktop = useDesktop()
  const m = METRICS[metric]
  const data = useMemo<Series[]>(
    () => [
      {
        id: `week-${metric}`,
        label: m.title,
        unit: m.unit,
        colorVar: 'train',
        kind: 'bar',
        points: weeks.map((w) =>
          w.weekEnd >= today && w.weekStart <= today ? { date: w.weekStart, value: m.of(w), span: 7, estimated: true, source: 'Semana en curso' } : { date: w.weekStart, value: m.of(w), span: 7 },
        ),
      },
    ],
    [weeks, today, metric, m],
  )
  const { complete, inProgress, trained } = weeklyVolumeMean(weeks, today)
  const mean = complete.length ? complete.reduce((a, w) => a + m.of(w), 0) / complete.length : null
  return (
    <section aria-labelledby="stats-weekly" data-testid="stats-weekly">
      <h2 id="stats-weekly" className="sr-only">
        Entrenamiento por semana
      </h2>
      <Segmented ariaLabel="Qué medir" value={metric} onChange={setMetric} options={(Object.keys(METRICS) as Metric[]).map((k) => ({ value: k, label: METRICS[k].label }))} />
      <div className="mt-3">
        <ChartPanel
          title={m.title}
          value={mean === null ? '—' : formatNumber(Math.round(mean), 0)}
          unit={mean === null ? '' : `${m.unit} de media`}
          period={`Últimas ${complete.length} ${complete.length === 1 ? 'semana completa' : 'semanas completas'}`}
          coverage={`${plural(trained, 'semana', 'semanas')} con entreno de ${complete.length}${inProgress ? ' · la semana en curso se dibuja pero no entra en la media' : ''}`}
          pointCount={weeks.length}
        >
          <TimeSeriesChart series={data} from={weeks[0]!.weekStart} to={weeks[weeks.length - 1]!.weekEnd} height={desktop ? 220 : 150} integerTicks ariaLabel={m.aria} />
        </ChartPanel>
      </div>
    </section>
  )
}

const COLS = 'grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]'

function TotalsTable({ year, all }: { year: TrainingTotals; all: TrainingTotals }) {
  const rows = [
    ['sessions', 'Entrenamientos', String(year.sessions), String(all.sessions)],
    ['duration', 'Duración', duration(year.durationMin), duration(all.durationMin)],
    ['volume', 'Peso levantado', kg(year.volume), kg(all.volume)],
  ] as const
  return (
    <section aria-labelledby="stats-totals" data-testid="stats-totals">
      <SectionHeader title={<span id="stats-totals">Totales</span>} />
      <div className={`mt-3 grid ${COLS} items-center gap-x-3 text-label text-muted`} aria-hidden>
        <span />
        <span className="text-right">Este año</span>
        <span className="text-right">Todo el tiempo</span>
      </div>
      <dl className="divide-rows mt-1">
        {rows.map(([k, label, a, b]) => (
          <div key={k} className={`grid min-h-[52px] ${COLS} items-center gap-x-3`}>
            <dt className="truncate text-body text-ink">{label}</dt>
            <dd className="readout min-w-0 truncate text-right text-[19px] leading-none text-ink">
              <span className="sr-only">Este año: </span>
              <span data-testid={`total-year-${k}`}>{a}</span>
            </dd>
            <dd className="readout min-w-0 truncate text-right text-[19px] leading-none text-ink">
              <span className="sr-only">Todo el tiempo: </span>
              <span data-testid={`total-all-${k}`}>{b}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Training statistics on their own screen (/entreno/estadisticas): nothing here is needed to train. */
export function StatsPage() {
  const { prepared, ex, today } = useTrainingData()

  const view = useMemo(() => {
    if (!prepared) return null
    const records = allRecords(prepared)
    return {
      weeks: weeklySeries(prepared, today, WEEKS),
      year: trainingTotals(prepared, `${today.slice(0, 4)}-01-01`, today),
      all: trainingTotals(prepared),
      lifts: bestLifts(prepared, 5),
      recent: headlineRecords(recentRecords(prepared, records, today, 30), 6),
      groups: workSetsPerGroupRange(prepared, addDays(today, -27), today, ex.byId),
    }
  }, [prepared, today, ex.byId])

  if (!view || !(ex.ready || ex.error)) {
    return (
      <>
        <PageHeader title="Estadísticas" back="/entreno" />
        <Skeleton lines={6} label="Cargando estadísticas" />
      </>
    )
  }
  const { weeks, year, all, lifts, recent, groups } = view
  if (!all.sessions) {
    return (
      <>
        <PageHeader title="Estadísticas" back="/entreno" />
        <div data-testid="stats-empty">
          <EmptyState icon="chart" title="Aún no hay estadísticas">
            Termina tu primer entrenamiento y aquí verás la evolución por semana, tus totales, tus mejores levantamientos y tus récords.{' '}
            <Link to="/entreno" className="underline underline-offset-2">
              Volver a Entreno
            </Link>
          </EmptyState>
        </div>
      </>
    )
  }
  const maxGroup = Math.max(1, ...groups.map((g) => g.sets))
  return (
    <>
      <PageHeader title="Estadísticas" back="/entreno" subtitle={plural(all.sessions, 'entrenamiento terminado', 'entrenamientos terminados')} />
      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10 lg:gap-y-6 lg:space-y-0" data-testid="stats-page">
        {weeks.length >= 2 ? <WeeklyChart weeks={weeks} today={today} /> : null}

        <div className={weeks.length >= 2 ? `${SECTION} lg:border-t-0 lg:pt-0` : ''}>
          <TotalsTable year={year} all={all} />
        </div>

        {lifts.length ? (
          <section className={SECTION} aria-labelledby="stats-lifts" data-testid="best-lifts">
            <SectionHeader title={<span id="stats-lifts">Mejores levantamientos</span>} hint="Mayor peso en una serie de trabajo" />
            <ul className="divide-rows mt-2">
              {lifts.map((l) => (
                <li key={l.exerciseId}>
                  <Row to={exercisePath(l.exerciseId)} title={l.exerciseName} subtitle={shortDay(l.date)} trailing={`${formatNumber(l.weight, 2)} kg${l.reps ? ` × ${l.reps}` : ''}`} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={SECTION} aria-labelledby="stats-records" data-testid="stats-records">
          <SectionHeader title={<span id="stats-records">Récords recientes</span>} hint="Últimos 30 días" />
          {recent.length ? (
            <ul className="divide-rows mt-2" data-testid="recent-records">
              {recent.map((rec) => (
                <li key={rec.setId + rec.type}>
                  <Row to={exercisePath(rec.exerciseId)} leading={<Icon name="trophy" size={20} className="text-warn" />} title={rec.exerciseName} subtitle={`${rec.label} · ${shortDay(rec.date)}`} trailing={rec.display} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-body text-muted" data-testid="stats-records-empty">
              Sin récords en los últimos 30 días.
            </p>
          )}
        </section>

        <section className={SECTION} aria-labelledby="stats-groups" data-testid="stats-groups">
          <SectionHeader title={<span id="stats-groups">Series por grupo muscular</span>} hint="Últimas 4 semanas · series de trabajo del músculo principal" />
          {groups.length ? (
            <ul className="mt-4 space-y-3" data-testid="group-bars">
              {groups.map((g) => (
                <li key={g.group} className="grid grid-cols-[84px_1fr_32px] items-center gap-3">
                  <span className="truncate text-body text-ink">{groupLabel(g.group)}</span>
                  <Meter value={g.sets} max={maxGroup} colorVar="train" variant="bar" label={`${groupLabel(g.group)}: ${g.sets} series de trabajo en las últimas 4 semanas`} />
                  <span className="num text-right text-body text-ink">{g.sets}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-body text-muted" data-testid="group-bars-empty">
              Sin series de trabajo en las últimas 4 semanas.
            </p>
          )}
        </section>
      </div>
    </>
  )
}
