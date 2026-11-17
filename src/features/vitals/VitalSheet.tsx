import { useEffect, useState } from 'react'
import { useRepo } from '../../app/profile'
import { SAVE_FAILED_RESULT, useSafeWrite } from '../../app/safeSave'
import type { VitalKind, VitalSign } from '../../db/types'
import { nowLocalTime, todayLocal } from '../../domain/dates'
import {
  DISCLAIMER,
  GLUCOSE_CONTEXTS,
  VITAL_KINDS,
  VITAL_LABEL,
  VITAL_UNIT,
  classifyVital,
  validateBloodPressure,
  validateSingle,
  type Classification,
  type GlucoseContext,
} from '../../domain/vitals'
import { useConfirm } from '../../ui/Confirm'
import { NumField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Segmented, Sheet } from '../../ui/kit'
import { useSavedToast } from '../health/useSavedToast'
import { validateVital, saveVital } from '../health/writers'

export const VITAL_SHORT: Record<VitalKind, string> = {
  bloodPressure: 'Presión',
  restingHr: 'Pulso',
  spo2: 'SpO₂',
  glucose: 'Glucosa',
  temperature: 'Temp.',
}

/** Reference badge of a reading with its cited source (kept exactly as the Signos page has always shown it). */
export function ClassificationNote({ c }: { c: Classification }) {
  return (
    <div className="mt-1 text-label text-muted" data-testid="vital-classification">
      <Badge tone={c.tone}>{c.label}</Badge>
      {c.note ? <p className="mt-1">{c.note}</p> : null}
      <p className="mt-1 text-muted">
        Clasificación orientativa ({c.source}). {DISCLAIMER}
      </p>
    </div>
  )
}

/** Create or edit any vital sign. `initialKind` picks the measure of a new reading. */
export function VitalSheet({ open, existing, onClose, initialKind }: { open: boolean; existing: VitalSign | null; onClose: () => void; initialKind?: VitalKind }) {
  const r = useRepo()
  const confirm = useConfirm()
  const saved = useSavedToast()
  const [kind, setKind] = useState<VitalKind>('bloodPressure')
  const [date, setDate] = useState(todayLocal())
  const [time, setTime] = useState(nowLocalTime())
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  const [pulse, setPulse] = useState('')
  const [val, setVal] = useState('')
  const [ctx, setCtx] = useState<GlucoseContext>('ayunas')
  const [notes, setNotes] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTried(false)
    setBusy(false)
    setKind(existing?.kind ?? initialKind ?? 'bloodPressure')
    setDate(existing?.date ?? todayLocal())
    setTime(existing?.time ?? (existing ? '' : nowLocalTime()))
    setSys(numStr(existing?.systolic ?? null, 0))
    setDia(numStr(existing?.diastolic ?? null, 0))
    setPulse('')
    setVal(numStr(existing?.value ?? null, 1))
    setCtx(((existing?.context as GlucoseContext | null | undefined) ?? 'ayunas') as GlucoseContext)
    setNotes(existing?.notes ?? '')
  }, [open, existing, initialKind])

  const sysN = toNum(sys)
  const diaN = toNum(dia)
  const pulseN = toNum(pulse)
  const valN = toNum(val)
  const input = { kind, date, time: time || null, systolic: sysN, diastolic: diaN, pulse: !existing && pulse.trim() !== '' ? pulseN : undefined, value: valN, context: kind === 'glucose' ? ctx : null, notes }
  const error = kind === 'bloodPressure' && !existing && pulse.trim() !== '' && pulseN === null ? 'El pulso no es válido.' : validateVital(input)

  const write = useSafeWrite()
  const save = async () => {
    setTried(true)
    if (error || busy) return
    setBusy(true)
    try {
      const undo = await write(() => saveVital(r, input, existing))
      if (undo === SAVE_FAILED_RESULT) return
      saved(existing ? 'Cambios guardados' : `${VITAL_LABEL[kind]} guardada`, undo)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const draftClass =
    kind === 'bloodPressure' && sysN !== null && diaN !== null && !validateBloodPressure(sysN, diaN)
      ? classifyVital({ kind, systolic: sysN, diastolic: diaN, value: null })
      : kind !== 'bloodPressure' && valN !== null && !validateSingle(kind, valN)
        ? classifyVital({ kind, value: valN, context: ctx })
        : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar signo vital' : 'Registrar signo vital'}
      footer={
        <button className="btn-primary w-full" type="submit" form="vital-form" disabled={busy} data-testid="save-vital">
          Guardar
        </button>
      }
    >
      <form
        id="vital-form"
        className="space-y-3 pb-2"
        data-testid="vital-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {existing ? (
          <div className="text-body font-medium">{VITAL_LABEL[kind]}</div>
        ) : (
          <div>
            <span className="label">Medida</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Medida">
              {VITAL_KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip ${kind === k ? 'chip-on' : ''}`} onClick={() => setKind(k)} data-testid={`vital-kind-${k}`}>
                  {VITAL_SHORT[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === 'bloodPressure' ? (
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Sistólica (alta)" unit="mmHg" value={sys} onChange={setSys} autoFocus ariaLabel="Presión sistólica" />
            <NumField label="Diastólica (baja)" unit="mmHg" value={dia} onChange={setDia} ariaLabel="Presión diastólica" />
            {!existing ? (
              <div className="col-span-2">
                <NumField label="Pulso (opcional)" unit="lpm" value={pulse} onChange={setPulse} hint="Si lo anotas, se guarda también como pulso en reposo." />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <NumField label={VITAL_LABEL[kind]} unit={VITAL_UNIT[kind]} value={val} onChange={setVal} autoFocus ariaLabel={VITAL_LABEL[kind]} />
            {kind === 'glucose' ? (
              <div>
                <span className="label">Contexto</span>
                <Segmented ariaLabel="Contexto de la glucosa" value={ctx} onChange={setCtx} options={GLUCOSE_CONTEXTS} size="sm" />
              </div>
            ) : null}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <TextField label="Fecha" type="date" value={date} onChange={setDate} />
          <TextField label="Hora" type="time" value={time} onChange={setTime} />
        </div>
        <TextArea label="Notas" value={notes} onChange={setNotes} placeholder="Ej.: después de caminar, brazo izquierdo" />

        {tried && error ? (
          <p className="text-body text-bad" role="alert" data-testid="vital-error">
            {error}
          </p>
        ) : null}
        {draftClass ? <ClassificationNote c={draftClass} /> : null}

        {existing ? (
          <button
            type="button"
            className="btn-danger w-full"
            data-testid="delete-vital"
            onClick={async () => {
              if (!(await confirm({ title: '¿Eliminar este registro?', body: 'Se elimina de tu historial. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', tone: 'danger' }))) return
              await r.remove('vitals', existing.id)
              saved('Registro eliminado', null)
              onClose()
            }}
          >
            <Icon name="trash" size={16} /> Eliminar
          </button>
        ) : null}
      </form>
    </Sheet>
  )
}
