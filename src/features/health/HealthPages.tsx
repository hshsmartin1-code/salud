import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import { DateNav, useDateParam } from '../../app/useDate'
import type { ActivityLog, Habit, RecoveryLog, SleepLog } from '../../db/types'
import { addDays, formatDateEs } from '../../domain/dates'
import { formatNumber, textRangeError } from '../../domain/units'
import { useConfirm } from '../../ui/Confirm'
import { Disclosure } from '../../ui/Disclosure'
import { NumField, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Segmented, Sheet } from '../../ui/kit'
import { Metric } from '../../ui/Metric'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { ChartPanel } from '../../ui/charts/ChartPanel'
import { hcRowsFor, HealthRows, originLabel, useLimit } from './HealthRows'
import { useHealthInput, usePeriod, useQueryChoice } from './hooks'
import { ActivitySheet, Flags, RecoverySheet, SleepSheet } from './logSheets'
import { MetricBlock, MetricDetail } from './MetricDetail'
import { periodTitle, rangeText } from './period'
import { ScheduleChart, type Night } from './ScheduleChart'
import { buildSeries, sleepConsistency } from './series'
import { buildView, figure } from './view'
import type { MetricId } from './metrics'
import { useSavedToast } from './useSavedToast'

/** `?nuevo=1` opens the "new record" sheet once (links from other screens), then clears itself. */
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

const inRange = <T extends { date: string }>(rows: readonly T[] | undefined, range: { from: string; to: string }): T[] =>
  (rows ?? []).filter((x) => x.date >= range.from && x.date <= range.to)

// ───────────────────────── Activity ─────────────────────────
type ActivityTab = 'steps' | 'activeMinutes' | 'activeKcal'
const ACTIVITY_TABS = [
  { value: 'steps' as const, label: 'Pasos' },
  { value: 'activeMinutes' as const, label: 'Minutos' },
  { value: 'activeKcal' as const, label: 'Energía activa' },
]

export function ActivityPage() {
  const profile = useProfile()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const [tab, setTab] = useQueryChoice<ActivityTab>('m', ['steps', 'activeMinutes', 'activeKcal'], 'steps')
  const [open, setOpen] = useOpenFromQuery()
  const [edit, setEdit] = useState<ActivityLog | null>(null)
  const rows = useMemo(() => inRange(input?.activity, period.range).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [input, period])

  const lim = useLimit(rows.length)
  return (
    <>
      <MetricDetail
        testId="activity-page"
        title="Actividad"
        period={period}
        onPeriod={setPeriod}
        tabs={ACTIVITY_TABS}
        tab={tab}
        onTab={setTab}
        tabsLabel="Métricas de actividad"
        action={
          <button className="btn-primary px-3" onClick={() => setOpen(true)} data-testid="new-activity">
            <Icon name="plus" size={18} /> Registrar
          </button>
        }
      >
        <MetricBlock
          id={tab}
          input={input}
          period={period}
          today={today}
          label={tab === 'steps' ? 'Pasos por día' : tab === 'activeMinutes' ? 'Minutos activos por día' : 'Energía activa por día'}
          emptyAction={
            <button className="btn-secondary" onClick={() => setOpen(true)}>
              Registrar actividad
            </button>
          }
          footnote={
            tab === 'activeKcal' ? (
              <p className="mt-1 text-label text-muted">
                Las kcal de actividad son informativas{profile.settings.addActivityKcal ? ' y se suman a tu objetivo diario (ajuste activado en Perfil).' : '; no se suman a tu objetivo de comida salvo que lo actives en Perfil.'} Las pulseras suelen sobrestimarlas.
              </p>
            ) : null
          }
        />
        <section aria-label="Registros de actividad">
          <SectionHeader title="Registros" hint={`${rows.length} en el periodo`} />
          {rows.length ? (
            <div className="divide-rows mt-1" data-testid="activity-list">
              {rows.slice(0, lim.shown).map((a) => (
                <Row
                  key={a.id}
                  onClick={() => setEdit(a)}
                  title={
                    <>
                      {a.type} <span className="font-normal text-muted">· {formatDateEs(a.date, 'weekday')}</span>
                    </>
                  }
                  subtitle={`${[a.steps !== null ? `${formatNumber(a.steps, 0)} pasos` : null, a.minutes !== null ? `${formatNumber(a.minutes, 0)} min` : null, a.distanceKm !== null ? `${formatNumber(a.distanceKm, 2)} km` : null, a.activeKcal !== null ? `${formatNumber(a.activeKcal, 0)} kcal` : null].filter(Boolean).join(' · ') || 'Sin valores'} · ${originLabel(a.origin)}`}
                  trailing={a.approx || a.origin === 'phase0' ? <Flags row={a} /> : null}
                />
              ))}
              {lim.more}
            </div>
          ) : (
            <p className="mt-2 text-body text-muted">{input ? 'No hay registros manuales en este periodo. Registra pasos, minutos de cardio o el resumen de tu pulsera.' : 'Cargando…'}</p>
          )}
        </section>
        {input ? <HealthRows rows={hcRowsFor(input.health, ['steps', 'exercise', 'activeKcal', 'distanceM'], period.range)} /> : null}
      </MetricDetail>
      <ActivitySheet open={open || !!edit} existing={edit} onClose={() => (setOpen(false), setEdit(null))} />
    </>
  )
}

// ───────────────────────── Sleep + recovery ─────────────────────────
type SleepTab = 'sleep' | 'schedule' | 'recovery'
const SLEEP_TABS = [
  { value: 'sleep' as const, label: 'Duración' },
  { value: 'schedule' as const, label: 'Horarios' },
  { value: 'recovery' as const, label: 'Recuperación' },
]
const SCALES: readonly { value: MetricId; label: string }[] = [
  { value: 'energyScale', label: 'Energía percibida' },
  { value: 'moodScale', label: 'Ánimo percibido' },
  { value: 'stressScale', label: 'Estrés percibido' },
  { value: 'sorenessScale', label: 'Dolor percibido' },
]
const SCALE_IDS = SCALES.map((s) => s.value)
const TAB_OF_METRIC: Record<string, SleepTab> = { sleep: 'sleep', bedtime: 'schedule', wakeTime: 'schedule', energyScale: 'recovery', moodScale: 'recovery', stressScale: 'recovery', sorenessScale: 'recovery' }

export function SleepPage() {
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const [m, setM] = useQueryChoice<string>('m', ['sleep', 'schedule', 'recovery', 'bedtime', 'wakeTime', ...SCALE_IDS], 'sleep')
  const tab: SleepTab = (SLEEP_TABS.some((t) => t.value === m) ? (m as SleepTab) : TAB_OF_METRIC[m]) ?? 'sleep'
  const scale: MetricId = SCALE_IDS.includes(m as MetricId) ? (m as MetricId) : 'energyScale'
  const [open, setOpen] = useOpenFromQuery()
  const [editSleep, setEditSleep] = useState<SleepLog | null>(null)
  const [editRec, setEditRec] = useState<RecoveryLog | null>(null)
  const [recOpen, setRecOpen] = useState(false)
  const sleepRows = useMemo(() => inRange(input?.sleep, period.range).sort((a, b) => b.date.localeCompare(a.date)), [input, period])
  const recRows = useMemo(() => inRange(input?.recovery, period.range).sort((a, b) => b.date.localeCompare(a.date)), [input, period])

  const sl = useLimit(sleepRows.length)
  return (
    <>
      <MetricDetail
        testId="sleep-page"
        title="Sueño y recuperación"
        period={period}
        onPeriod={setPeriod}
        tabs={SLEEP_TABS}
        tab={tab}
        onTab={(t) => setM(t === 'recovery' ? scale : t)}
        tabsLabel="Sueño y recuperación"
        action={
          tab === 'recovery' ? (
            <button className="btn-primary px-3" onClick={() => setRecOpen(true)} data-testid="new-recovery">
              <Icon name="plus" size={18} /> Registrar
            </button>
          ) : (
            <button className="btn-primary px-3" onClick={() => setOpen(true)} data-testid="new-sleep">
              <Icon name="plus" size={18} /> Registrar
            </button>
          )
        }
      >
        {tab === 'sleep' ? (
          <MetricBlock
            id="sleep"
            input={input}
            period={period}
            today={today}
            label="Horas dormidas"
            title="Duración del sueño"
            emptyAction={
              <button className="btn-secondary" onClick={() => setOpen(true)}>
                Registrar sueño
              </button>
            }
          />
        ) : null}
        {tab === 'schedule' ? <ScheduleBlock input={input} period={period} today={today} onNew={() => setOpen(true)} /> : null}
        {tab === 'recovery' ? (
          <>
            <Segmented ariaLabel="Escala" size="sm" value={scale} onChange={setM} options={SCALES} />
            <MetricBlock
              id={scale}
              input={input}
              period={period}
              today={today}
              title={`${SCALES.find((s) => s.value === scale)?.label} · autorreporte`}
              emptyAction={
                <button className="btn-secondary" onClick={() => setRecOpen(true)}>
                  Registrar recuperación
                </button>
              }
              footnote={<p className="mt-1 text-label text-muted">Escala de 1 a 5 que tú mismo valoras: no es una medición ni una puntuación calculada.</p>}
            />
          </>
        ) : null}

        {tab === 'recovery' ? (
          <section aria-label="Registros de recuperación">
            <SectionHeader title="Registros" hint={`${recRows.length} en el periodo`} />
            {recRows.length ? (
              <div className="divide-rows mt-1" data-testid="recovery-list">
                {recRows.slice(0, 120).map((x) => (
                  <Row
                    key={x.id}
                    onClick={() => setEditRec(x)}
                    title={formatDateEs(x.date, 'weekday')}
                    subtitle={`${[x.energy ? `energía ${x.energy}/5` : null, x.soreness ? `dolor muscular ${x.soreness}/5` : null, x.stress ? `estrés ${x.stress}/5` : null, x.mood ? `ánimo ${x.mood}/5` : null, x.restingHr ? `FC reposo ${x.restingHr}` : null].filter(Boolean).join(' · ') || '—'} · autoevaluado · ${originLabel(x.origin)}`}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-body text-muted">No hay registros de recuperación en este periodo. Valora energía, dolor muscular, estrés y ánimo del 1 al 5.</p>
            )}
          </section>
        ) : (
          <section aria-label="Registros de sueño">
            <SectionHeader title="Registros" hint={`${sleepRows.length} en el periodo`} />
            {sleepRows.length ? (
              <div className="divide-rows mt-1" data-testid="sleep-list">
                {sleepRows.slice(0, sl.shown).map((s) => (
                  <Row
                    key={s.id}
                    onClick={() => setEditSleep(s)}
                    title={formatDateEs(s.date, 'weekday')}
                    subtitle={`${[s.hours !== null ? `${formatNumber(s.hours, 1)} h` : null, s.bedtime && s.waketime ? `${s.bedtime} → ${s.waketime}` : s.bedtime ? `acostarse ${s.bedtime}` : s.waketime ? `levantarse ${s.waketime}` : null, s.quality ? `calidad ${s.quality}/5 (autoevaluada)` : null].filter(Boolean).join(' · ') || '—'} · ${originLabel(s.origin)}`}
                    trailing={s.approx || s.origin === 'phase0' ? <Flags row={s} /> : null}
                  />
                ))}
                {sl.more}
              </div>
            ) : (
              <p className="mt-2 text-body text-muted">{input ? 'No hay noches registradas a mano en este periodo. Anota a qué hora te acostaste y te levantaste; las horas se calculan solas.' : 'Cargando…'}</p>
            )}
          </section>
        )}
        {input && tab !== 'recovery' ? <HealthRows rows={hcRowsFor(input.health, ['sleep'], period.range)} /> : null}
      </MetricDetail>
      <SleepSheet open={open || !!editSleep} existing={editSleep} onClose={() => (setOpen(false), setEditSleep(null))} />
      <RecoverySheet open={recOpen || !!editRec} existing={editRec} onClose={() => (setRecOpen(false), setEditRec(null))} />
    </>
  )
}

function ScheduleBlock({ input, period, today, onNew }: { input: ReturnType<typeof useHealthInput>; period: ReturnType<typeof usePeriod>['period']; today: string; onNew: () => void }) {
  const model = useMemo(() => {
    if (!input) return null
    const { from, to } = period.range
    const bed = buildSeries('bedtime', input, from, to)
    const wake = buildSeries('wakeTime', input, from, to)
    const nights: Night[] = bed.map((b, i) => ({ date: b.date, bed: b.value, wake: wake[i]?.value ?? null })).filter((n) => n.bed !== null || n.wake !== null)
    const opts = { today, comparison: '' }
    return { nights, bedView: buildView('bedtime', input, period.range, period.previous, opts), wakeView: buildView('wakeTime', input, period.range, period.previous, opts), consistency: sleepConsistency(input, from, to) }
  }, [input, period, today])
  const range = periodTitle(period)
  if (!model) return <ChartPanel title="Horarios de sueño" value={null} unit="" period={range} loading><span /></ChartPanel>
  const { nights, bedView, wakeView, consistency } = model
  const n = nights.length
  const bedMean = bedView.summary.mean
  const wakeMean = wakeView.summary.mean
  const value = bedMean !== null && wakeMean !== null ? `${figure('bedtime', bedMean).value} → ${figure('wakeTime', wakeMean).value}` : bedMean !== null ? figure('bedtime', bedMean).value : wakeMean !== null ? figure('wakeTime', wakeMean).value : null
  const sd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `± ${formatNumber(Math.round(v), 0)}`)
  return (
    <div className="space-y-4">
      <ChartPanel
        title="Horarios de sueño"
        value={value}
        unit=""
        period={`Media del periodo · ${range}`}
        coverage={`${n} ${n === 1 ? 'noche' : 'noches'} con horario`}
        pointCount={n}
        action={
          <button className="btn-secondary" onClick={onNew}>
            Registrar sueño
          </button>
        }
      >
        <ScheduleChart nights={nights} from={period.range.from} to={period.range.to} height={220} ariaLabel={`Horarios de sueño, ${range.toLowerCase()}`} />
      </ChartPanel>
      <div className="metric-strip grid-cols-2 sm:grid-cols-4" data-testid="schedule-strip">
        <Metric label="Acostarse (media)" value={bedMean !== null ? figure('bedtime', bedMean).value : '—'} />
        <Metric label="Levantarse (media)" value={wakeMean !== null ? figure('wakeTime', wakeMean).value : '—'} />
        <Metric label="Variación al acostarte" value={consistency ? sd(consistency.bedtimeSdMin) : '—'} unit={consistency && consistency.bedtimeSdMin !== null ? 'min' : undefined} hint={consistency ? `${consistency.bedtimeNights} noches` : 'Mínimo 5 noches'} />
        <Metric label="Variación al levantarte" value={consistency ? sd(consistency.wakeSdMin) : '—'} unit={consistency && consistency.wakeSdMin !== null ? 'min' : undefined} hint={consistency ? `${consistency.wakeNights} noches` : 'Mínimo 5 noches'} />
      </div>
      <Disclosure summary="Cómo se calcula" testId="schedule-note">
        <p className="text-label text-muted">
          Cada barra va de la hora de acostarte a la de levantarte. {n ? `Datos de ${n} ${n === 1 ? 'noche' : 'noches'} del ${rangeText(period.range)}.` : ''}
        </p>
      </Disclosure>
    </div>
  )
}

// ───────────────────────── Habits + supplements ─────────────────────────
export function HabitsPage() {
  const r = useRepo()
  const confirm = useConfirm()
  const saved = useSavedToast()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
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
      <MetricDetail
        testId="habits-page"
        title="Hábitos y suplementos"
        period={period}
        onPeriod={setPeriod}
        action={
          <button className="btn-primary px-3" onClick={() => setEdit('new')} data-testid="new-habit">
            <Icon name="plus" size={18} /> Nuevo hábito
          </button>
        }
      >
        {active.length || (habits ?? []).length ? <MetricBlock id="habits" input={input} period={period} today={today} title="Hábitos completados" label="Hábitos completados" /> : null}
        <section aria-label="Hábitos del día" className="space-y-2">
          <DateNav date={date} onChange={setDate} />
          {active.length ? (
            <div className="divide-rows" data-testid="habit-list">
              {active.map((h) => {
                const v = valueOn(h.id, date)
                const done = v >= h.target
                const s = streak(h)
                return (
                  <div key={h.id} className="flex min-h-[56px] items-center gap-3 py-2">
                    {h.target <= 1 ? (
                      <button
                        className={`hit-44 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${done ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted'}`}
                        aria-pressed={done}
                        aria-label={done ? `Desmarcar ${h.name}` : `Marcar ${h.name}`}
                        onClick={() => void setValue(h, done ? 0 : 1)}
                        data-testid="habit-toggle"
                      >
                        <Icon name="check" size={18} />
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface2" aria-label={`Menos ${h.name}`} onClick={() => void setValue(h, Math.max(0, v - 1))}>
                          <Icon name="minus" size={16} />
                        </button>
                        <span className={`num w-12 text-center text-body font-semibold ${done ? 'text-accent' : ''}`}>
                          {formatNumber(v, 1)}/{formatNumber(h.target, 1)}
                        </span>
                        <button className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface2" aria-label={`Más ${h.name}`} onClick={() => void setValue(h, v + 1)}>
                          <Icon name="plus" size={16} />
                        </button>
                      </div>
                    )}
                    <button className="min-h-[44px] min-w-0 flex-1 text-left" onClick={() => setEdit(h)}>
                      <div className="truncate text-body font-medium">
                        {h.name} {h.kind === 'supplement' ? <Badge tone="accent">Suplemento</Badge> : null}
                      </div>
                      <div className="truncate text-label text-muted">{[h.dose, h.target > 1 ? `meta ${formatNumber(h.target, 1)} ${h.unit ?? ''}`.trim() : null, s ? `racha ${s} ${s === 1 ? 'día' : 'días'}` : null].filter(Boolean).join(' · ') || 'Manual'}</div>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface px-5 py-6">
              <h2 className="text-heading">Sin hábitos</h2>
              <p className="mt-1 text-body text-muted">Crea hábitos (agua, pasos, estiramientos) o suplementos con su dosis y márcalos cada día.</p>
              <button className="btn-primary mt-4" onClick={() => setEdit('new')}>
                Crear hábito
              </button>
            </div>
          )}
          {inactive.length ? (
            <details>
              <summary className="flex min-h-[44px] cursor-pointer items-center text-body text-muted">Archivados ({inactive.length})</summary>
              <div className="divide-rows">
                {inactive.map((h) => (
                  <Row key={h.id} dense title={h.name} onClick={() => setEdit(h)} />
                ))}
              </div>
            </details>
          ) : null}
        </section>
      </MetricDetail>
      <HabitSheet
        existing={edit === 'new' ? null : edit}
        open={edit !== null}
        onClose={() => setEdit(null)}
        nextOrder={(habits ?? []).length}
        onDelete={async (h) => {
          if (!(await confirm({ title: `¿Eliminar «${h.name}»?`, body: 'Se elimina también su historial. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', tone: 'danger' }))) return false
          const hl = await r.byIndex('habitLogs', 'habitId', h.id)
          await r.removeMany('habitLogs', hl.map((l) => l.id))
          await r.remove('habits', h.id)
          saved('Hábito eliminado', null)
          return true
        }}
      />
    </>
  )
}

function HabitSheet({ open, existing, onClose, nextOrder, onDelete }: { open: boolean; existing: Habit | null; onClose: () => void; nextOrder: number; onDelete: (h: Habit) => Promise<boolean> }) {
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
  const targetErr = target.trim() ? textRangeError(target, 0.1, 10000) : 'Indica la meta.'
  const canSave = name.trim().length > 0 && t !== null && !targetErr
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar' : 'Nuevo hábito o suplemento'}
      footer={
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
      }
    >
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
          <NumField label="Meta diaria" value={target} onChange={setTarget} hint="1 = marcar sí/no" error={target.trim() ? (targetErr ?? undefined) : undefined} />
          <TextField label="Unidad" value={unit} onChange={setUnit} placeholder="vasos, tomas…" />
        </div>
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
                if (await onDelete(existing)) onClose()
              }}
            >
              Eliminar
            </button>
          </div>
        ) : null}
        <p className="text-label text-muted">
          Registrar un suplemento no es una recomendación médica. <Link to="/ajustes" className="underline">Más información</Link>
        </p>
      </div>
    </Sheet>
  )
}
