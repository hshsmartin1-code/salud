import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import { addDays, formatDateEs, todayLocal } from '../../domain/dates'
import { movingAverage } from '../../domain/stats'
import { formatNumber } from '../../domain/units'
import { Icon, type IconName } from '../../ui/Icon'
import { PageHeader, Segmented } from '../../ui/kit'
import { DaySummary } from '../nutrition/DaySummary'
import { useDayNutrition } from '../nutrition/useDayNutrition'
import { startSession } from '../training/session'
import { useRangeStats, weightSeries } from './useRangeStats'

function Tile({ to, icon, label, value, unit, hint, testId }: { to: string; icon: IconName; label: string; value: ReactNode; unit?: string; hint?: ReactNode; testId?: string }) {
  return (
    <Link to={to} className="card block p-4 transition hover:border-accent/40" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon name={icon} size={14} /> {label}
      </div>
      <div className="num mt-1 text-xl font-bold">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-faint">{hint}</div> : null}
    </Link>
  )
}

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right">
        <span className="num text-sm font-semibold">{value}</span>
        {hint ? <span className="block text-[11px] text-faint">{hint}</span> : null}
      </span>
    </div>
  )
}

export function TodayPage() {
  const r = useRepo()
  const nav = useNavigate()
  const profile = useProfile()
  const today = todayLocal()
  const day = useDayNutrition(today)
  const [range, setRange] = useState<'7' | '30' | '90'>('7')
  const stats = useRangeStats(Number(range), today)
  const data = useLiveQuery(async () => {
    const [sessions, body, sleep, acts, habits, habitLogs] = await Promise.all([
      r.latest('trainingSessions', 10),
      r.range('bodyMeasurements', addDays(today, -60), today),
      r.latest('sleepLogs', 3),
      r.onDate('activityLogs', today),
      r.all('habits'),
      r.onDate('habitLogs', today),
    ])
    return { sessions, body, sleep, acts, habits, habitLogs }
  }, [r, today])

  const active = data?.sessions.find((s) => s.status === 'active')
  const todays = data?.sessions.filter((s) => s.date === today && s.status === 'done') ?? []
  const lastDone = data?.sessions.find((s) => s.status === 'done')
  const ws = data ? weightSeries(data.body) : []
  const lastW = ws[ws.length - 1]
  const ma = ws.length ? movingAverage(ws, 7) : []
  const avg = ma[ma.length - 1]
  const prevAvg = ma.filter((p) => p.date <= addDays(lastW?.date ?? today, -7)).pop()
  const sleepLast = data?.sleep.find((s) => s.hours !== null)
  const steps = data?.acts.filter((a) => a.steps !== null).reduce((s, a) => s + (a.steps as number), 0)
  const actKcal = data?.acts.filter((a) => a.activeKcal !== null).reduce((s, a) => s + (a.activeKcal as number), 0)
  const habitsActive = data?.habits.filter((h) => h.active) ?? []
  const habitsDone = habitsActive.filter((h) => (data?.habitLogs ?? []).filter((l) => l.habitId === h.id).reduce((s, l) => s + l.value, 0) >= h.target).length
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <>
      <PageHeader title={`${greet}, ${profile.name}`} subtitle={formatDateEs(today, 'long')} />
      <div className="space-y-5" data-testid="dashboard">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Nutrición de hoy</h2>
            <Link to="/comida" className="text-sm font-medium text-accent">
              Ver comidas
            </Link>
          </div>
          {day ? <DaySummary day={day} compact /> : <div className="card h-40 animate-pulse" />}
        </section>

        <section>
          <h2 className="section-title mb-2">Entreno</h2>
          {active ? (
            <Link to={`/entreno/sesion/${active.id}`} className="card flex items-center gap-3 border-accent/40 p-4">
              <span className="rounded-xl bg-accent/15 p-2 text-accent">
                <Icon name="play" size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{active.name}</div>
                <div className="text-xs text-muted">Sesión en curso: continuar</div>
              </div>
              <Icon name="chevronRight" className="text-faint" />
            </Link>
          ) : (
            <div className="card flex items-center gap-3 p-4">
              <span className="rounded-xl bg-surface2 p-2 text-muted">
                <Icon name="dumbbell" size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{todays.length ? `Hoy: ${todays.map((s) => s.name).join(', ')}` : 'Sin entrenamiento hoy'}</div>
                <div className="text-xs text-muted">{lastDone && !todays.length ? `Último: ${lastDone.name} · ${formatDateEs(lastDone.date, 'weekday')}` : todays.length ? 'Sesión registrada' : 'Aún no hay sesiones'}</div>
              </div>
              <button
                className="btn-secondary px-3"
                onClick={async () => {
                  const s = await startSession(r, {})
                  nav(`/entreno/sesion/${s.id}`)
                }}
              >
                <Icon name="play" size={16} /> Iniciar
              </button>
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            to="/cuerpo"
            icon="scale"
            label="Peso"
            testId="tile-weight"
            value={lastW ? formatNumber(lastW.value, 1) : '—'}
            unit={lastW ? 'kg' : undefined}
            hint={
              avg && avg.n > 1
                ? `Media 7 d: ${formatNumber(avg.avg, 1)} kg${prevAvg ? ` (${avg.avg - prevAvg.avg >= 0 ? '+' : ''}${formatNumber(avg.avg - prevAvg.avg, 1)})` : ''}`
                : lastW
                  ? formatDateEs(lastW.date)
                  : 'Registra tu peso'
            }
          />
          <Tile to="/sueno" icon="bed" label="Sueño" value={sleepLast ? formatNumber(sleepLast.hours as number, 1) : '—'} unit={sleepLast ? 'h' : undefined} hint={sleepLast ? formatDateEs(sleepLast.date, 'weekday') : 'Sin registro'} />
          <Tile
            to="/actividad"
            icon="activity"
            label="Actividad hoy"
            value={steps ? formatNumber(steps, 0) : '—'}
            unit={steps ? 'pasos' : undefined}
            hint={actKcal ? `${formatNumber(actKcal, 0)} kcal activas (informativo)` : 'Sin registro hoy'}
          />
          <Tile to="/habitos" icon="check" label="Hábitos hoy" value={habitsActive.length ? `${habitsDone}/${habitsActive.length}` : '—'} hint={habitsActive.length ? (habitsDone === habitsActive.length ? '¡Completos!' : 'Pendientes') : 'Crea tus hábitos'} />
        </section>

        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Resumen</h2>
            <Segmented<'7' | '30' | '90'>
              value={range}
              onChange={setRange}
              size="sm"
              ariaLabel="Periodo"
              options={[
                { value: '7', label: '7 días' },
                { value: '30', label: '30 días' },
                { value: '90', label: '90 días' },
              ]}
            />
          </div>
          {stats ? (
            <div className="divide-y divide-line" data-testid="range-stats">
              <Row
                label="Kcal promedio"
                value={stats.kcalMean !== null ? formatNumber(stats.kcalMean, 0) : '—'}
                hint={stats.kcalDays ? `${stats.kcalDays} de ${stats.days} días registrados${stats.importedDays ? ` (${stats.importedDays} del historial previo)` : ''}` : 'Sin registros'}
              />
              <Row label="Proteína promedio" value={stats.proteinMean !== null ? `${formatNumber(stats.proteinMean, 0)} g` : '—'} hint={stats.proteinDays ? `${stats.proteinDays} días con alimentos registrados` : undefined} />
              <Row label="Días en objetivo (±10 % kcal)" value={stats.targetDays ? `${stats.onTargetDays} / ${stats.targetDays}` : '—'} />
              <Row label="Sesiones de entreno" value={stats.sessions} hint={stats.volume ? `${formatNumber(stats.volume, 0)} kg de volumen` : undefined} />
              <Row
                label="Cambio de peso"
                value={stats.weightStart && stats.weightEnd ? `${stats.weightEnd.value - stats.weightStart.value >= 0 ? '+' : ''}${formatNumber(stats.weightEnd.value - stats.weightStart.value, 1)} kg` : '—'}
                hint={stats.weightStart && stats.weightEnd ? `${formatDateEs(stats.weightStart.date)} → ${formatDateEs(stats.weightEnd.date)}` : 'Se necesitan 2 pesos en el periodo'}
              />
              <Row label="Sueño promedio" value={stats.sleepMean !== null ? `${formatNumber(stats.sleepMean, 1)} h` : '—'} hint={stats.sleepDays ? `${stats.sleepDays} noches` : undefined} />
              <Row label="Pasos promedio" value={stats.stepsMean !== null ? formatNumber(stats.stepsMean, 0) : '—'} hint={stats.stepsDays ? `${stats.stepsDays} días` : undefined} />
            </div>
          ) : null}
          <Link to="/progreso" className="btn-ghost mt-2 w-full text-sm">
            <Icon name="chart" size={16} /> Ver gráficas de progreso
          </Link>
        </section>
      </div>
    </>
  )
}
