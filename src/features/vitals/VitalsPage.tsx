import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { VitalKind, VitalSign } from '../../db/types'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { BP_SOURCE, DISCLAIMER, GLUCOSE_CONTEXTS, VITAL_LABEL, VITAL_UNIT, classifyVital, latestByKind, sortVitalsDesc } from '../../domain/vitals'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Badge, Segmented } from '../../ui/kit'
import { Metric } from '../../ui/Metric'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { hcRowsFor, HealthRows, originLabel } from '../health/HealthRows'
import { useHealthInput, usePeriod, useQueryChoice } from '../health/hooks'
import { MetricBlock, MetricDetail } from '../health/MetricDetail'
import type { MetricId } from '../health/metrics'
import type { SeriesOptions } from '../health/series'
import { ClassificationNote, VITAL_SHORT, VitalSheet } from './VitalSheet'

const KINDS: readonly VitalKind[] = ['bloodPressure', 'restingHr', 'glucose', 'spo2', 'temperature']
const TABS = KINDS.map((k) => ({ value: k, label: VITAL_SHORT[k] === 'Temp.' ? 'Temperatura' : VITAL_SHORT[k] === 'Pulso' ? 'FC en reposo' : VITAL_SHORT[k] }))

export function valueText(v: VitalSign): string {
  if (v.kind === 'bloodPressure') return v.systolic != null && v.diastolic != null ? `${v.systolic}/${v.diastolic}` : '—'
  if (v.value == null) return '—'
  return formatNumber(v.value, v.kind === 'temperature' ? 1 : 0)
}

type CtxFilter = 'todas' | (typeof GLUCOSE_CONTEXTS)[number]['value']
const CTX_OPTIONS: readonly { value: CtxFilter; label: string }[] = [{ value: 'todas', label: 'Todas' }, ...GLUCOSE_CONTEXTS]

export function VitalsPage() {
  const r = useRepo()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const [kind, setKind] = useQueryChoice<VitalKind>('m', KINDS, 'bloodPressure')
  const [ctx, setCtx] = useState<CtxFilter>('todas')
  const rows = useLiveQuery(() => r.all('vitals'), [r])
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<VitalSign | null>(null)
  const sorted = useMemo(() => sortVitalsDesc(rows ?? []), [rows])
  const latest = useMemo(() => latestByKind(sorted), [sorted])
  const v = latest[kind]
  const cls = v ? classifyVital(v) : null
  const seriesOptions = useMemo<SeriesOptions | undefined>(() => (kind === 'glucose' && ctx !== 'todas' ? { context: ctx } : undefined), [kind, ctx])
  const inPeriod = useMemo(() => sorted.filter((x) => x.kind === kind && x.date >= period.range.from && x.date <= period.range.to && (kind !== 'glucose' || ctx === 'todas' || x.context === ctx)), [sorted, kind, period, ctx])
  const groups = useMemo(() => {
    const m = new Map<string, VitalSign[]>()
    for (const x of inPeriod.slice(0, 400)) m.set(x.date, [...(m.get(x.date) ?? []), x])
    return [...m.entries()]
  }, [inPeriod])
  const close = () => {
    setOpen(false)
    setEdit(null)
  }
  const metricId: MetricId = kind

  return (
    <>
      <MetricDetail
        testId="vitals-page"
        title="Signos vitales"
        period={period}
        onPeriod={setPeriod}
        tabs={TABS}
        tab={kind}
        onTab={setKind}
        tabsLabel="Signos vitales"
        action={
          <button className="btn-primary px-3" onClick={() => setOpen(true)} data-testid="new-vital">
            <Icon name="plus" size={18} /> Registrar
          </button>
        }
      >
        {rows && rows.length === 0 ? (
          <section className="rounded-2xl border border-line bg-surface px-5 py-6">
            <h2 className="text-heading text-ink">Aún no hay signos vitales</h2>
            <p className="mt-1 max-w-md text-body text-muted">Anota presión, pulso, saturación, glucosa o temperatura y verás el último valor y la tendencia.</p>
            <button className="btn-primary mt-4" onClick={() => setOpen(true)}>
              <Icon name="plus" size={18} /> Registrar el primero
            </button>
          </section>
        ) : null}

        {rows && rows.length > 0 ? (
          <>
            {kind === 'glucose' ? <Segmented ariaLabel="Contexto de la glucosa" size="sm" value={ctx} onChange={setCtx} options={CTX_OPTIONS} /> : null}
            <MetricBlock
              id={metricId}
              input={input}
              period={period}
              today={today}
              seriesOptions={seriesOptions}
              label={VITAL_LABEL[kind]}
              title={kind === 'bloodPressure' ? 'Presión arterial (sistólica / diastólica)' : VITAL_LABEL[kind]}
              pointNote={(date, view) => {
                const p = view.points.find((x) => x.date === date)
                return p && p.low !== undefined && p.high !== undefined ? `Sistólica ${formatNumber(p.high, 0)} · diastólica ${formatNumber(p.low, 0)} mmHg` : null
              }}
              emptyAction={
                <button className="btn-secondary" onClick={() => setOpen(true)}>
                  Registrar {VITAL_SHORT[kind].toLowerCase()}
                </button>
              }
              footnote={(view) =>
                kind === 'glucose' && ctx === 'todas' && view.summary.contexts.includes('mixto') ? (
                  <p className="mt-1 text-label text-muted" data-testid="glucose-mixed-note">
                    Algunos días tienen lecturas de contextos distintos (por ejemplo ayunas y posprandial): ese día se muestra su promedio, marcado como mezclado. Filtra por contexto para compararlas por separado.
                  </p>
                ) : null
              }
            />
            <section aria-label="Último valor" data-testid={`vital-card-${kind}`}>
              <SectionHeader title="Último registro" />
              {v ? (
                <div className="mt-2">
                  <Metric
                    label={`${VITAL_LABEL[kind]} · ${formatDateEs(v.date)}${v.time ? ` · ${v.time}` : ''}`}
                    value={valueText(v)}
                    unit={VITAL_UNIT[kind]}
                    hint={`${v.context ? `${v.context} · ` : ''}${originLabel(v.origin)}`}
                    size="lg"
                  />
                  {cls ? <ClassificationNote c={cls} /> : null}
                </div>
              ) : (
                <p className="mt-2 text-body text-muted">Sin registros de {VITAL_SHORT[kind].toLowerCase()}.</p>
              )}
            </section>
            <Disclosure summary="Cómo se calcula" testId="vital-how">
              <p className="text-label text-muted">
                Las clasificaciones son orientativas, no un diagnóstico (presión: {BP_SOURCE}; glucosa en ayunas: ADA). {DISCLAIMER}
              </p>
            </Disclosure>
          </>
        ) : null}

        {groups.length ? (
          <div className="space-y-4" data-testid="vitals-list">
            {groups.map(([date, items]) => (
              <section key={date} aria-label={formatDateEs(date, 'long')}>
                <h2 className="text-label font-medium text-muted">{formatDateEs(date, 'weekday')}</h2>
                <div className="divide-rows">
                  {items.map((x) => {
                    const c = classifyVital(x)
                    return (
                      <Row
                        key={x.id}
                        onClick={() => setEdit(x)}
                        ariaLabel={`${VITAL_LABEL[x.kind]}${x.time ? ` ${x.time}` : ''} ${valueText(x)} ${VITAL_UNIT[x.kind]}`}
                        title={x.time ?? 'Sin hora'}
                        subtitle={[x.context, x.notes, originLabel(x.origin)].filter(Boolean).join(' · ')}
                        trailing={
                          <>
                            {c ? <Badge tone={c.tone}>{c.label}</Badge> : null}
                            <span className="readout text-heading">
                              {valueText(x)}
                              <span className="ml-1 text-label font-medium text-muted">{VITAL_UNIT[x.kind]}</span>
                            </span>
                          </>
                        }
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : rows && rows.length > 0 ? (
          <p className="text-body text-muted">No hay registros de {VITAL_LABEL[kind].toLowerCase()} en este periodo.</p>
        ) : null}
        {input && kind === 'restingHr' ? <HealthRows rows={hcRowsFor(input.health, ['restingHr'], period.range)} /> : null}
      </MetricDetail>
      <VitalSheet open={open || !!edit} existing={edit} onClose={close} initialKind={kind} />
    </>
  )
}
