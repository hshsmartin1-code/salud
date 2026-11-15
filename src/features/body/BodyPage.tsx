import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import type { BodyMeasurement, CircumferenceKey, DerivedBodyComp } from '../../db/types'
import { bmi, computeBodyComp, PROTOCOLS, SKINFOLD_SITES, whtr, type ProtocolId, type SkinfoldSite } from '../../domain/bodycomp'
import { formatDateEs, nowLocalTime, todayLocal } from '../../domain/dates'
import { ageFromBirthDate } from '../../domain/energy'
import { movingAverage } from '../../domain/stats'
import { formatNumber } from '../../domain/units'
import { NumField, SelectField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Card, EmptyState, PageHeader } from '../../ui/kit'

export const CIRCUMFERENCES: { key: CircumferenceKey; es: string }[] = [
  { key: 'waist', es: 'Cintura' },
  { key: 'hip', es: 'Cadera' },
  { key: 'neck', es: 'Cuello' },
  { key: 'chest', es: 'Pecho' },
  { key: 'armRelaxed', es: 'Brazo relajado' },
  { key: 'armContracted', es: 'Brazo contraído' },
  { key: 'forearm', es: 'Antebrazo' },
  { key: 'thigh', es: 'Muslo' },
  { key: 'calf', es: 'Pantorrilla' },
]

export function BodyPage() {
  const r = useRepo()
  const profile = useProfile()
  const rows = useLiveQuery(() => r.all('bodyMeasurements'), [r])
  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? ''))), [rows])
  const weights = sorted.filter((m) => m.weightKg !== null && !m.excludeFromStats)
  const latestW = weights.find((m) => !m.approx) ?? weights[0]
  const latestWaist = sorted.find((m) => m.circumferences.waist !== undefined)
  const latestFat = sorted.find((m) => m.derived?.bodyFatPct !== undefined)
  const latestSum = sorted.find((m) => m.derived?.sum !== null && m.derived?.sum !== undefined)

  // 7-day moving average of daily weights (one value per day: the last of the day).
  const avg7 = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const m of weights.slice().reverse()) if (!m.approx) byDay.set(m.date, m.weightKg as number)
    const points = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }))
    if (!points.length) return null
    const ma = movingAverage(points, 7)
    const last = ma[ma.length - 1]
    return last ? { value: last.avg, n: last.n } : null
  }, [weights])

  return (
    <>
      <PageHeader
        title="Cuerpo"
        actions={
          <Link to="/cuerpo/nueva" className="btn-primary px-3" data-testid="new-measurement">
            <Icon name="plus" size={18} /> Medición
          </Link>
        }
      />
      <div className="space-y-5">
        <div className="metric-strip grid-cols-2 sm:grid-cols-4">
          <div>
            <div className="text-[13px] text-muted">Peso</div>
            <div className="readout mt-2 text-[30px]" data-testid="latest-weight">
              {latestW ? formatNumber(latestW.weightKg as number, 1) : '—'}
              <span className="ml-1 text-sm font-medium text-muted">kg</span>
            </div>
            <div className="mt-1 text-xs text-faint">
              {latestW ? formatDateEs(latestW.date) : 'Sin registros'}
              {latestW?.approx ? ' · aprox.' : ''}
            </div>
          </div>
          <div>
            <div className="text-[13px] text-muted">Media 7 días</div>
            <div className="readout mt-2 text-[30px]">
              {avg7 ? formatNumber(avg7.value, 1) : '—'}
              <span className="ml-1 text-sm font-medium text-muted">kg</span>
            </div>
            <div className="mt-1 text-xs text-faint">{avg7 ? `${avg7.n} ${avg7.n === 1 ? 'día' : 'días'} con peso` : '—'}</div>
          </div>
          <div>
            <div className="text-[13px] text-muted">Cintura</div>
            <div className="readout mt-2 text-[30px]">
              {latestWaist ? formatNumber(latestWaist.circumferences.waist as number, 1) : '—'}
              <span className="ml-1 text-sm font-medium text-muted">cm</span>
            </div>
            <div className="mt-1 text-xs text-faint">
              {latestWaist && profile.heightCm ? `Cintura/talla ${formatNumber(whtr(latestWaist.circumferences.waist as number, profile.heightCm), 2)}` : latestWaist ? formatDateEs(latestWaist.date) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[13px] text-muted">Grasa estimada</div>
            <div className="readout mt-2 text-[30px]">
              {latestFat ? formatNumber(latestFat.derived!.bodyFatPct as number, 1) : '—'}
              <span className="ml-1 text-sm font-medium text-muted">%</span>
            </div>
            <div className="mt-1 text-xs text-faint">
              {latestFat ? PROTOCOLS.find((p) => p.id === latestFat.derived!.protocol)?.es : latestSum ? `Suma ${formatNumber(latestSum.derived!.sum as number, 1)} mm` : 'Sin pliegues'}
            </div>
          </div>
        </div>
        {latestW && profile.heightCm ? (
          <p className="text-xs text-muted">
            IMC {formatNumber(bmi(latestW.weightKg as number, profile.heightCm), 1)} (calculado con {formatNumber(latestW.weightKg as number, 1)} kg y {formatNumber(profile.heightCm, 0)} cm; es una referencia poblacional, no mide composición corporal).
          </p>
        ) : null}

        <section>
          <h2 className="section-title mb-2">Historial</h2>
          {sorted.length ? (
            <ul className="card divide-y divide-line overflow-hidden" data-testid="measurement-list">
              {sorted.map((m) => (
                <li key={m.id}>
                  <Link to={`/cuerpo/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface2/60">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {formatDateEs(m.date, 'weekday')}
                        {m.time ? <span className="text-muted"> · {m.time}</span> : null}
                      </div>
                      <div className="truncate text-xs text-muted">{summary(m)}</div>
                    </div>
                    {m.origin === 'phase0' ? <Badge>Importado</Badge> : null}
                    {m.approx ? <Badge tone="warn">Aprox.</Badge> : null}
                    <Icon name="chevronRight" size={18} className="text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="ruler" title="Sin mediciones" action={<Link className="btn-primary" to="/cuerpo/nueva">Registrar medición</Link>}>
              Registra peso, perímetros y pliegues. Los valores calculados se guardan aparte y se marcan como estimados.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  )
}

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

type Strs<K extends string> = Partial<Record<K, string>>

export function MeasurementEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'nueva'
  const r = useRepo()
  const nav = useNavigate()
  const profile = useProfile()
  const existing = useLiveQuery(() => (isNew ? undefined : r.get('bodyMeasurements', id as string)), [r, id])
  const [date, setDate] = useState(todayLocal())
  const [time, setTime] = useState(nowLocalTime())
  const [weight, setWeight] = useState('')
  const [circ, setCirc] = useState<Strs<CircumferenceKey>>({})
  const [sf, setSf] = useState<Strs<SkinfoldSite>>({})
  const [protocol, setProtocol] = useState<ProtocolId | ''>(profile.settings.skinfoldProtocol ?? '')
  const [notes, setNotes] = useState('')
  const [showCirc, setShowCirc] = useState(true)
  const [showSf, setShowSf] = useState(false)

  useEffect(() => {
    if (!existing) return
    setDate(existing.date)
    setTime(existing.time ?? '')
    setWeight(numStr(existing.weightKg, 2))
    setCirc(Object.fromEntries(Object.entries(existing.circumferences).map(([k, v]) => [k, numStr(v, 1)])))
    setSf(Object.fromEntries(Object.entries(existing.skinfolds).map(([k, v]) => [k, numStr(v, 1)])))
    setProtocol(existing.protocol ?? '')
    setNotes(existing.notes ?? '')
    setShowSf(Object.keys(existing.skinfolds).length > 0)
  }, [existing])

  const nums = <K extends string>(o: Strs<K>) => {
    const out: Partial<Record<K, number>> = {}
    for (const [k, s] of Object.entries(o) as [K, string | undefined][]) {
      const n = toNum(s ?? '')
      if (n !== null && n > 0) out[k] = n
    }
    return out
  }
  const circN = nums(circ)
  const sfN = nums(sf)
  const weightN = toNum(weight)
  const proto = PROTOCOLS.find((p) => p.id === protocol)
  const age = profile.birthDate ? ageFromBirthDate(profile.birthDate, date) : null

  const result = useMemo(() => {
    if (!protocol || Object.keys(sfN).length === 0 || age === null) return null
    try {
      return computeBodyComp({ protocol, sex: profile.sex, ageYears: age, skinfolds: sfN, weightKg: weightN, heightCm: profile.heightCm })
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocol, JSON.stringify(sfN), age, profile.sex, weightN, profile.heightCm])

  const invalid =
    (weight.trim() && (weightN === null || weightN <= 0 || weightN > 400)) ||
    [...Object.values(circ), ...Object.values(sf)].some((s) => s && s.trim() && (toNum(s) === null || (toNum(s) as number) <= 0))
  const hasData = weightN !== null || Object.keys(circN).length > 0 || Object.keys(sfN).length > 0
  const canSave = !invalid && hasData && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function save() {
    if (!canSave) return
    const derived: DerivedBodyComp | null =
      result && protocol && result.sum !== null && age !== null
        ? {
            estimated: true,
            protocol,
            equation: result.equation,
            method: result.method,
            sum: result.sum,
            ...(result.density !== undefined ? { density: result.density } : {}),
            ...(result.bodyFatPct !== undefined ? { bodyFatPct: result.bodyFatPct } : {}),
            ...(result.fatMassKg !== undefined ? { fatMassKg: result.fatMassKg } : {}),
            ...(result.leanMassKg !== undefined ? { leanMassKg: result.leanMassKg } : {}),
            inputs: { sex: profile.sex, ageYears: age, weightKg: weightN, heightCm: profile.heightCm },
            computedAt: new Date().toISOString(),
          }
        : null
    const data = {
      date,
      time: time || null,
      weightKg: weightN,
      circumferences: circN,
      skinfolds: sfN,
      protocol: Object.keys(sfN).length ? (protocol || null) : null,
      derived,
      notes: notes.trim() || undefined,
    }
    if (existing) await r.put('bodyMeasurements', { ...existing, ...data })
    else await r.add('bodyMeasurements', { ...data, origin: 'app' })
    nav('/cuerpo')
  }

  const protoSites = proto?.sites ?? []
  const otherSites = SKINFOLD_SITES.filter((s) => !protoSites.includes(s.key))

  return (
    <>
      <PageHeader title={isNew ? 'Nueva medición' : 'Medición'} back="/cuerpo" />
      <div className="space-y-4">
        {existing?.origin === 'phase0' ? (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">
            Importada del historial (fase 0){existing.approx ? ', valor aproximado' : ''}. Puedes corregirla.
          </p>
        ) : null}
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Fecha" type="date" value={date} onChange={setDate} />
            <TextField label="Hora" type="time" value={time} onChange={setTime} />
          </div>
          <NumField label="Peso" unit="kg" value={weight} onChange={setWeight} autoFocus={isNew} name="weight" hint="En ayunas, después de ir al baño, para comparar mejor" />
        </Card>

        <Card>
          <button className="flex w-full items-center justify-between" onClick={() => setShowCirc((v) => !v)}>
            <span className="font-semibold">Perímetros (cm)</span>
            <Icon name={showCirc ? 'chevronUp' : 'chevronDown'} size={18} className="text-muted" />
          </button>
          {showCirc ? (
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {CIRCUMFERENCES.map((c) => (
                <NumField key={c.key} label={c.es} unit="cm" value={circ[c.key] ?? ''} onChange={(v) => setCirc((s) => ({ ...s, [c.key]: v }))} name={`c-${c.key}`} />
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <button className="flex w-full items-center justify-between" onClick={() => setShowSf((v) => !v)} data-testid="toggle-skinfolds">
            <span className="font-semibold">Pliegues cutáneos (mm)</span>
            <Icon name={showSf ? 'chevronUp' : 'chevronDown'} size={18} className="text-muted" />
          </button>
          {showSf ? (
            <div className="mt-3 space-y-3">
              <SelectField<ProtocolId>
                label="Protocolo"
                value={protocol}
                onChange={setProtocol}
                options={PROTOCOLS.filter((p) => !p.sex || p.sex === profile.sex).map((p) => ({ value: p.id, label: p.es }))}
                placeholder="Elige un protocolo"
              />
              {proto ? <p className="text-xs text-muted">{proto.note}</p> : null}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                {(proto && proto.id !== 'sum_custom' ? SKINFOLD_SITES.filter((s) => protoSites.includes(s.key)) : SKINFOLD_SITES).map((s) => (
                  <NumField key={s.key} label={s.es} unit="mm" hint={s.hint} value={sf[s.key] ?? ''} onChange={(v) => setSf((o) => ({ ...o, [s.key]: v }))} name={`sf-${s.key}`} />
                ))}
              </div>
              {proto && proto.id !== 'sum_custom' && otherSites.length ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted">Otros pliegues (opcional)</summary>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                    {otherSites.map((s) => (
                      <NumField key={s.key} label={s.es} unit="mm" value={sf[s.key] ?? ''} onChange={(v) => setSf((o) => ({ ...o, [s.key]: v }))} name={`sf-${s.key}`} />
                    ))}
                  </div>
                </details>
              ) : null}
              {result ? (
                <div className="rounded-xl border border-line bg-surface2/60 p-3 text-sm" data-testid="bodycomp-result">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-semibold">Resultado</span>
                    <Badge tone="warn">Estimado</Badge>
                  </div>
                  {result.sum !== null ? (
                    <div className="num grid grid-cols-2 gap-1 sm:grid-cols-4">
                      <span>Suma: {formatNumber(result.sum, 1)} mm</span>
                      {result.density !== undefined ? <span>Densidad: {formatNumber(result.density, 4)}</span> : null}
                      {result.bodyFatPct !== undefined ? <span className="font-semibold">Grasa: {formatNumber(result.bodyFatPct, 1)} %</span> : null}
                      {result.fatMassKg !== undefined ? <span>Masa grasa: {formatNumber(result.fatMassKg, 1)} kg</span> : null}
                      {result.leanMassKg !== undefined ? <span>Masa magra: {formatNumber(result.leanMassKg, 1)} kg</span> : null}
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-muted">{result.method}</p>
                  {result.warnings.map((w) => (
                    <p key={w} className="mt-1 text-xs text-warn">
                      {w}
                    </p>
                  ))}
                </div>
              ) : protocol && Object.keys(sfN).length && age === null ? (
                <p className="text-xs text-warn">Falta la fecha de nacimiento en el perfil para calcular.</p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <TextArea label="Notas" value={notes} onChange={setNotes} />
        {invalid ? <p className="text-sm text-bad">Revisa los valores: deben ser números positivos.</p> : null}
        <button className="btn-primary w-full" disabled={!canSave} onClick={() => void save()} data-testid="save-measurement">
          Guardar medición
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar esta medición?')) return
              await r.remove('bodyMeasurements', existing.id)
              nav('/cuerpo')
            }}
          >
            <Icon name="trash" size={16} /> Eliminar medición
          </button>
        ) : null}
      </div>
    </>
  )
}
