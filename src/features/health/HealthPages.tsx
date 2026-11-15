import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import { DateNav, useDateParam } from '../../app/useDate'
import type { ActivityLog, Habit, RecoveryLog, SleepLog } from '../../db/types'
import { addDays, formatDateEs, todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { NumField, SelectField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Card, EmptyState, PageHeader, Segmented, Sheet } from '../../ui/kit'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function useOpenFromQuery(): [boolean, (v: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('nuevo') === '1')
  useEffect(() => {
    if (params.get('nuevo') === '1') {
      const p = new URLSearchParams(params)
      p.delete('nuevo')
      setParams(p, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [open, setOpen]
}

function Scale({ label, value, onChange, low, high }: { label: string; value: number | null; onChange: (v: number | null) => void; low: string; high: string }) {
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
      <div className="mt-0.5 flex justify-between text-[10px] text-faint">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  )
}

function Flags({ row }: { row: { origin?: string; approx?: boolean; excludeFromStats?: boolean } }) {
  return (
    <>
      {row.origin === 'phase0' ? <Badge>Importado</Badge> : null}
      {row.approx ? <Badge tone="warn">Aprox.</Badge> : null}
    </>
  )
}

function StatCard({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: ReactNode }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-bold">
        {value}
        {unit ? <span className="ml-1 text-sm font-medium text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="text-[11px] text-faint">{hint}</div> : null}
    </Card>
  )
}

// ───────────────────────── Activity ─────────────────────────

const ACTIVITY_TYPES = ['Caminata', 'Carrera', 'Bicicleta', 'Natación', 'HIIT', 'Deporte', 'Pulsera / reloj', 'Otro'] as const

export function ActivityPage() {
  const r = useRepo()
  const profile = useProfile()
  const today = todayLocal()
  const rows = useLiveQuery(() => r.range('activityLogs', addDays(today, -365), '9999-12-31'), [r, today])
  const [open, setOpen] = useOpenFromQuery()
  const [edit, setEdit] = useState<ActivityLog | null>(null)
  const sorted = (rows ?? []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const last7 = sorted.filter((a) => a.date > addDays(today, -7) && !a.excludeFromStats)
  const stepsByDay = new Map<string, number>()
  for (const a of last7) if (a.steps !== null) stepsByDay.set(a.date, (stepsByDay.get(a.date) ?? 0) + a.steps)
  const avgSteps = mean([...stepsByDay.values()])
  const minutes7 = last7.reduce((s, a) => s + (a.minutes ?? 0), 0)
  return (
    <>
      <PageHeader
        title="Actividad"
        back="/mas"
        actions={
          <button className="btn-primary px-3" onClick={() => setOpen(true)} data-testid="new-activity">
            <Icon name="plus" size={18} /> Registrar
          </button>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Pasos (media 7 días)" value={avgSteps !== null ? formatNumber(avgSteps, 0) : '—'} hint={avgSteps !== null ? `${stepsByDay.size} días con dato` : 'Sin datos'} />
          <StatCard label="Minutos activos (7 días)" value={formatNumber(minutes7, 0)} unit="min" />
        </div>
        <p className="text-xs text-muted">
          Las kcal de actividad son informativas{profile.settings.addActivityKcal ? ' y se suman a tu objetivo diario (ajuste activado en Perfil).' : '; no se suman a tu objetivo de comida salvo que lo actives en Perfil.'} Las
          pulseras suelen sobrestimarlas.
        </p>
        {sorted.length ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {sorted.slice(0, 120).map((a) => (
              <li key={a.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2/60" onClick={() => setEdit(a)}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {a.type} <span className="font-normal text-muted">· {formatDateEs(a.date, 'weekday')}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {[
                        a.steps !== null ? `${formatNumber(a.steps, 0)} pasos` : null,
                        a.minutes !== null ? `${formatNumber(a.minutes, 0)} min` : null,
                        a.distanceKm !== null ? `${formatNumber(a.distanceKm, 2)} km` : null,
                        a.activeKcal !== null ? `${formatNumber(a.activeKcal, 0)} kcal` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Sin valores'}
                    </div>
                  </div>
                  <Flags row={a} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="activity" title="Sin actividad registrada">
            Registra pasos, minutos de cardio o el resumen de tu pulsera.
          </EmptyState>
        )}
      </div>
      <ActivitySheet open={open || !!edit} existing={edit} onClose={() => (setOpen(false), setEdit(null))} />
    </>
  )
}

function ActivitySheet({ open, existing, onClose }: { open: boolean; existing: ActivityLog | null; onClose: () => void }) {
  const r = useRepo()
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
  const canSave = Object.values(vals).some((v) => v !== null) && Object.values(vals).every((v) => v === null || v >= 0)
  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Editar actividad' : 'Registrar actividad'}>
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Fecha" type="date" value={date} onChange={setDate} />
          <SelectField label="Tipo" value={type} onChange={setType} options={ACTIVITY_TYPES.map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Pasos" value={steps} onChange={setSteps} />
          <NumField label="Minutos" unit="min" value={minutes} onChange={setMinutes} />
          <NumField label="Distancia" unit="km" value={km} onChange={setKm} />
          <NumField label="Kcal activas" unit="kcal" value={kcal} onChange={setKcal} hint="Según tu dispositivo" />
        </div>
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        <button
          className="btn-primary w-full"
          disabled={!canSave}
          data-testid="save-activity"
          onClick={async () => {
            const data = { date, type, ...vals, notes: notes.trim() || undefined }
            if (existing) await r.put('activityLogs', { ...existing, ...data, approx: false, excludeFromStats: false })
            else await r.add('activityLogs', { ...data, origin: 'app' })
            onClose()
          }}
        >
          Guardar
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar este registro?')) return
              await r.remove('activityLogs', existing.id)
              onClose()
            }}
          >
            <Icon name="trash" size={16} /> Eliminar
          </button>
        ) : null}
      </div>
    </Sheet>
  )
}

// ───────────────────────── Sleep + recovery ─────────────────────────

function hoursBetween(bed: string, wake: string): number | null {
  const m = (s: string) => {
    const x = /^(\d{1,2}):(\d{2})$/.exec(s)
    return x ? Number(x[1]) * 60 + Number(x[2]) : null
  }
  const b = m(bed)
  const w = m(wake)
  if (b === null || w === null) return null
  let d = w - b
  if (d <= 0) d += 1440
  return Math.round((d / 60) * 100) / 100
}

export function SleepPage() {
  const r = useRepo()
  const today = todayLocal()
  const sleep = useLiveQuery(() => r.range('sleepLogs', addDays(today, -365), '9999-12-31'), [r, today])
  const rec = useLiveQuery(() => r.range('recoveryLogs', addDays(today, -365), '9999-12-31'), [r, today])
  const [tab, setTab] = useState<'sleep' | 'rec'>('sleep')
  const [open, setOpen] = useOpenFromQuery()
  const [editSleep, setEditSleep] = useState<SleepLog | null>(null)
  const [editRec, setEditRec] = useState<RecoveryLog | null>(null)
  const sleepSorted = (sleep ?? []).slice().sort((a, b) => b.date.localeCompare(a.date))
  const recSorted = (rec ?? []).slice().sort((a, b) => b.date.localeCompare(a.date))
  const h7 = mean(sleepSorted.filter((s) => s.date > addDays(today, -7) && !s.excludeFromStats && s.hours !== null).map((s) => s.hours as number))
  const h30 = mean(sleepSorted.filter((s) => s.date > addDays(today, -30) && !s.excludeFromStats && s.hours !== null).map((s) => s.hours as number))
  return (
    <>
      <PageHeader
        title="Sueño y recuperación"
        back="/mas"
        actions={
          <button className="btn-primary px-3" onClick={() => setOpen(true)} data-testid="new-sleep">
            <Icon name="plus" size={18} /> Registrar
          </button>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sueño (media 7 días)" value={h7 !== null ? formatNumber(h7, 1) : '—'} unit="h" />
          <StatCard label="Sueño (media 30 días)" value={h30 !== null ? formatNumber(h30, 1) : '—'} unit="h" />
        </div>
        <Segmented<'sleep' | 'rec'>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sleep', label: 'Sueño' },
            { value: 'rec', label: 'Recuperación' },
          ]}
        />
        {tab === 'sleep' ? (
          sleepSorted.length ? (
            <ul className="card divide-y divide-line overflow-hidden">
              {sleepSorted.slice(0, 120).map((s) => (
                <li key={s.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2/60" onClick={() => setEditSleep(s)}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{formatDateEs(s.date, 'weekday')}</div>
                      <div className="text-xs text-muted">
                        {[s.hours !== null ? `${formatNumber(s.hours, 1)} h` : null, s.bedtime && s.waketime ? `${s.bedtime} → ${s.waketime}` : s.bedtime ? `acostarse ${s.bedtime}` : s.waketime ? `levantarse ${s.waketime}` : null, s.quality ? `calidad ${s.quality}/5` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                    <Flags row={s} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="bed" title="Sin registros de sueño">
              Anota a qué hora te acostaste y te levantaste; las horas se calculan solas.
            </EmptyState>
          )
        ) : recSorted.length ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {recSorted.slice(0, 120).map((x) => (
              <li key={x.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2/60" onClick={() => setEditRec(x)}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{formatDateEs(x.date, 'weekday')}</div>
                    <div className="text-xs text-muted">
                      {[x.energy ? `energía ${x.energy}/5` : null, x.soreness ? `dolor muscular ${x.soreness}/5` : null, x.stress ? `estrés ${x.stress}/5` : null, x.mood ? `ánimo ${x.mood}/5` : null, x.restingHr ? `FC reposo ${x.restingHr}` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="heart" title="Sin registros de recuperación">
            Valora energía, dolor muscular, estrés y ánimo del 1 al 5.
          </EmptyState>
        )}
      </div>
      <SleepSheet open={(open && tab === 'sleep') || !!editSleep} existing={editSleep} onClose={() => (setOpen(false), setEditSleep(null))} />
      <RecoverySheet open={(open && tab === 'rec') || !!editRec} existing={editRec} onClose={() => (setOpen(false), setEditRec(null))} />
    </>
  )
}

function SleepSheet({ open, existing, onClose }: { open: boolean; existing: SleepLog | null; onClose: () => void }) {
  const r = useRepo()
  const [date, setDate] = useState(todayLocal())
  const [bed, setBed] = useState('')
  const [wake, setWake] = useState('')
  const [hours, setHours] = useState('')
  const [quality, setQuality] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!open) return
    setDate(existing?.date ?? todayLocal())
    setBed(existing?.bedtime ?? '')
    setWake(existing?.waketime ?? '')
    setHours(numStr(existing?.hours ?? null, 2))
    setQuality(existing?.quality ?? null)
    setNotes(existing?.notes ?? '')
  }, [open, existing])
  const auto = bed && wake ? hoursBetween(bed, wake) : null
  const h = toNum(hours) ?? auto
  const canSave = (h !== null && h > 0 && h <= 24) || !!bed || !!wake || quality !== null
  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Editar sueño' : 'Registrar sueño'}>
      <div className="space-y-3 pb-2">
        <TextField label="Fecha (día en que despertaste)" type="date" value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Me acosté" type="time" value={bed} onChange={setBed} />
          <TextField label="Me levanté" type="time" value={wake} onChange={setWake} />
        </div>
        <NumField label="Horas dormidas" unit="h" value={hours} onChange={setHours} placeholder={auto !== null ? formatNumber(auto, 2) : ''} hint={auto !== null && !hours ? `Calculado: ${formatNumber(auto, 2)} h en cama` : 'Opcional si indicas las horas'} />
        <Scale label="Calidad" value={quality} onChange={setQuality} low="Muy mala" high="Excelente" />
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        <button
          className="btn-primary w-full"
          disabled={!canSave}
          data-testid="save-sleep"
          onClick={async () => {
            const data = { date, bedtime: bed || null, waketime: wake || null, hours: h, quality, notes: notes.trim() || undefined }
            if (existing) await r.put('sleepLogs', { ...existing, ...data, approx: false, excludeFromStats: false })
            else await r.add('sleepLogs', { ...data, origin: 'app' })
            onClose()
          }}
        >
          Guardar
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar este registro?')) return
              await r.remove('sleepLogs', existing.id)
              onClose()
            }}
          >
            <Icon name="trash" size={16} /> Eliminar
          </button>
        ) : null}
      </div>
    </Sheet>
  )
}

function RecoverySheet({ open, existing, onClose }: { open: boolean; existing: RecoveryLog | null; onClose: () => void }) {
  const r = useRepo()
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
  const canSave = [energy, soreness, stress, mood, toNum(hr)].some((v) => v !== null)
  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Editar recuperación' : 'Registrar recuperación'}>
      <div className="space-y-3 pb-2">
        <TextField label="Fecha" type="date" value={date} onChange={setDate} />
        <Scale label="Energía" value={energy} onChange={setEnergy} low="Agotado" high="Excelente" />
        <Scale label="Dolor muscular" value={soreness} onChange={setSoreness} low="Nada" high="Mucho" />
        <Scale label="Estrés" value={stress} onChange={setStress} low="Bajo" high="Alto" />
        <Scale label="Ánimo" value={mood} onChange={setMood} low="Bajo" high="Muy bueno" />
        <NumField label="FC en reposo" unit="lpm" value={hr} onChange={setHr} />
        <TextArea label="Notas" value={notes} onChange={setNotes} />
        <button
          className="btn-primary w-full"
          disabled={!canSave}
          onClick={async () => {
            const data = { date, energy, soreness, stress, mood, restingHr: toNum(hr), notes: notes.trim() || undefined }
            if (existing) await r.put('recoveryLogs', { ...existing, ...data })
            else await r.add('recoveryLogs', { ...data, origin: 'app' })
            onClose()
          }}
        >
          Guardar
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar este registro?')) return
              await r.remove('recoveryLogs', existing.id)
              onClose()
            }}
          >
            <Icon name="trash" size={16} /> Eliminar
          </button>
        ) : null}
      </div>
    </Sheet>
  )
}

// ───────────────────────── Habits + supplements ─────────────────────────

export function HabitsPage() {
  const r = useRepo()
  const [date, setDate] = useDateParam()
  const habits = useLiveQuery(() => r.all('habits'), [r])
  const logs = useLiveQuery(() => r.range('habitLogs', addDays(date, -60), date), [r, date])
  const [edit, setEdit] = useState<Habit | 'new' | null>(null)
  const active = (habits ?? []).filter((h) => h.active).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const inactive = (habits ?? []).filter((h) => !h.active)
  const valueOn = (hid: string, d: string) => (logs ?? []).filter((l) => l.habitId === hid && l.date === d).reduce((s, l) => s + l.value, 0)

  async function setValue(h: Habit, v: number) {
    const existing = (logs ?? []).filter((l) => l.habitId === h.id && l.date === date)
    await r.removeMany('habitLogs', existing.map((l) => l.id))
    if (v > 0) await r.add('habitLogs', { habitId: h.id, date, value: v })
  }
  function streak(h: Habit): number {
    let n = 0
    let d = valueOn(h.id, date) >= h.target ? date : addDays(date, -1)
    while (valueOn(h.id, d) >= h.target && n < 60) {
      n++
      d = addDays(d, -1)
    }
    return n
  }

  return (
    <>
      <PageHeader
        title="Hábitos y suplementos"
        back="/mas"
        actions={
          <button className="btn-secondary px-3" onClick={() => setEdit('new')} data-testid="new-habit">
            <Icon name="plus" size={18} /> Nuevo
          </button>
        }
      />
      <DateNav date={date} onChange={setDate} />
      <div className="mt-4 space-y-5">
        {active.length ? (
          <ul className="card divide-y divide-line overflow-hidden" data-testid="habit-list">
            {active.map((h) => {
              const v = valueOn(h.id, date)
              const done = v >= h.target
              const s = streak(h)
              return (
                <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                  {h.target <= 1 ? (
                    <button
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${done ? 'border-accent bg-accent text-accent-ink' : 'border-line text-faint'}`}
                      aria-pressed={done}
                      aria-label={done ? `Desmarcar ${h.name}` : `Marcar ${h.name}`}
                      onClick={() => void setValue(h, done ? 0 : 1)}
                      data-testid="habit-toggle"
                    >
                      <Icon name="check" size={18} />
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button className="btn-ghost p-1.5" aria-label="Menos" onClick={() => void setValue(h, Math.max(0, v - 1))}>
                        <Icon name="minus" size={16} />
                      </button>
                      <span className={`num w-12 text-center text-sm font-semibold ${done ? 'text-accent' : ''}`}>
                        {formatNumber(v, 1)}/{formatNumber(h.target, 1)}
                      </span>
                      <button className="btn-ghost p-1.5" aria-label="Más" onClick={() => void setValue(h, v + 1)}>
                        <Icon name="plus" size={16} />
                      </button>
                    </div>
                  )}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(h)}>
                    <div className="truncate font-medium">
                      {h.name} {h.kind === 'supplement' ? <Badge tone="accent">Suplemento</Badge> : null}
                    </div>
                    <div className="text-xs text-muted">
                      {[h.dose, h.target > 1 ? `meta ${formatNumber(h.target, 1)} ${h.unit ?? ''}`.trim() : null, s ? `racha ${s} ${s === 1 ? 'día' : 'días'}` : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState icon="pill" title="Sin hábitos" action={<button className="btn-primary" onClick={() => setEdit('new')}>Crear hábito</button>}>
            Crea hábitos (agua, pasos, estiramientos) o suplementos con su dosis y márcalos cada día.
          </EmptyState>
        )}
        {inactive.length ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted">Archivados ({inactive.length})</summary>
            <ul className="mt-2 space-y-1">
              {inactive.map((h) => (
                <li key={h.id}>
                  <button className="text-sm text-muted underline" onClick={() => setEdit(h)}>
                    {h.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <HabitSheet existing={edit === 'new' ? null : edit} open={edit !== null} onClose={() => setEdit(null)} nextOrder={(habits ?? []).length} />
    </>
  )
}

function HabitSheet({ open, existing, onClose, nextOrder }: { open: boolean; existing: Habit | null; onClose: () => void; nextOrder: number }) {
  const r = useRepo()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'habit' | 'supplement'>('habit')
  const [dose, setDose] = useState('')
  const [target, setTarget] = useState('1')
  const [unit, setUnit] = useState('')
  useEffect(() => {
    if (!open) return
    setName(existing?.name ?? '')
    setKind(existing?.kind ?? 'habit')
    setDose(existing?.dose ?? '')
    setTarget(numStr(existing?.target ?? 1, 1))
    setUnit(existing?.unit ?? '')
  }, [open, existing])
  const t = toNum(target)
  const canSave = name.trim().length > 0 && t !== null && t > 0
  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Editar' : 'Nuevo hábito o suplemento'}>
      <div className="space-y-3 pb-2">
        <Segmented<'habit' | 'supplement'>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'habit', label: 'Hábito' },
            { value: 'supplement', label: 'Suplemento' },
          ]}
        />
        <TextField label="Nombre" value={name} onChange={setName} autoFocus placeholder={kind === 'supplement' ? 'p. ej. Creatina' : 'p. ej. Vasos de agua'} />
        {kind === 'supplement' ? <TextField label="Dosis" value={dose} onChange={setDose} placeholder="p. ej. 5 g" /> : null}
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Meta diaria" value={target} onChange={setTarget} hint="1 = marcar sí/no" />
          <TextField label="Unidad" value={unit} onChange={setUnit} placeholder="vasos, tomas…" />
        </div>
        <button
          className="btn-primary w-full"
          disabled={!canSave}
          data-testid="save-habit"
          onClick={async () => {
            const data = { name: name.trim(), kind, dose: kind === 'supplement' && dose.trim() ? dose.trim() : null, target: t as number, unit: unit.trim() || null }
            if (existing) await r.put('habits', { ...existing, ...data })
            else await r.add('habits', { ...data, active: true, order: nextOrder })
            onClose()
          }}
        >
          Guardar
        </button>
        {existing ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-secondary"
              onClick={async () => {
                await r.update('habits', existing.id, { active: !existing.active })
                onClose()
              }}
            >
              {existing.active ? 'Archivar' : 'Reactivar'}
            </button>
            <button
              className="btn-danger"
              onClick={async () => {
                if (!confirm(`¿Eliminar «${existing.name}» y su historial?`)) return
                const logs = await r.byIndex('habitLogs', 'habitId', existing.id)
                await r.removeMany('habitLogs', logs.map((l) => l.id))
                await r.remove('habits', existing.id)
                onClose()
              }}
            >
              Eliminar
            </button>
          </div>
        ) : null}
        <p className="text-xs text-faint">
          Registrar un suplemento no es una recomendación médica. <Link to="/ajustes" className="underline">Más información</Link>
        </p>
      </div>
    </Sheet>
  )
}
