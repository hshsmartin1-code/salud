/**
 * Salud overview: one period for everything (in the URL), quick logging in place, a large weight panel
 * and compact panels only for the metrics that have data in the period. Each panel opens its detail page
 * with the period kept.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { PageHeader } from '../../ui/kit'
import { PeriodPicker } from '../../ui/PeriodPicker'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { ChartTable } from '../../ui/charts/ChartTable'
import { ChartPanel } from '../../ui/charts/ChartPanel'
import { TimeSeriesChart } from '../../ui/charts/TimeSeriesChart'
import { useHealthInput, usePeriod } from './hooks'
import { metricDef, type MetricId } from './metrics'
import { OVERVIEW_ORDER, RECOVERY_SCALES, SHORT_TITLE, logTargetFor } from './panels'
import { PERIOD_OPTIONS, PRESET_WINDOW_DAYS, comparisonLabel, comparisonSentence, periodTitle, withPeriod, type ResolvedPeriod } from './period'
import { QuickLogBar, QuickLogHost, type QuickTarget } from './QuickLog'
import { buildSeries, weightHistory, type HealthInput } from './series'
import { buildView, chartSeries, figure, isLatestMetric, type MetricView } from './view'

/** Detail route of a metric, keeping the period and selecting its tab. */
export const detailLink = (id: MetricId, period: string) => withPeriod(metricDef(id).route, period, { m: id })

/** Latest value of a one-reading metric, with its unit ("36,6 °C"). */
const latestText = (v: MetricView): string => {
  const p = [...v.points].reverse().find((x) => x.value !== null)
  const f = figure(v.id, p?.value ?? null, { low: p?.low ?? null })
  return `${f.value} ${f.unit}`.trim()
}

/** The weight panel's one interpretation line: weekly trend and coverage, short and muted. */
function weightLine(v: MetricView): string {
  const { trendPerWeek, coverage, excludedToday } = v.summary
  const parts: string[] = []
  if (trendPerWeek !== null) {
    const x = Math.abs(trendPerWeek) < 0.05 ? 0 : trendPerWeek
    parts.push(`Tendencia ${x > 0 ? '+' : ''}${formatNumber(x, 1).replace('-', '−')} kg/sem`)
  }
  parts.push(`${coverage.days} de ${coverage.total} ${coverage.total === 1 ? 'día' : 'días'} con dato${excludedToday ? ' (sin hoy)' : ''}`)
  return parts.join(' · ')
}

const Chevron = () => <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />

const hasTrend = (input: HealthInput, id: MetricId, from: string, to: string) => buildSeries(id, input, from, to).filter((p) => p.value !== null).length >= 2

function compactTitle(v: MetricView): string {
  const base = SHORT_TITLE[v.id] ?? v.def.label
  if (RECOVERY_SCALES.includes(v.id)) return `${base} · autorreporte`
  return `${base} · ${isLatestMetric(v.id) ? 'último' : 'media'}`
}

function CompactPanel({ v, period }: { v: MetricView; period: ResolvedPeriod }) {
  const series = chartSeries(v, { group: 'day', compare: false, range: period.range, previous: period.previous })
  return (
    <ChartPanel
      size="compact"
      title={compactTitle(v)}
      to={detailLink(v.id, period.value)}
      value={v.main.value}
      unit={v.main.unit}
      delta={v.delta ? { ...v.delta, period: undefined } : undefined}
      period={periodTitle(period)}
      pointCount={v.count}
    >
      <TimeSeriesChart series={series} from={period.range.from} to={period.range.to} goal={v.goal ?? undefined} zeroBaseline={v.def.kind === 'bar'} maxGapDays={v.def.maxGapDays} ariaLabel={`${SHORT_TITLE[v.id] ?? v.def.label}, ${periodTitle(period).toLowerCase()}`} height={56} compact />
    </ChartPanel>
  )
}

export function HealthHubPage() {
  const [params, setParams] = useSearchParams()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const [target, setTarget] = useState<QuickTarget | null>(() => {
    const t = params.get('tipo')
    return t === 'peso' ? { kind: 'weight' } : t === 'agua' ? { kind: 'water' } : null
  })
  const closeTarget = (t: QuickTarget | null) => {
    setTarget(t)
    if (!t && params.get('tipo')) {
      const p = new URLSearchParams(params)
      p.delete('tipo')
      setParams(p, { replace: true })
    }
  }
  const comparison = comparisonLabel(period)

  const model = useMemo(() => {
    if (!input) return null
    const opts = { today, comparison }
    const make = (id: MetricId) => buildView(id, input, period.range, period.previous, opts)
    const weight = make('weight')
    const recoveryId = RECOVERY_SCALES.find((id) => buildSeries(id, input, period.range.from, period.range.to).some((p) => p.value !== null)) ?? 'energyScale'
    const ids = OVERVIEW_ORDER.map((id) => (id === 'energyScale' ? recoveryId : id))
    const views = ids.map(make)
    // A brand-new profile has no metric with two days of data in the whole loaded window.
    const windowFrom = addDays(today, -PRESET_WINDOW_DAYS)
    const brandNew = !['weight' as MetricId, ...ids].some((id) => hasTrend(input, id, windowFrom, today))
    const latest = weightHistory(input).at(-1)
    return {
      weight,
      // A chart needs two days with data; a single reading is listed with the metrics that have none.
      withData: views.filter((v) => v.count >= 2),
      single: views.filter((v) => v.count === 1),
      without: [...(weight.count === 0 ? [weight] : []), ...views.filter((v) => v.count === 0)],
      brandNew,
      latestWeight: latest && latest.value !== null ? { kg: latest.value, date: latest.date } : null,
    }
  }, [input, period, today, comparison])

  const title = periodTitle(period)
  const noneInPeriod = !!model && !model.brandNew && model.weight.count === 0 && model.withData.length === 0

  return (
    <>
      <PageHeader title="Salud" actions={<PeriodPicker value={period.value} onChange={setPeriod} options={PERIOD_OPTIONS} allowCustom />} />
      {model && !model.brandNew ? (
        <p className="-mt-3 mb-4 text-label text-muted" data-testid="hub-comparison">
          {comparisonSentence(period)}
        </p>
      ) : null}
      <div className="space-y-7" data-testid="health-hub">
        <QuickLogBar onOpen={setTarget} />

        {!model ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="hub-loading">
            <div className="col-span-2 lg:row-span-2">
              <ChartPanel title="Peso" value={null} unit="kg" period={title} loading>
                <span />
              </ChartPanel>
            </div>
            {Array.from({ length: 6 }, (_, i) => (
              <ChartPanel key={i} size="compact" title="Cargando" value={null} unit="" period={title} loading>
                <span />
              </ChartPanel>
            ))}
          </div>
        ) : model.brandNew ? (
          <section className="rounded-2xl border border-line bg-surface px-5 py-6" data-testid="hub-empty">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-muted">
              <Icon name="chart" size={20} />
            </div>
            <h2 className="text-heading text-ink">Tus tendencias aparecerán aquí</h2>
            <p className="mt-1 max-w-md text-body text-muted">Registra peso, agua, sueño o presión y verás tus gráficas desde el segundo día con dato.</p>
            {model.latestWeight ? (
              <p className="mt-3 text-label text-muted">
                Último peso registrado: <span className="num font-medium text-ink">{model.weight.main.value} kg</span>
              </p>
            ) : null}
          </section>
        ) : (
          <>
            {noneInPeriod ? <p className="text-body text-muted">Sin registros en este periodo.</p> : null}
            {model.weight.count > 0 || model.withData.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="hub-panels">
                {model.weight.count > 0 ? (
                  <div className="col-span-2 lg:row-span-2 [&>section]:h-full" data-testid="hub-weight">
                    <ChartPanel
                      title="Peso"
                      to={detailLink('weight', period.value)}
                      value={model.weight.main.value}
                      unit={model.weight.main.unit}
                      delta={model.weight.delta ? { ...model.weight.delta, period: undefined } : undefined}
                      period={`${model.weight.mainKind} · ${title}`}
                      pointCount={model.weight.count}
                      table={<ChartTable series={chartSeries(model.weight, { group: 'day', compare: false, range: period.range, previous: period.previous, label: 'Peso registrado' })} from={period.range.from} to={period.range.to} caption="Peso por día" />}
                    >
                      <TimeSeriesChart
                        series={chartSeries(model.weight, { group: 'day', compare: false, range: period.range, previous: period.previous, label: 'Peso registrado' })}
                        from={period.range.from}
                        to={period.range.to}
                        height={176}
                        maxGapDays={model.weight.def.maxGapDays}
                        ariaLabel={`Peso, ${title.toLowerCase()}, con tendencia calculada`}
                      />
                      <p className="mt-2 text-label text-muted" data-testid="weight-sentence">
                        {weightLine(model.weight)}
                      </p>
                    </ChartPanel>
                  </div>
                ) : null}
                {model.withData.map((v, i) => (
                  <div key={v.id} className={`min-w-0 [&>*]:h-full ${i === model.withData.length - 1 && model.withData.length % 2 === 1 ? 'col-span-2 lg:col-span-1' : ''}`}>
                    <CompactPanel v={v} period={period} />
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {model && !model.brandNew && model.single.length + model.without.length ? (
          <section aria-label="Otras medidas">
            <SectionHeader title="Otras medidas" />
            <div className="divide-rows mt-1" data-testid="hub-others">
              {model.single.map((v) => (
                <Row
                  key={v.id}
                  dense
                  title={SHORT_TITLE[v.id] ?? v.def.label}
                  trailing={
                    <>
                      <span className="num">{latestText(v)}</span>
                      <Chevron />
                    </>
                  }
                  to={detailLink(v.id, period.value)}
                />
              ))}
              {model.without.map((v) => {
                const t = logTargetFor(v.id)
                const name = SHORT_TITLE[v.id] ?? v.def.label
                const trailing = (
                  <>
                    <span className="text-label text-muted">Registrar</span>
                    <Chevron />
                  </>
                )
                return 'target' in t ? <Row key={v.id} dense title={name} trailing={trailing} onClick={() => setTarget(t.target)} /> : <Row key={v.id} dense title={name} trailing={trailing} to={t.to} />
              })}
            </div>
          </section>
        ) : null}

        <section aria-label="Más">
          <SectionHeader title="Más" />
          <div className="divide-rows mt-1">
            <Row dense title="Hábitos y suplementos" to={withPeriod('/habitos', period.value)} />
            <Row dense title="Fotos de progreso" to="/fotos" />
            <div data-testid="hub-health-connect">
              <Row dense title="Health Connect" to="/integraciones" />
            </div>
          </div>
        </section>
      </div>
      <QuickLogHost target={target} onTarget={closeTarget} latestWeight={model?.latestWeight ?? null} />
    </>
  )
}
