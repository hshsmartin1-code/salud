/**
 * Full record sheets (activity, sleep, recovery): create or edit, with delete through `useConfirm` and the
 * "Deshacer" toast for new records. Shared by the detail pages and by the overview's "Más" sheet.
 */
import { useEffect, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { ActivityLog, RecoveryLog, SleepLog } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { formatNumber, textRangeError } from '../../domain/units'
import { useConfirm } from '../../ui/Confirm'
import { NumField, SelectField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Sheet } from '../../ui/kit'
import { useSavedToast } from './useSavedToast'
import { addSleep, hoursBetween, validateSleep } from './writers'

export function Scale({ label, value, onChange, low, high }: { label: string; value: number | null; onChange: (v: number | null) => void; low: string; high: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`chip flex-1 justify-center ${value === n ? 'chip-on' : ''}`} onClick={() => onChange(value === n ? null : n)} aria-pressed={value === n}>
            {n}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-micro text-muted">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  )
}

/** Provenance badges of a record (imported, approximate). */
export function Flags({ row }: { row: { origin?: string; approx?: boolean; excludeFromStats?: boolean } }) {
  return (
    <>
      {row.origin === 'phase0' ? <Badge>Importado</Badge> : null}
      {row.approx ? <Badge tone="warn">Aprox.</Badge> : null}
    </>
  )
}

function DeleteButton({ label, table, id, onDone }: { label: string; table: 'activityLogs' | 'sleepLogs' | 'recoveryLogs'; id: string; onDone: () => void }) {
  const r = useRepo()
  const confirm = useConfirm()
  const saved = useSavedToast()
  return (
    <button
      type="button"
      className="btn-danger w-full"
      onClick={async () => {
        if (!(await confirm({ title: label, body: 'Se elimina de tu historial. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', tone: 'danger' }))) return
        await r.remove(table, id)
        saved('Registro eliminado', null)
        onDone()
      }}
    >
      <Icon name="trash" size={16} /> Eliminar
    </button>
  )
}

// ───────────────────────── Activity ─────────────────────────
export const ACTIVITY_TYPES = ['Caminata', 'Carrera', 'Bicicleta', 'Natación', 'HIIT', 'Deporte', 'Pulsera / reloj', 'Otro'] as const

export function ActivitySheet({ open, existing, onClose }: { open: boolean; existing: ActivityLog | null; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const [date, setDate] = useState(todayLocal())
  const [type, setType] = useState<string>('Caminata')
  const [steps, setSteps] = useState('')
  const [kcal, setKcal] = useState('')
  const [minutes, setMinutes] = useState('')
  const [km, setKm] = useState('')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!open) return
    setDate(existing?.date ?? todayLocal())
    setType(existing?.type ?? 'Caminata')
    setSteps(numStr(existing?.steps ?? null, 0))
    setKcal(numStr(existing?.activeKcal ?? null, 0))
    setMinutes(numStr(existing?.minutes ?? null, 0))
    setKm(numStr(existing?.distanceKm ?? null, 2))
    setNotes(existing?.notes ?? '')
  }, [open, existing])
  const vals = { steps: toNum(steps), activeKcal: toNum(kcal), minutes: toNum(minutes), distanceKm: toNum(km) }
  const errs = { steps: textRangeError(steps, 0, 100000, 'pasos'), minutes: textRangeError(minutes, 0, 1440, 'min'), km: textRangeError(km, 0, 300, 'km'), kcal: textRangeError(kcal, 0, 10000, 'kcal') }
  const canSave = Object.values(vals).some((v) => v !== null) && Object.values(errs).every((e) => e === null)
  const save = async () => {
    const data = { date, type, ...vals, notes: notes.trim() || undefined }
    if (existing) {
      await r.put('activityLogs', { ...existing, ...data, approx: false, excludeFromStats: false })
      saved('Cambios guardados', null)
    } else {
      const row = await r.add('activityLogs', { ...data, origin: 'app' })
      saved('Actividad guardada', { table: 'activityLogs', ids: [row.id] })
    }
    onClose()
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar actividad' : 'Registrar actividad'}
      footer={
        <button className="btn-primary w-full" disabled={!canSave} data-testid="save-activity" onClick={() => void save()}>
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Fecha" type="date" value={date} onChange={setDate} />
          <SelectField label="Tipo" value={type} onChange={setType} options={ACTIVITY_TYPES.map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Pasos" value={steps} onChange={setSteps} error={errs.steps ?? undefined} />
          <NumField label="Minutos" unit="min" value={minutes} onChange={setMinutes} error={errs.minutes ?? undefined} />
          <NumField label="Distancia" unit="km" value={km} onChange={setKm} error={errs.km ?? undefined} />
          <NumField label="Kcal activas" unit="kcal" value={kcal} onChange={setKcal} hint="Según tu dispositivo" error={errs.kcal ?? undefined} />
        </div>
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        {existing ? <DeleteButton label="¿Eliminar este registro de actividad?" table="activityLogs" id={existing.id} onDone={onClose} /> : null}
      </div>
    </Sheet>
  )
}

// ───────────────────────── Sleep ─────────────────────────
export function SleepSheet({ open, existing, onClose }: { open: boolean; existing: SleepLog | null; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const [date, setDate] = useState(todayLocal())
  const [bed, setBed] = useState('')
  const [wake, setWake] = useState('')
  const [hours, setHours] = useState('')
  const [quality, setQuality] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setDate(existing?.date ?? todayLocal())
    setBed(existing?.bedtime ?? '')
    setWake(existing?.waketime ?? '')
    setHours(numStr(existing?.hours ?? null, 2))
    setQuality(existing?.quality ?? null)
    setNotes(existing?.notes ?? '')
    setError(null)
  }, [open, existing])
  const auto = bed && wake ? hoursBetween(bed, wake) : null
  const input = { date, bedtime: bed || null, waketime: wake || null, hours: toNum(hours), quality, notes }
  const invalid = textRangeError(hours, 0.1, 24, 'h') ?? validateSleep(input)
  const save = async () => {
    if (invalid) return setError(invalid)
    if (existing) {
      const h = input.hours ?? auto
      await r.put('sleepLogs', { ...existing, date, bedtime: bed || null, waketime: wake || null, hours: h, quality, notes: notes.trim() || undefined, approx: false, excludeFromStats: false })
      saved('Cambios guardados', null)
    } else saved('Sueño guardado', await addSleep(r, input))
    onClose()
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar sueño' : 'Registrar sueño'}
      footer={
        <button className="btn-primary w-full" disabled={!!invalid} data-testid="save-sleep" onClick={() => void save()}>
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <TextField label="Fecha (día en que despertaste)" type="date" value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Me acosté" type="time" value={bed} onChange={setBed} />
          <TextField label="Me levanté" type="time" value={wake} onChange={setWake} />
        </div>
        <NumField label="Horas dormidas" unit="h" value={hours} onChange={setHours} placeholder={auto !== null ? formatNumber(auto, 2) : ''} hint={auto !== null && !hours ? `Calculado: ${formatNumber(auto, 2)} h en cama` : 'Opcional si indicas las horas'} />
        <Scale label="Calidad (autoevaluada)" value={quality} onChange={setQuality} low="Muy mala" high="Excelente" />
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        {error ? (
          <p role="alert" className="text-label text-bad">
            {error}
          </p>
        ) : null}
        {existing ? <DeleteButton label="¿Eliminar este registro de sueño?" table="sleepLogs" id={existing.id} onDone={onClose} /> : null}
      </div>
    </Sheet>
  )
}

// ───────────────────────── Recovery ─────────────────────────
export function RecoverySheet({ open, existing, onClose }: { open: boolean; existing: RecoveryLog | null; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const [date, setDate] = useState(todayLocal())
  const [energy, setEnergy] = useState<number | null>(null)
  const [soreness, setSoreness] = useState<number | null>(null)
  const [stress, setStress] = useState<number | null>(null)
  const [mood, setMood] = useState<number | null>(null)
  const [hr, setHr] = useState('')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!open) return
    setDate(existing?.date ?? todayLocal())
    setEnergy(existing?.energy ?? null)
    setSoreness(existing?.soreness ?? null)
    setStress(existing?.stress ?? null)
    setMood(existing?.mood ?? null)
    setHr(numStr(existing?.restingHr ?? null, 0))
    setNotes(existing?.notes ?? '')
  }, [open, existing])
  const hrErr = textRangeError(hr, 25, 230, 'lpm')
  const canSave = !hrErr && [energy, soreness, stress, mood, toNum(hr)].some((v) => v !== null)
  const save = async () => {
    const data = { date, energy, soreness, stress, mood, restingHr: toNum(hr), notes: notes.trim() || undefined }
    if (existing) {
      await r.put('recoveryLogs', { ...existing, ...data })
      saved('Cambios guardados', null)
    } else {
      const row = await r.add('recoveryLogs', { ...data, origin: 'app' })
      saved('Recuperación guardada', { table: 'recoveryLogs', ids: [row.id] })
    }
    onClose()
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar recuperación' : 'Registrar recuperación'}
      footer={
        <button className="btn-primary w-full" disabled={!canSave} onClick={() => void save()}>
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <TextField label="Fecha" type="date" value={date} onChange={setDate} />
        <p className="text-label text-muted">Escalas autoevaluadas: son tu propia valoración, no una medición.</p>
        <Scale label="Energía" value={energy} onChange={setEnergy} low="Agotado" high="Excelente" />
        <Scale label="Dolor muscular" value={soreness} onChange={setSoreness} low="Nada" high="Mucho" />
        <Scale label="Estrés" value={stress} onChange={setStress} low="Bajo" high="Alto" />
        <Scale label="Ánimo" value={mood} onChange={setMood} low="Bajo" high="Muy bueno" />
        <NumField label="FC en reposo" unit="lpm" value={hr} onChange={setHr} error={hrErr ?? undefined} />
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        {existing ? <DeleteButton label="¿Eliminar este registro de recuperación?" table="recoveryLogs" id={existing.id} onDone={onClose} /> : null}
      </div>
    </Sheet>
  )
}
