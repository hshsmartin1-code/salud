import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import type { BodyMeasurement } from '../../db/types'
import { bmi, whtr } from '../../domain/bodycomp'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Segmented } from '../../ui/kit'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { useHealthInput, usePeriod, useQueryChoice } from '../health/hooks'
import { hcRowsFor, HealthRows, originLabel, useLimit } from '../health/HealthRows'
import { MetricBlock, MetricDetail } from '../health/MetricDetail'
import { QuickLogHost, type QuickTarget } from '../health/QuickLog'
import { splitByMethod, weightHistory, type HealthInput } from '../health/series'
import type { MetricId } from '../health/metrics'

export { MeasurementEditor } from './MeasurementEditor'

type Tab = 'weight' | 'waist' | 'bodyFat' | 'lean'
type LeanId = 'leanMass' | 'fatMass' | 'ffmi'
const TABS: readonly Tab[] = ['weight', 'waist', 'bodyFat', 'lean']
/** `?m=` values that point inside a tab (the overview links with the metric id). */
const TAB_OF: Record<string, Tab> = { weight: 'weight', waist: 'waist', bodyFat: 'bodyFat', leanMass: 'lean', fatMass: 'lean', ffmi: 'lean' }
const LEAN: readonly { value: LeanId; label: string }[] = [
  { value: 'leanMass', label: 'Masa magra' },
  { value: 'fatMass', label: 'Masa grasa' },
  { value: 'ffmi', label: 'FFMI' },
]

function summary(m: BodyMeasurement): string {
  const parts: string[] = []
  if (m.weightKg !== null) parts.push(`${formatNumber(m.weightKg, 1)} kg`)
  if (m.circumferences.waist !== undefined) parts.push(`cintura ${formatNumber(m.circumferences.waist, 1)} cm`)
  const nc = Object.keys(m.circumferences).length
  if (nc > (m.circumferences.waist !== undefined ? 1 : 0)) parts.push(`${nc} perímetros`)
  const ns = Object.keys(m.skinfolds).length
  if (ns) parts.push(`${ns} pliegues`)
  if (m.derived?.bodyFatPct !== undefined) parts.push(`${formatNumber(m.derived.bodyFatPct, 1)} % grasa (estimado)`)
  else if (m.derived?.sum !== null && m.derived?.sum !== undefined) parts.push(`suma ${formatNumber(m.derived.sum, 1)} mm`)
  return parts.join(' · ') || 'Sin datos'
}

/** Methods with an estimate of the metric anywhere in the loaded window, most recent first. */
function methodsIn(input: HealthInput | undefined, id: 'bodyFat' | 'fatMass' | 'leanMass' | 'ffmi', from: string, to: string): string[] {
  return input ? splitByMethod(id, input, from, to).filter((s) => s.points.some((p) => p.value !== null)).map((s) => s.method) : []
}

export function BodyPage() {
  const r = useRepo()
  const profile = useProfile()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const [params, setParams] = useSearchParams()
  const [m, setM] = useQueryChoice<string>('m', [...TABS, 'leanMass', 'fatMass', 'ffmi'], 'weight')
  const tab: Tab = TAB_OF[m] ?? 'weight'
  const leanId: LeanId = m === 'fatMass' || m === 'ffmi' ? m : 'leanMass'
  const [methodChoice, setMethodChoice] = useState<string | null>(null)
  const [target, setTarget] = useState<QuickTarget | null>(() => (params.get('tipo') === 'peso' ? { kind: 'weight' } : null))
  const rows = useLiveQuery(() => r.all('bodyMeasurements'), [r])
  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? ''))), [rows])
  const weights = sorted.filter((m) => m.weightKg !== null && !m.excludeFromStats)
  const latestW = weights.find((m) => !m.approx) ?? weights[0]
  const latestWeight = latestW ? { kg: latestW.weightKg as number, date: latestW.date } : input ? (() => { const h = weightHistory(input).at(-1); return h && h.value !== null ? { kg: h.value, date: h.date } : null })() : null
  const inPeriod = sorted.filter((m) => m.date >= period.range.from && m.date <= period.range.to)

  const lim = useLimit(inPeriod.length)
  const closeTarget = (t: QuickTarget | null) => {
    setTarget(t)
    if (!t && params.get('tipo')) {
      const p = new URLSearchParams(params)
      p.delete('tipo')
      setParams(p, { replace: true })
    }
  }

  const compId: 'bodyFat' | LeanId | null = tab === 'bodyFat' ? 'bodyFat' : tab === 'lean' ? leanId : null
  const methods = compId ? methodsIn(input, compId, period.range.from, period.range.to) : []
  const method = methodChoice && methods.includes(methodChoice) ? methodChoice : methods[0]
  const hasLean = input ? methodsIn(input, 'leanMass', period.range.from, period.range.to).length > 0 || methodsIn(input, 'ffmi', period.range.from, period.range.to).length > 0 || methodsIn(input, 'fatMass', period.range.from, period.range.to).length > 0 : false
  const tabs = [
    { value: 'weight' as Tab, label: 'Peso' },
    { value: 'waist' as Tab, label: 'Cintura' },
    { value: 'bodyFat' as Tab, label: 'Grasa estimada' },
    ...(hasLean || tab === 'lean' ? [{ value: 'lean' as Tab, label: 'Masa magra · FFMI' }] : []),
  ]
  const id: MetricId = tab === 'lean' ? leanId : tab
  const seriesOptions = useMemo(() => (compId && method ? { method } : undefined), [compId, method])
  const lastFat = sorted.find((m) => m.derived?.bodyFatPct !== undefined)

  return (
    <>
      <MetricDetail
        testId="body-page"
        title="Cuerpo"
        period={period}
        onPeriod={setPeriod}
        tabs={tabs}
        tab={tab}
        tabsLabel="Medidas corporales"
        onTab={(t) => setM(t === 'lean' ? leanId : t)}
        action={
          <button type="button" className="btn-primary px-3" onClick={() => setTarget({ kind: 'weight' })} data-testid="new-weight">
            <Icon name="plus" size={18} /> Registrar
          </button>
        }
      >
        {tab === 'lean' ? <Segmented ariaLabel="Composición" value={leanId} onChange={(v) => setM(v)} options={LEAN} size="sm" /> : null}
        {compId && methods.length > 1 ? (
          <div>
            <span className="label">Método de estimación</span>
            <Segmented ariaLabel="Método de estimación" value={method ?? ''} onChange={setMethodChoice} options={methods.map((m) => ({ value: m, label: m }))} size="sm" />
          </div>
        ) : null}
        <MetricBlock
          id={id}
          input={input}
          period={period}
          today={today}
          seriesOptions={seriesOptions}
          label={tab === 'weight' ? 'Peso registrado' : compId && method ? `${LEAN.find((l) => l.value === id)?.label ?? 'Grasa corporal'} · ${method}` : undefined}
          title={compId ? `${compId === 'bodyFat' ? 'Grasa corporal' : (LEAN.find((l) => l.value === id)?.label ?? '')} (estimada)` : undefined}
          emptyAction={
            compId ? (
              <Link to="/cuerpo/nueva" className="btn-secondary">
                Medición con pliegues
              </Link>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setTarget({ kind: 'weight' })}>
                Registrar peso
              </button>
            )
          }
          footnote={
            compId || tab === 'weight' || (tab === 'waist' && profile.heightCm && sorted.some((m) => m.circumferences.waist !== undefined)) ? (
              <div className="space-y-2">
                {compId ? (
                  <p className="text-label text-muted" data-testid="estimate-note">
                    Estimación calculada{method ? ` con ${method}` : ''}: no es una medición directa y cambia según el método. Los métodos distintos no se mezclan en una misma línea.
                    {id === 'ffmi' ? ' FFMI = masa magra (kg) ÷ estatura (m)².' : ''}
                    {compId === 'bodyFat' && lastFat ? ` Última con pliegues: ${formatDateEs(lastFat.date)}.` : ''}
                  </p>
                ) : null}
                {tab === 'weight' ? (
                  <p className="text-label text-muted">
                    {latestW ? (
                      <>
                        Peso actual: <span className="num font-medium text-ink" data-testid="latest-weight">{formatNumber(latestW.weightKg as number, 1)} kg</span> · {formatDateEs(latestW.date)}
                        {latestW.approx ? ' · aprox.' : ''}.{' '}
                        {profile.heightCm ? `IMC ${formatNumber(bmi(latestW.weightKg as number, profile.heightCm), 1)} (referencia poblacional, no mide composición corporal).` : ''}
                      </>
                    ) : (
                      <span data-testid="latest-weight">Sin registros de peso.</span>
                    )}
                  </p>
                ) : null}
                {tab === 'waist' && profile.heightCm ? <WaistNote rows={sorted} heightCm={profile.heightCm} /> : null}
              </div>
            ) : null
          }
        />

        <section aria-label="Historial">
          <SectionHeader
            title="Mediciones"
            hint={`${inPeriod.length} en el periodo`}
            action={
              <Link to="/cuerpo/nueva" className="btn-secondary px-3" data-testid="new-measurement">
                Medición completa
              </Link>
            }
          />
          {inPeriod.length ? (
            <div className="divide-rows mt-1" data-testid="measurement-list">
              {inPeriod.slice(0, lim.shown).map((m) => (
                <Row
                  key={m.id}
                  to={`/cuerpo/${m.id}`}
                  title={`${formatDateEs(m.date, 'weekday')}${m.time ? ` · ${m.time}` : ''}`}
                  subtitle={`${summary(m)} · ${originLabel(m.origin)}${m.approx ? ' · aprox.' : ''}`}
                />
              ))}
              {lim.more}
            </div>
          ) : (
            <p className="mt-2 text-body text-muted" data-testid="measurement-list">
              {sorted.length ? 'No hay mediciones en este periodo.' : 'Aún no hay mediciones. Registra tu peso o una medición completa con perímetros y pliegues.'}
            </p>
          )}
        </section>
        {input ? <HealthRows rows={hcRowsFor(input.health, ['weight', 'bodyFat', 'leanMassKg'], period.range)} /> : null}
      </MetricDetail>
      <QuickLogHost target={target} onTarget={closeTarget} latestWeight={latestWeight} />
    </>
  )
}

function WaistNote({ rows, heightCm }: { rows: BodyMeasurement[]; heightCm: number }) {
  const w = rows.find((m) => m.circumferences.waist !== undefined)
  if (!w) return null
  return (
    <p className="text-label text-muted">
      Cintura/talla {formatNumber(whtr(w.circumferences.waist as number, heightCm), 2)} con {formatNumber(w.circumferences.waist as number, 1)} cm el {formatDateEs(w.date)}.
    </p>
  )
}
