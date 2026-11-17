import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import { SAVE_FAILED_RESULT, useSafeWrite } from '../../app/safeSave'
import { computeBodyComp, PROTOCOLS, SKINFOLD_SITES, type ProtocolId } from '../../domain/bodycomp'
import { nowLocalTime, todayLocal } from '../../domain/dates'
import { ageFromBirthDate } from '../../domain/energy'
import { formatNumber, textRangeError } from '../../domain/units'
import { useConfirm } from '../../ui/Confirm'
import { NumField, SelectField, TextArea, TextField, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Card, PageHeader } from '../../ui/kit'
import { useSavedToast } from '../health/useSavedToast'
import { CIRCUMFERENCES } from './circumferences'
import { measurementDerived, measurementDirty, measurementDraft, measurementValues, receiveMeasurement, reloadMeasurement, saveMeasurementEdit, type MeasurementDraft, type MeasurementEdit } from './measurementEdit'

export function MeasurementEditor() {
  const { id } = useParams()
  const profile = useProfile()
  return <MeasurementForm key={`${profile.id}/${id ?? 'nueva'}`} />
}

function MeasurementForm() {
  const { id } = useParams()
  const isNew = !id || id === 'nueva'
  const [search] = useSearchParams()
  const confirm = useConfirm()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const r = useRepo()
  const nav = useNavigate()
  const profile = useProfile()
  const existing = useLiveQuery(() => (isNew ? undefined : r.get('bodyMeasurements', id as string)), [r, id])
  const [edit, setEdit] = useState<MeasurementEdit>(() => ({
    loaded: isNew, baseline: null,
    draft: { date: todayLocal(), time: nowLocalTime(), weight: '', circ: {}, sf: {}, protocol: profile.settings.skinfoldProtocol ?? '', notes: '' },
  }))
  const { draft, baseline } = edit
  const { date, time, weight, circ, sf, protocol, notes } = draft
  const setField = <K extends keyof MeasurementDraft>(key: K, value: MeasurementDraft[K]) =>
    setEdit((state) => ({ ...state, draft: { ...state.draft, [key]: value } }))
  const [showCirc, setShowCirc] = useState(true)
  const [showSf, setShowSf] = useState(false)

  useEffect(() => {
    if (!existing || edit.loaded) return
    setEdit((state) => receiveMeasurement(state, existing))
    setShowSf(Object.keys(existing.skinfolds).length > 0)
  }, [existing, edit.loaded])

  const { circumferences: circN, skinfolds: sfN } = measurementValues(draft)
  const weightN = toNum(weight)
  const initial = baseline ? measurementDraft(baseline) : null
  const dirty = initial ? measurementDirty(initial, draft) : false
  const remoteChanged = baseline && existing && JSON.stringify(baseline) !== JSON.stringify(existing)
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

  // Plausible ranges: "1.200" is 1200 (see parseDecimal) and is rejected, never stored.
  const weightErr = textRangeError(weight, 20, 400, 'kg')
  const circErr = (s: string | undefined) => textRangeError(s, 5, 300, 'cm')
  const sfErr = (s: string | undefined) => textRangeError(s, 1, 100, 'mm')
  const invalid = !!weightErr || Object.values(circ).some((s) => !!circErr(s)) || Object.values(sf).some((s) => !!sfErr(s))
  const hasData = weightN !== null || Object.keys(circN).length > 0 || Object.keys(sfN).length > 0
  const canSave = edit.loaded && !invalid && hasData && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function save() {
    if (!canSave) return
    // Success toast and navigation only after the write resolved; a failure keeps the form.
    const undo = await write(async () => {
      if (!isNew && id && initial) {
        await saveMeasurementEdit(r, id, initial, draft, profile)
        return null
      }
      const data = measurementValues(draft)
      const derived = measurementDerived(data, profile, new Date().toISOString())
      const row = await r.add('bodyMeasurements', { ...data, derived, origin: 'app' })
      return { table: 'bodyMeasurements' as const, ids: [row.id] }
    })
    if (undo === SAVE_FAILED_RESULT) return
    saved('Medición guardada', undo)
    nav('/cuerpo')
  }

  if (isNew && search.get('tipo') === 'peso') return <Navigate to="/cuerpo?tipo=peso" replace />

  const protoSites = proto?.sites ?? []
  const otherSites = SKINFOLD_SITES.filter((s) => !protoSites.includes(s.key))

  return (
    <>
      <PageHeader title={isNew ? 'Nueva medición' : 'Medición'} back="/cuerpo" />
      <div className="space-y-4">
        {remoteChanged ? (
          <p role="status" className="text-sm text-muted">
            Esta medición cambió en otro dispositivo{' '}
            <button className="btn-secondary" onClick={() => {
              if (existing) {
                setEdit(reloadMeasurement(existing))
                setShowSf(Object.keys(existing.skinfolds).length > 0)
              }
            }}>Recargar</button>
            {dirty ? <span className="sr-only">Descarta tus cambios y carga los valores nuevos.</span> : null}
          </p>
        ) : null}
        {existing?.origin === 'phase0' ? (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">
            Importada del historial (fase 0){existing.approx ? ', valor aproximado' : ''}. Puedes corregirla.
          </p>
        ) : null}
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Fecha" type="date" value={date} onChange={(v) => setField('date', v)} />
            <TextField label="Hora" type="time" value={time} onChange={(v) => setField('time', v)} />
          </div>
          <NumField label="Peso" unit="kg" value={weight} onChange={(v) => setField('weight', v)} autoFocus={isNew} name="weight" hint="En ayunas, después de ir al baño, para comparar mejor" error={weightErr ?? undefined} />
        </Card>

        <Card>
          <button className="flex min-h-[44px] w-full items-center justify-between" onClick={() => setShowCirc((v) => !v)}>
            <span className="font-semibold">Perímetros (cm)</span>
            <Icon name={showCirc ? 'chevronUp' : 'chevronDown'} size={18} className="text-muted" />
          </button>
          {showCirc ? (
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {CIRCUMFERENCES.map((c) => (
                <NumField key={c.key} label={c.es} unit="cm" value={circ[c.key] ?? ''} onChange={(v) => setField('circ', { ...circ, [c.key]: v })} name={`c-${c.key}`} error={circErr(circ[c.key]) ?? undefined} />
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <button className="flex min-h-[44px] w-full items-center justify-between" onClick={() => setShowSf((v) => !v)} data-testid="toggle-skinfolds">
            <span className="font-semibold">Pliegues cutáneos (mm)</span>
            <Icon name={showSf ? 'chevronUp' : 'chevronDown'} size={18} className="text-muted" />
          </button>
          {showSf ? (
            <div className="mt-3 space-y-3">
              <SelectField<ProtocolId>
                label="Protocolo"
                value={protocol}
                onChange={(v) => setField('protocol', v)}
                options={PROTOCOLS.filter((p) => !p.sex || p.sex === profile.sex).map((p) => ({ value: p.id, label: p.es }))}
                placeholder="Elige un protocolo"
              />
              {proto ? <p className="text-xs text-muted">{proto.note}</p> : null}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                {(proto && proto.id !== 'sum_custom' ? SKINFOLD_SITES.filter((s) => protoSites.includes(s.key)) : SKINFOLD_SITES).map((s) => (
                  <NumField key={s.key} label={s.es} unit="mm" hint={s.hint} value={sf[s.key] ?? ''} onChange={(v) => setField('sf', { ...sf, [s.key]: v })} name={`sf-${s.key}`} error={sfErr(sf[s.key]) ?? undefined} />
                ))}
              </div>
              {proto && proto.id !== 'sum_custom' && otherSites.length ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted">Otros pliegues (opcional)</summary>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                    {otherSites.map((s) => (
                      <NumField key={s.key} label={s.es} unit="mm" value={sf[s.key] ?? ''} onChange={(v) => setField('sf', { ...sf, [s.key]: v })} name={`sf-${s.key}`} error={sfErr(sf[s.key]) ?? undefined} />
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

        <TextArea label="Notas" value={notes} onChange={(v) => setField('notes', v)} />
        {invalid ? <p className="text-sm text-bad">Revisa los valores: deben ser números positivos.</p> : null}
        <button className="btn-primary w-full" disabled={!canSave} onClick={() => void save()} data-testid="save-measurement">
          Guardar medición
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!(await confirm({ title: '¿Eliminar esta medición?', body: 'Se elimina de tu historial. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', tone: 'danger' }))) return
              await r.remove('bodyMeasurements', existing.id)
              saved('Medición eliminada', null)
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
