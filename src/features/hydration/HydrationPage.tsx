import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useProfile, useRepo } from '../../app/profile'
import { updateProfile } from '../../db/profiles'
import { formatDateEs } from '../../domain/dates'
import { dailyTotals, goalStreak, validateGoalMl, validateMl } from '../../domain/hydration'
import { formatNumber } from '../../domain/units'
import { NumField, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Meter } from '../../ui/Meter'
import { Metric } from '../../ui/Metric'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { useToast } from '../../ui/Toast'
import { useLimit } from '../health/HealthRows'
import { useHealthInput, usePeriod } from '../health/hooks'
import { MetricBlock, MetricDetail } from '../health/MetricDetail'
import { useSavedToast } from '../health/useSavedToast'
import { addWater } from '../health/writers'
import { SAVE_FAILED_RESULT, useSafeWrite } from '../../app/safeSave'
import { MAX_CONTAINERS, addContainer, containersOf, removeContainer, validateContainer, withContainers } from './containers'

export function HydrationPage() {
  const r = useRepo()
  const profile = useProfile()
  const toast = useToast()
  const saved = useSavedToast()
  const { period, setPeriod, today } = usePeriod()
  const input = useHealthInput(period, today)
  const goal = profile.settings.waterGoalMl ?? null
  const containers = containersOf(profile.settings)
  const todayData = useLiveQuery(() => r.onDate('hydrationLogs', today), [r, today])
  const todayRows = useMemo(() => todayData ?? [], [todayData])
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalStr, setGoalStr] = useState('')
  const [goalErr, setGoalErr] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [customErr, setCustomErr] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [cLabel, setCLabel] = useState('')
  const [cMl, setCMl] = useState('')
  const [cErr, setCErr] = useState<string | null>(null)
  const [editContainers, setEditContainers] = useState(false)

  const sortedToday = useMemo(() => todayRows.slice().sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt)), [todayRows])
  const todayMl = todayRows.reduce((s, l) => s + l.ml, 0)
  const pct = goal ? Math.round((todayMl / goal) * 100) : null
  const periodRows = useMemo(() => (input?.hydration ?? []).filter((l) => l.date >= period.range.from && l.date <= period.range.to), [input, period])
  const totals = useMemo(() => dailyTotals(periodRows), [periodRows])
  const days = useMemo(() => Object.keys(totals).sort().reverse(), [totals])
  const lim = useLimit(days.length)
  const streak = goalStreak(totals, goal, today)

  const write = useSafeWrite()
  /** True once the write resolved; a failure shows «No se pudo guardar» and keeps the form as it was. */
  const add = async (ml: number, drink: string | null): Promise<boolean> => {
    const undo = await write(() => addWater(r, ml, drink))
    if (undo === SAVE_FAILED_RESULT) return false
    saved(`+${formatNumber(ml, 0)} ml de agua`, undo)
    return true
  }
  const saveGoal = async () => {
    const n = toNum(goalStr)
    const err = validateGoalMl(n)
    setGoalErr(err)
    if (err || n === null) return
    if (await write(() => updateProfile(profile.id, { settings: { ...profile.settings, waterGoalMl: Math.round(n) } })) === SAVE_FAILED_RESULT) return
    setEditingGoal(false)
  }
  const startGoal = () => {
    setGoalStr(numStr(goal, 0))
    setGoalErr(null)
    setEditingGoal(true)
  }
  const saveContainers = (list: ReturnType<typeof containersOf>) => updateProfile(profile.id, { settings: withContainers(profile.settings, list) })

  return (
    <MetricDetail
      testId="hydration-page"
      title="Hidratación"
      period={period}
      onPeriod={setPeriod}
      action={
        <button className="btn-secondary px-3" aria-expanded={showCustom} onClick={() => setShowCustom((v) => !v)} data-testid="add-water-custom">
          <Icon name="plus" size={18} /> Otra cantidad
        </button>
      }
    >
      {showCustom ? (
        <form
          className="flex items-start gap-2"
          data-testid="custom-water-form"
          onSubmit={async (e) => {
            e.preventDefault()
            const n = toNum(custom)
            const err = validateMl(n)
            setCustomErr(err)
            if (err || n === null) return
            if (!(await add(Math.round(n), null))) return
            setCustom('')
            setShowCustom(false)
          }}
        >
          <div className="flex-1">
            <NumField label="Cantidad" unit="ml" value={custom} onChange={setCustom} error={customErr} autoFocus />
          </div>
          <button type="submit" className="btn-primary mt-[22px]" data-testid="save-water-custom">
            Añadir
          </button>
        </form>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Hoy">
        <div className="flex items-end justify-between gap-3">
          <div data-testid="hydration-today">
            <Metric label="Hoy" value={formatNumber(todayMl, 0)} unit="ml" size="xl" />
          </div>
          <div className="pb-1 text-right text-label text-muted">
            {goal ? (
              <>
                <div>
                  Meta {formatNumber(goal, 0)} ml{pct !== null ? ` · ${pct} %` : ''}
                </div>
                <div>{todayMl >= goal ? 'Meta cumplida' : `Faltan ${formatNumber(goal - todayMl, 0)} ml`}</div>
              </>
            ) : null}
          </div>
        </div>
        {goal ? (
          <div className="mt-3">
            <Meter value={todayMl} max={goal} colorVar="water" variant="scale" label={`Agua de hoy: ${formatNumber(todayMl, 0)} de ${formatNumber(goal, 0)} ml`} />
          </div>
        ) : null}

        <div className={`mt-4 grid gap-2 ${containers.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`} aria-label="Agregar agua">
          {containers.map((c) => (
            <button key={c.ml} className="btn-secondary min-h-[64px] flex-col gap-0 py-2" onClick={() => void add(c.ml, c.label.toLowerCase())} data-testid={`add-water-${c.ml}`}>
              <span className="readout text-readout">+{formatNumber(c.ml, 0)}</span>
              <span className="max-w-full truncate text-label font-normal text-muted">{c.label} · ml</span>
            </button>
          ))}
        </div>

        {!goal && !editingGoal ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface2 px-3 py-2.5">
            <p className="text-body text-muted">Define una meta para ver tu avance.</p>
            <button className="btn-secondary shrink-0" onClick={startGoal} data-testid="set-water-goal">
              Define una meta
            </button>
          </div>
        ) : null}
        {goal && !editingGoal ? (
          <button className="btn-ghost mt-2 -ml-2 px-2 text-label" onClick={startGoal} data-testid="edit-water-goal">
            <Icon name="pencil" size={14} /> Cambiar meta
          </button>
        ) : null}
        {editingGoal ? (
          <form
            className="mt-3 flex items-start gap-2"
            data-testid="water-goal-form"
            onSubmit={(e) => {
              e.preventDefault()
              void saveGoal()
            }}
          >
            <div className="flex-1">
              <NumField label="Meta diaria" unit="ml" value={goalStr} onChange={setGoalStr} error={goalErr} autoFocus />
            </div>
            <div className="flex gap-2 pt-[22px]">
              <button type="submit" className="btn-primary" data-testid="save-water-goal">
                Guardar
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditingGoal(false)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <MetricBlock id="water" input={input} period={period} today={today} label="Agua por día" title="Agua por día" emptyAction={null} />
      <div className="metric-strip grid-cols-2">
        <Metric label="Racha con meta" value={goal ? streak : '—'} unit={goal ? (streak === 1 ? 'día' : 'días') : undefined} hint={goal ? 'Días seguidos con la meta cumplida' : 'Define una meta'} />
        <Metric label="Días con registro" value={days.length} unit={`en ${period.days} días`} />
      </div>

      <section aria-label="Registros de hoy">
        <SectionHeader title="Hoy" hint={`${sortedToday.length} ${sortedToday.length === 1 ? 'registro' : 'registros'}`} />
        {sortedToday.length ? (
          <div className="divide-rows mt-1" data-testid="water-entries">
            {sortedToday.map((l) => (
              <Row
                key={l.id}
                dense
                leading={<Icon name="droplet" size={18} />}
                title={`${formatNumber(l.ml, 0)} ml`}
                subtitle={`${[l.time, l.drink].filter(Boolean).join(' · ') || 'Sin hora'} · Manual`}
                trailing={
                  <IconButton
                    icon="trash"
                    label={`Eliminar ${formatNumber(l.ml, 0)} ml de las ${l.time ?? 'hora sin registrar'}`}
                    tone="danger"
                    onClick={async () => {
                      await r.remove('hydrationLogs', l.id)
                      toast.show({ message: `Eliminado ${formatNumber(l.ml, 0)} ml`, actionLabel: 'Deshacer', onAction: () => void r.put('hydrationLogs', l) })
                    }}
                  />
                }
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-body text-muted">Aún no hay agua hoy.</p>
        )}
      </section>

      <section aria-label="Historial del periodo">
        <SectionHeader title="Historial" hint={`${days.length} ${days.length === 1 ? 'día' : 'días'} con registro`} />
        {days.length ? (
          <div className="divide-rows mt-1" data-testid="water-history">
            {days.slice(0, lim.shown).map((d) => (
              <Row key={d} dense title={formatDateEs(d, 'weekday')} subtitle={goal ? `${Math.round((totals[d]! / goal) * 100)} % de la meta · Manual` : 'Manual'} trailing={`${formatNumber(totals[d]!, 0)} ml`} />
            ))}
            {lim.more}
          </div>
        ) : (
          <p className="mt-2 text-body text-muted">Sin registros en este periodo.</p>
        )}
      </section>

      <section aria-label="Recipientes">
        <SectionHeader
          title="Recipientes"
          hint={`${containers.length} de ${MAX_CONTAINERS}`}
          action={
            <button className="btn-ghost px-3" onClick={() => setEditContainers((v) => !v)} aria-expanded={editContainers} data-testid="edit-containers">
              {editContainers ? 'Listo' : 'Editar'}
            </button>
          }
        />
        {editContainers ? <p className="text-label text-muted">Los botones de un toque usan estos recipientes (por perfil).</p> : null}
        {editContainers ? (
          <div className="mt-2 space-y-3" data-testid="containers-editor">
            <div className="divide-rows">
              {containers.map((c) => (
                <Row
                  key={c.ml}
                  dense
                  title={c.label}
                  subtitle={`${formatNumber(c.ml, 0)} ml`}
                  trailing={<IconButton icon="trash" label={`Quitar ${c.label} de ${formatNumber(c.ml, 0)} ml`} tone="danger" onClick={() => void saveContainers(removeContainer(containers, c.ml))} />}
                />
              ))}
            </div>
            {containers.length < MAX_CONTAINERS ? (
              <form
                className="flex items-start gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const ml = toNum(cMl)
                  const err = validateContainer(containers, { label: cLabel, ml })
                  setCErr(err)
                  if (err || ml === null) return
                  await saveContainers(addContainer(containers, { label: cLabel, ml }))
                  setCLabel('')
                  setCMl('')
                }}
              >
                <div className="min-w-0 flex-1">
                  <TextField label="Nombre" value={cLabel} onChange={setCLabel} placeholder="Botella grande" />
                </div>
                <div className="w-28 shrink-0">
                  <NumField label="Cantidad" unit="ml" value={cMl} onChange={setCMl} error={cErr} />
                </div>
                <button type="submit" className="btn-secondary mt-[22px]" data-testid="add-container">
                  Añadir
                </button>
              </form>
            ) : (
              <p className="text-label text-muted">Llegaste al máximo de {MAX_CONTAINERS} recipientes. Quita uno para añadir otro.</p>
            )}
          </div>
        ) : null}
      </section>
    </MetricDetail>
  )
}
