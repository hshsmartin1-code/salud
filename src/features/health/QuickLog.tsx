/**
 * "Registrar" quick actions of the Salud overview: small sheets that save in place (no navigation), each with
 * a "Deshacer" toast that removes exactly the rows it wrote. They use the same writers and validation as the
 * detail pages (writers.ts). The save button lives in the sheet footer so it stays reachable with the
 * Android keyboard open (Sheet follows `visualViewport`).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import type { VitalKind } from '../../db/types'
import { useToday } from '../../app/useToday'
import { SAVE_FAILED_RESULT, useSafeWrite } from '../../app/safeSave'
import { nowLocalTime } from '../../domain/dates'
import { GLUCOSE_CONTEXTS, VITAL_LABEL, type GlucoseContext } from '../../domain/vitals'
import { formatNumber, textRangeError } from '../../domain/units'
import { NumField, TextField, toNum } from '../../ui/fields'
import { Icon, type IconName } from '../../ui/Icon'
import { Segmented, Sheet } from '../../ui/kit'
import { Row } from '../../ui/Row'
import { Stepper } from '../../ui/Stepper'
import { containersOf } from '../hydration/containers'
import { VitalSheet } from '../vitals/VitalSheet'
import { ActivitySheet, RecoverySheet } from './logSheets'
import { useSavedToast } from './useSavedToast'
import { addSleep, addWater, addWeight, hoursBetween, saveVital, validateSleep, validateVital, validateWeightKg } from './writers'

export type QuickKind = 'weight' | 'water' | 'sleep' | 'bloodPressure' | 'glucose' | 'more' | 'activity' | 'recovery' | 'vital'
export interface QuickTarget {
  kind: QuickKind
  /** For `vital`: which measure the full vital sheet starts on. */
  vital?: VitalKind
}

export const QUICK_ACTIONS: readonly { kind: QuickKind; label: string; icon: IconName }[] = [
  { kind: 'weight', label: 'Peso', icon: 'scale' },
  { kind: 'water', label: 'Agua', icon: 'droplet' },
  { kind: 'sleep', label: 'Sueño', icon: 'bed' },
  { kind: 'bloodPressure', label: 'Presión', icon: 'heart' },
  { kind: 'more', label: 'Más', icon: 'dots' },
]

const SAVE = 'btn-primary w-full'

/** The "Registrar" row: one chip per quick action (44 px high), then the host renders the matching sheet. */
export function QuickLogBar({ onOpen }: { onOpen: (t: QuickTarget) => void }) {
  return (
    <section aria-label="Registrar" data-testid="quick-log">
      <div className="mb-1.5 text-label font-medium text-muted">Registrar</div>
      <div className="grid grid-cols-5 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            className="flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-surface px-1 text-label font-medium text-ink outline-none transition-colors duration-state hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-accent active:bg-surface2"
            onClick={() => onOpen({ kind: a.kind })}
            data-testid={`quick-${a.kind}`}
          >
            <Icon name={a.icon} size={18} className="text-muted" />
            <span className="max-w-full truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Renders the sheet of the active target. Mount once per screen. */
export function QuickLogHost({ target, onTarget, latestWeight }: { target: QuickTarget | null; onTarget: (t: QuickTarget | null) => void; latestWeight: { kg: number; date: string } | null }) {
  const close = () => onTarget(null)
  const k = target?.kind
  return (
    <>
      <QuickWeightSheet open={k === 'weight'} onClose={close} latest={latestWeight} />
      <QuickWaterSheet open={k === 'water'} onClose={close} />
      <QuickSleepSheet open={k === 'sleep'} onClose={close} />
      <QuickPressureSheet open={k === 'bloodPressure'} onClose={close} />
      <QuickGlucoseSheet open={k === 'glucose'} onClose={close} />
      <MoreSheet open={k === 'more'} onClose={close} onTarget={onTarget} />
      <ActivitySheet open={k === 'activity'} existing={null} onClose={close} />
      <RecoverySheet open={k === 'recovery'} existing={null} onClose={close} />
      <VitalSheet open={k === 'vital'} existing={null} onClose={close} initialKind={target?.vital} />
    </>
  )
}

// ───────────── Weight ─────────────
export function QuickWeightSheet({ open, onClose, latest }: { open: boolean; onClose: () => void; latest: { kg: number; date: string } | null }) {
  const r = useRepo()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const [kg, setKg] = useState(latest?.kg ?? 70)
  // False while the typed text is not a usable weight (e.g. "1.200" = 1200 kg): saving is blocked.
  const [typedOk, setTypedOk] = useState(true)
  useEffect(() => {
    if (open) {
      setKg(latest?.kg ?? 70)
      setTypedOk(true)
    }
    // The prefill is read when the sheet opens; a later change of `latest` must not move the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const error = validateWeightKg(kg)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Registrar peso"
      footer={
        <button
          className={SAVE}
          disabled={!!error || !typedOk}
          data-testid="quick-save"
          onClick={async () => {
            // Success toast only after the write resolved; a failure keeps the sheet open.
            const undo = await write(() => addWeight(r, kg))
            if (undo === SAVE_FAILED_RESULT) return
            saved(`Peso guardado: ${formatNumber(kg, 1)} kg`, undo)
            onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <Stepper label="Peso" unit="kg" value={kg} onChange={setKg} step={0.1} min={20} max={400} error={error && kg > 400 ? error : undefined} onValidity={setTypedOk} />
        <p className="text-label text-muted">{latest ? `Prellenado con tu último peso (${formatNumber(latest.kg, 1)} kg).` : 'Sin peso anterior: ajusta el valor.'} Mejor en ayunas y a la misma hora.</p>
      </div>
    </Sheet>
  )
}

// ───────────── Water ─────────────
export function QuickWaterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const profile = useProfile()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const [custom, setCustom] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setCustom('')
      setErr(null)
    }
  }, [open])
  const add = async (ml: number, drink: string | null) => {
    const undo = await write(() => addWater(r, ml, drink))
    if (undo === SAVE_FAILED_RESULT) return
    saved(`+${formatNumber(ml, 0)} ml de agua`, undo)
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Registrar agua">
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-2 gap-2">
          {containersOf(profile.settings).map((c) => (
            <button key={c.ml} type="button" className="btn-secondary min-h-[64px] flex-col gap-0" onClick={() => void add(c.ml, c.label.toLowerCase())} data-testid={`quick-water-${c.ml}`}>
              <span className="readout text-readout">+{formatNumber(c.ml, 0)}</span>
              <span className="text-label font-normal text-muted">{c.label} · ml</span>
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = toNum(custom)
            if (n === null || n < 10 || n > 3000) return setErr('La cantidad debe estar entre 10 y 3000 ml.')
            void add(Math.round(n), null)
          }}
        >
          <div className="min-w-0 flex-1">
            <NumField label="Otra cantidad" unit="ml" value={custom} onChange={setCustom} error={err} />
          </div>
          <button type="submit" className="btn-secondary mb-0.5">
            Añadir
          </button>
        </form>
        <Link to="/agua" className="inline-flex min-h-[44px] items-center text-label text-muted underline" onClick={onClose}>
          Editar recipientes
        </Link>
      </div>
    </Sheet>
  )
}

// ───────────── Sleep ─────────────
export function QuickSleepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const [bed, setBed] = useState('')
  const [wake, setWake] = useState('')
  const [hours, setHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setBed('')
      setWake('')
      setHours('')
      setError(null)
    }
  }, [open])
  const auto = bed && wake ? hoursBetween(bed, wake) : null
  const today = useToday()
  const input = { date: today, bedtime: bed || null, waketime: wake || null, hours: toNum(hours), quality: null }
  const invalid = textRangeError(hours, 0.1, 24, 'h') ?? validateSleep(input)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Registrar sueño"
      footer={
        <button
          className={SAVE}
          disabled={!!invalid}
          data-testid="quick-save"
          onClick={async () => {
            if (invalid) return setError(invalid)
            const undo = await write(() => addSleep(r, input))
            if (undo === SAVE_FAILED_RESULT) return
            saved('Sueño guardado', undo)
            onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <p className="text-label text-muted">Noche que termina hoy.</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Me acosté" type="time" value={bed} onChange={setBed} />
          <TextField label="Me levanté" type="time" value={wake} onChange={setWake} />
        </div>
        <NumField label="Horas dormidas" unit="h" value={hours} onChange={setHours} placeholder={auto !== null ? formatNumber(auto, 2) : ''} hint={auto !== null && !hours ? `Calculado: ${formatNumber(auto, 2)} h en cama` : 'Opcional si indicas las dos horas'} />
        {error ? (
          <p role="alert" className="text-label text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

// ───────────── Blood pressure ─────────────
export function QuickPressureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (open) {
      setSys('')
      setDia('')
      setTried(false)
    }
  }, [open])
  const today = useToday()
  const input = { kind: 'bloodPressure' as const, date: today, time: null as string | null, systolic: toNum(sys), diastolic: toNum(dia) }
  const error = validateVital(input)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Registrar presión"
      footer={
        <button
          className={SAVE}
          data-testid="quick-save"
          onClick={async () => {
            setTried(true)
            if (error) return
            // Time in the app's time zone, like the date (not the device clock's zone).
            const time = nowLocalTime()
            const undo = await write(() => saveVital(r, { ...input, time }))
            if (undo === SAVE_FAILED_RESULT) return
            saved(`Presión guardada: ${input.systolic}/${input.diastolic} mmHg`, undo)
            onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Sistólica (alta)" unit="mmHg" value={sys} onChange={setSys} autoFocus ariaLabel="Presión sistólica" />
          <NumField label="Diastólica (baja)" unit="mmHg" value={dia} onChange={setDia} ariaLabel="Presión diastólica" />
        </div>
        {tried && error ? (
          <p role="alert" className="text-label text-bad">
            {error}
          </p>
        ) : null}
        <p className="text-label text-muted">La clasificación orientativa aparece en Signos vitales. No reemplaza una valoración médica.</p>
      </div>
    </Sheet>
  )
}

// ───────────── Glucose ─────────────
export function QuickGlucoseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const saved = useSavedToast()
  const write = useSafeWrite()
  const [val, setVal] = useState('')
  const [ctx, setCtx] = useState<GlucoseContext>('ayunas')
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (open) {
      setVal('')
      setCtx('ayunas')
      setTried(false)
    }
  }, [open])
  const today = useToday()
  const input = { kind: 'glucose' as const, date: today, time: null as string | null, value: toNum(val), context: ctx }
  const error = validateVital(input)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Registrar glucosa"
      footer={
        <button
          className={SAVE}
          data-testid="quick-save"
          onClick={async () => {
            setTried(true)
            if (error) return
            const time = nowLocalTime()
            const undo = await write(() => saveVital(r, { ...input, time }))
            if (undo === SAVE_FAILED_RESULT) return
            saved(`${VITAL_LABEL.glucose} guardada: ${input.value} mg/dL`, undo)
            onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <NumField label="Glucosa" unit="mg/dL" value={val} onChange={setVal} autoFocus ariaLabel="Glucosa" />
        <div>
          <span className="label">Contexto</span>
          <Segmented ariaLabel="Contexto de la glucosa" value={ctx} onChange={setCtx} options={GLUCOSE_CONTEXTS} size="sm" />
        </div>
        {tried && error ? (
          <p role="alert" className="text-label text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

// ───────────── More ─────────────
function MoreSheet({ open, onClose, onTarget }: { open: boolean; onClose: () => void; onTarget: (t: QuickTarget | null) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Registrar más">
      <div className="divide-rows pb-2">
        <Row leading={<Icon name="clipboard" size={20} />} title="Glucosa" subtitle="Valor y contexto" onClick={() => onTarget({ kind: 'glucose' })} />
        <Row leading={<Icon name="activity" size={20} />} title="Actividad" subtitle="Pasos, minutos, distancia, kcal" onClick={() => onTarget({ kind: 'activity' })} />
        <Row leading={<Icon name="heart" size={20} />} title="Otros signos vitales" subtitle="Pulso, SpO₂, temperatura" onClick={() => onTarget({ kind: 'vital', vital: 'restingHr' })} />
        <Row leading={<Icon name="bed" size={20} />} title="Recuperación" subtitle="Energía, estrés, ánimo (autoevaluado)" onClick={() => onTarget({ kind: 'recovery' })} />
        <Row leading={<Icon name="ruler" size={20} />} title="Medición corporal completa" subtitle="Peso, perímetros y pliegues" to="/cuerpo/nueva" />
        <Row leading={<Icon name="pill" size={20} />} title="Hábitos de hoy" to="/habitos" />
      </div>
    </Sheet>
  )
}
