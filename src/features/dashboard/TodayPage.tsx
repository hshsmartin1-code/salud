import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import { getMeta } from '../../db/profiles'
import type { DashboardIndicator } from '../../db/types'
import { pickGoalForDate } from '../../db/queries'
import { PERSONAL_TABLES } from '../../db/tables'
import { addDays, dateRange, formatDateEs, isoWeekStart, nowLocalTime } from '../../domain/dates'
import { useToday } from '../../app/useToday'
import { sumNutrients } from '../../domain/nutrients'
import { isWarmupSet } from '../../domain/setKind'
import { sessionVolume } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { MiniBars } from '../../ui/charts'
import { Delta } from '../../ui/Delta'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Meter } from '../../ui/Meter'
import { Skeleton } from '../../ui/Skeleton'
import { QuickLogHost, type QuickTarget } from '../health/QuickLog'
import { useMealSlots } from '../nutrition/useMealSlots'
import { searchPath } from '../nutrition/paths'
import { doneDates, nextPlanned, resolveRoutine } from '../training/plan/plan'
import { startSuggestion } from '../training/plan/startSuggestion'
import { lastUsedByRoutine, prepareStats } from '../training/trainingStats'
import { WeightLine } from './WeightLine'
import { DaySummary } from './DaySummary'
import { IndicatorGrid } from './IndicatorGrid'
import { IndicatorTile } from './IndicatorTile'
import { InsightsSection } from './InsightsSection'
import { QuickActions } from './QuickActions'
import { DueCard, TrainingRow } from './TrainingNow'
import { slotPosition, trainingSlot } from './trainingSlot'
import { WeeklySummary } from './WeeklySummary'
import { buildInsights } from './insights'
import {
  activeKcalByDay,
  buildAlerts,
  compare,
  seriesFor,
  sleepByDay,
  sourcesLabel,
  stepsByDay,
  trendWeight,
  weekWindows,
  weightByDay,
  type DashboardAlert,
} from './controlCenter'

const WEEKDAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const wd = (date: string) => WEEKDAY[new Date(date + 'T12:00:00').getDay()]!
const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : formatNumber(n, d))
const enough = (xs: (number | null)[]) => xs.filter((v) => v !== null).length >= 2

/** Notices (backup, Health Connect, adaptive goal): one slim row in view; the others behind it. */
function Notices({ alerts }: { alerts: DashboardAlert[] }) {
  if (!alerts.length) return null
  const [first, ...rest] = alerts
  return (
    <section className="border-t border-line" aria-label="Avisos">
      <NoticeRow a={first!} />
      {rest.length ? (
        <Disclosure summary={`${rest.length} ${rest.length === 1 ? 'aviso más' : 'avisos más'}`} testId="alerts-more">
          <div className="divide-rows">
            {rest.map((a) => (
              <NoticeRow key={a.key} a={a} />
            ))}
          </div>
        </Disclosure>
      ) : null}
    </section>
  )
}

function NoticeRow({ a }: { a: DashboardAlert }) {
  const cls = a.tone === 'bad' ? 'text-bad' : a.tone === 'warn' ? 'text-warn' : 'text-muted'
  return (
    <Link to={a.to} className="flex min-h-11 items-center gap-2.5 py-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-accent" data-testid={`alert-${a.key}`}>
      <Icon name={a.tone === 'info' ? 'info' : 'alert'} size={16} className={`shrink-0 ${cls}`} />
      <span className="min-w-0 flex-1 text-ink">{a.text}</span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
    </Link>
  )
}

function LoadingState() {
  return (
    <div className="space-y-7" data-testid="dashboard" aria-busy="true">
      <Skeleton height={124} label="Cargando el resumen" />
      <Skeleton height={56} label="" />
      <Skeleton height={140} label="" />
      <Skeleton height={132} label="" />
    </div>
  )
}


export function TodayPage() {
  const r = useRepo()
  const profile = useProfile()
  // Rolls over at local midnight and when the app resumes.
  const today = useToday()
  const [quick, setQuick] = useState<QuickTarget | null>(null)

  const data = useLiveQuery(async () => {
    const from14 = addDays(today, -14)
    const from60 = addDays(today, -60)
    const [logs, goals, imported, acts, health, body, sleep, recovery, sessions, sets, habits, habitLogs, adjust, water, vitals, integ, lastExport, counts, routines] = await Promise.all([
      r.range('foodLogs', from14, today),
      r.all('goals'),
      r.range('importedDaily', from14, today),
      r.range('activityLogs', from14, today),
      r.range('healthRecords', from60, today),
      r.range('bodyMeasurements', from60, today),
      r.range('sleepLogs', from14, today),
      r.latest('recoveryLogs', 1),
      r.all('trainingSessions'),
      r.range('exerciseSets', addDays(today, -56), today),
      r.all('habits'),
      r.onDate('habitLogs', today),
      r.range('energyAdjustments', addDays(today, -6), today),
      r.range('hydrationLogs', addDays(today, -6), today),
      r.latest('vitals', 30),
      r.all('integrations'),
      getMeta<string>('lastExport'),
      Promise.all(PERSONAL_TABLES.map((t) => r.count(t))).then((xs) => xs.reduce((a, b) => a + b, 0)),
      r.all('routines'),
    ])
    return { logs, goals, imported, acts, health, body, sleep, recovery, sessions, sets, habits, habitLogs, adjust, water, vitals, integ, lastExport: lastExport ?? null, counts, routines }
  }, [r, today])

  const time = nowLocalTime()
  const mealSlots = useMealSlots()
  const hour = Number(time.slice(0, 2))
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
  const header = (
    <header className="mb-4 flex items-baseline justify-between gap-3">
      <h1 className="title-wide min-w-0 truncate text-title">{`${greet}, ${profile.name.split(' ')[0]}`}</h1>
      <p className="shrink-0 text-label text-muted">{formatDateEs(today, 'weekday')}</p>
    </header>
  )
  if (!data)
    return (
      <>
        {header}
        <LoadingState />
      </>
    )

  // ── Today ──
  const todayLogs = data.logs.filter((l) => l.date === today)
  const { totals, partial } = sumNutrients(todayLogs)
  const goal = pickGoalForDate(data.goals, today)
  const kcal = totals.kcal ?? (todayLogs.length ? null : 0)
  const protein = totals.protein ?? (todayLogs.length ? null : 0)
  const last7 = dateRange(addDays(today, -6), today)
  const steps7 = stepsByDay(data.acts, data.health, last7)
  const stepsToday = steps7[6]!
  const stepGoal = profile.settings.stepGoal ?? null
  const kcalAct = activeKcalByDay(data.acts, data.health, [today])[0]!

  // ── Weight (60 days) ──
  const weights = weightByDay(data.body, data.health)
  const trend = trendWeight(weights)
  const lastW = weights[weights.length - 1]
  const lastT = trend[trend.length - 1]
  const days30 = dateRange(addDays(today, -29), today)
  const t7 = trend.filter((p) => p.date <= addDays(today, -7)).pop()

  // ── Sleep, training, hydration, habits, recovery, vitals ──
  const sleep7 = sleepByDay(data.sleep, data.health, last7)
  const lastSleep = [...sleep7].reverse().find((s) => s.value !== null)
  const active = data.sessions.find((s) => s.status === 'active') ?? null
  const done = data.sessions.filter((s) => s.status === 'done' && !s.excludeFromStats)
  const weekStart = isoWeekStart(today)
  const doneThisWeek = done.filter((s) => s.date >= weekStart)
  const lastDone = [...done].sort((a, b) => a.date.localeCompare(b.date)).pop()
  const waterToday = data.water.filter((w) => w.date === today).reduce((s, w) => s + w.ml, 0)
  const waterGoal = profile.settings.waterGoalMl ?? null
  const habitsActive = data.habits.filter((h) => h.active)
  const habitsDone = habitsActive.filter((h) => data.habitLogs.filter((l) => l.habitId === h.id).reduce((s, l) => s + l.value, 0) >= h.target).length
  const rec = data.recovery[0]
  const hrHc = [...data.health].filter((h) => h.metric === 'restingHr' && !h.excluded && h.value !== null).sort((a, b) => a.date.localeCompare(b.date)).pop()
  const hrVital = data.vitals.find((v) => v.kind === 'restingHr' && v.value !== null)
  const restingHr = [rec?.restingHr ? { v: rec.restingHr, d: rec.date, s: 'Recuperación' } : null, hrVital ? { v: hrVital.value as number, d: hrVital.date, s: 'Signos vitales' } : null, hrHc ? { v: hrHc.value as number, d: hrHc.date, s: 'Health Connect' } : null]
    .filter((x): x is { v: number; d: string; s: string } => !!x)
    .sort((a, b) => b.d.localeCompare(a.d))[0]
  const bp = data.vitals.find((v) => v.kind === 'bloodPressure')

  // ── Weekly comparison (complete days) ──
  const win = weekWindows(today)
  const kcalByDay = (dates: string[]) =>
    dates.map((d) => {
      const ls = data.logs.filter((l) => l.date === d)
      if (ls.length) return sumNutrients(ls).totals.kcal ?? null
      const imp = data.imported.find((x) => x.date === d && x.metric === 'kcal_intake' && !x.excludeFromStats)
      return imp?.value ?? null
    })
  const protByDay = (dates: string[]) => dates.map((d) => (data.logs.some((l) => l.date === d) ? (sumNutrients(data.logs.filter((l) => l.date === d)).totals.protein ?? null) : null))
  const cmpKcal = compare(kcalByDay(win.current), kcalByDay(win.previous))
  const cmpProt = compare(protByDay(win.current), protByDay(win.previous))
  const stepsBoth = stepsByDay(data.acts, data.health, [...win.previous, ...win.current])
  const cmpSteps = compare(seriesFor(win.current, stepsBoth), seriesFor(win.previous, stepsBoth))
  const sleepBoth = sleepByDay(data.sleep, data.health, [...win.previous, ...win.current])
  const cmpSleep = compare(seriesFor(win.current, sleepBoth), seriesFor(win.previous, sleepBoth))
  const sessIn = (dates: string[]) => done.filter((s) => s.date >= dates[0]! && s.date <= dates[dates.length - 1]!)
  const volIn = (dates: string[]) => sessionVolume(data.sets.filter((s) => s.done && !isWarmupSet(s) && s.date >= dates[0]! && s.date <= dates[dates.length - 1]!))
  const trendAt = (d: string) => trend.filter((p) => p.date <= d).pop()
  const tCur = trendAt(win.current[6]!)
  const tPrev = trendAt(win.previous[6]!)

  // ── Insights: the same de-duplicated series as everything above ──
  const insights = buildInsights({
    today,
    hour,
    kcal7: kcalByDay(win.current),
    protein7: protByDay(win.current),
    steps7: seriesFor(win.current, stepsBoth),
    sleep7: sleep7.map((s) => s.value),
    kcalTarget: goal?.kcal ?? null,
    proteinTarget: goal?.protein ?? null,
    stepGoal,
    sessionDates: done.map((s) => s.date),
    waterTodayMl: waterToday,
    waterGoalMl: waterGoal,
    weightDates: weights.map((w) => w.date),
  })

  // ── Training: state or plan, never a default recommendation (see trainingSlot) ──
  const plan = profile.settings.training?.plan
  const doneSet = doneDates(data.sessions)
  const suggestion = startSuggestion({ plan, today, done: doneSet, routines: data.routines, lastUsed: lastUsedByRoutine(prepareStats(data.sessions, [])) })
  const doneToday = done.filter((s) => s.date === today).sort((a, b) => (a.endedAt ?? a.startedAt ?? '').localeCompare(b.endedAt ?? b.startedAt ?? '')).pop() ?? null
  const nextP = nextPlanned(plan, today, doneSet)
  const slot = trainingSlot({
    active: !!active,
    suggestion,
    doneToday: doneToday ? { id: doneToday.id, name: doneToday.name } : null,
    next: nextP ? { date: nextP.date, routine: resolveRoutine({ kind: 'train', routineId: nextP.routineId }, data.routines) } : null,
  })
  const top = slotPosition(slot) === 'top' && slot.kind === 'due' ? <DueCard slot={slot} /> : null
  const endRow = slot.kind === 'done' || slot.kind === 'next' || slot.kind === 'go' ? <TrainingRow slot={slot} /> : null

  const integ = data.integ.find((i) => i.provider === 'health-connect')
  const auto = data.adjust.filter((a) => a.applied === 'auto').sort((a, b) => b.date.localeCompare(a.date))[0]
  const alerts = buildAlerts({
    today,
    lastExport: data.lastExport,
    personalRows: data.counts,
    hc: integ ? { status: integ.status, lastSyncAt: integ.lastSyncAt, lastError: integ.lastError } : null,
    adaptiveOn: (profile.settings.adaptive?.mode ?? 'off') !== 'off',
    lastWeightDate: lastW?.date ?? null,
    autoAdjustment: auto ? { date: auto.date, fromKcal: auto.fromKcal, toKcal: auto.toKcal } : null,
  })

  const footnote =
    `Comida: tu diario de hoy${todayLogs.length ? '' : ' (nada registrado aún)'}. Pasos: ${stepsToday.source ? sourcesLabel([stepsToday]) : 'sin datos hoy'}.` +
    (kcalAct.value !== null ? ` Actividad ${formatNumber(kcalAct.value, 0)} kcal activas (informativo, no es tu gasto total).` : '') +
    (!goal ? ' Define tus objetivos en Perfil.' : '')

  const weeklyHasData =
    [cmpKcal, cmpProt, cmpSteps, cmpSleep].some((c) => c.current.mean !== null || c.previous.mean !== null) || sessIn(win.current).length + sessIn(win.previous).length > 0 || tCur !== undefined

  const present: Record<DashboardIndicator, boolean> = { weight: !!lastW, steps: steps7.some((p) => p.value !== null), sleep: !!lastSleep, training: !!active || done.length > 0, water: data.water.length > 0, recovery: !!rec || !!restingHr, habits: habitsActive.length > 0, pressure: !!bp }
  // Nothing recorded yet (the weight from the welcome form alone does not count): a short empty state with
  // the action, the quick actions and one sentence; the indicators collapse into their "Agregar" row.
  const blank = Object.entries(present).every(([id, v]) => !v || (id === 'weight' && weights.length <= 1)) && todayLogs.length === 0 && data.logs.length === 0 && stepsToday.value === null && waterToday === 0

  const tiles = {
    weight: (
      <IndicatorTile
        to="/cuerpo"
        icon="scale"
        label="Peso"
        colorVar="body"
        testId="tile-weight"
        value={lastW ? fmt(lastW.value, 1) : '—'}
        unit={lastW ? 'kg' : undefined}
        delta={lastT && t7 ? <Delta value={lastT.value! - t7.value!} unit="kg" period="tendencia 7 d" /> : undefined}
        hint={lastW ? formatDateEs(lastW.date) : 'Toca para registrar'}
        empty={!lastW}
        source={lastW ? `${sourcesLabel(weights.filter((w) => w.date >= days30[0]!))} · 30 días · línea gruesa = tendencia suavizada` : 'Sin pesos en los últimos 60 días'}
      >
        <WeightLine days={days30} weights={weights} />
      </IndicatorTile>
    ),
    steps: (
      <IndicatorTile to="/actividad" icon="activity" label="Pasos" colorVar="move" value={fmt(stepsToday.value)} hint={stepsToday.value === null ? 'Sin pasos hoy' : stepGoal ? `Meta ${formatNumber(stepGoal, 0)}` : 'Hoy'} empty={steps7.every((x) => x.value === null)} source={`${sourcesLabel(steps7)} · 7 días`}>
        {enough(steps7.map((s) => s.value)) ? <MiniBars values={steps7.map((s) => s.value)} target={stepGoal} colorVar="move" highlight={6} labels={last7.map(wd)} height={36} label="Pasos de los últimos 7 días" /> : null}
      </IndicatorTile>
    ),
    sleep: (
      <IndicatorTile
        to="/sueno"
        icon="bed"
        label="Sueño"
        colorVar="sleep"
        value={lastSleep ? fmt(lastSleep.value, 1) : '—'}
        unit={lastSleep ? 'h' : undefined}
        hint={lastSleep ? formatDateEs(lastSleep.date, 'weekday') : 'Toca para registrar'}
        empty={!lastSleep}
        source={`${sourcesLabel(sleep7)} · 7 noches`}
      >
        {enough(sleep7.map((s) => s.value)) ? <MiniBars values={sleep7.map((s) => s.value)} colorVar="sleep" highlight={6} labels={last7.map(wd)} height={36} label="Horas de sueño de las últimas 7 noches" /> : null}
      </IndicatorTile>
    ),
    training: (
      <IndicatorTile
        to="/entreno"
        icon="dumbbell"
        label="Entreno"
        colorVar="train"
        value={doneThisWeek.length}
        unit={doneThisWeek.length === 1 ? 'sesión' : 'sesiones'}
        hint="Esta semana"
        source={`Sesiones terminadas de esta semana (lunes a domingo)${lastDone ? `. Última: ${formatDateEs(lastDone.date, 'weekday')}` : ''}`}
      />
    ),
    water: (
      <IndicatorTile
        to="/agua"
        icon="droplet"
        label="Agua"
        colorVar="water"
        value={waterToday ? formatNumber(waterToday / 1000, 2) : '0'}
        unit="L"
        hint={waterGoal ? `Meta ${formatNumber(waterGoal / 1000, 1)} L` : 'Sin meta definida'}
        source="Registro propio · hoy"
      >
        {waterGoal ? <Meter value={waterToday} max={waterGoal} colorVar="water" variant="bar" label="Agua de hoy frente a la meta" valueText={`${formatNumber(waterToday / 1000, 2)} de ${formatNumber(waterGoal / 1000, 1)} litros`} /> : null}
      </IndicatorTile>
    ),
    recovery: (
      <IndicatorTile
        to="/sueno"
        icon="heart"
        label="Recuperación"
        colorVar="heart"
        value={restingHr ? fmt(restingHr.v) : rec?.energy ? `${rec.energy}/5` : '—'}
        unit={restingHr ? 'lpm' : undefined}
        hint={restingHr ? 'FC en reposo' : rec?.energy ? 'Energía percibida' : 'Toca para registrar'}
        empty={!restingHr && !rec?.energy}
        source={[restingHr?.s, rec ? `energía ${rec.energy ?? '—'}/5 · estrés ${rec.stress ?? '—'}/5 (${formatDateEs(rec.date)})` : null].filter(Boolean).join(' · ') || 'Registro propio en Sueño y recuperación'}
      />
    ),
    habits: (
      <IndicatorTile
        to="/habitos"
        icon="check"
        label="Hábitos"
        colorVar="move"
        value={habitsActive.length ? `${habitsDone}/${habitsActive.length}` : '—'}
        hint={habitsActive.length ? (habitsDone === habitsActive.length ? 'Completos hoy' : `${habitsActive.length - habitsDone} ${habitsActive.length - habitsDone === 1 ? 'pendiente' : 'pendientes'} hoy`) : 'Toca para crear'}
        empty={!habitsActive.length}
        source="Registro propio · hoy"
      >
        {habitsActive.length ? <Meter value={habitsDone} max={habitsActive.length} colorVar="move" variant="segments" label="Hábitos completados hoy" valueText={`${habitsDone} de ${habitsActive.length}`} /> : null}
      </IndicatorTile>
    ),
    pressure: (
      <IndicatorTile
        to="/signos"
        icon="heart"
        label="Presión arterial"
        colorVar="heart"
        value={bp?.systolic && bp.diastolic ? `${bp.systolic}/${bp.diastolic}` : '—'}
        unit={bp ? 'mmHg' : undefined}
        hint={bp ? formatDateEs(bp.date) : 'Toca para registrar'}
        empty={!bp}
        source="Signos vitales · última medición · orientativo"
      />
    ),
  }

  const summary = blank ? (
    <p className="text-label text-muted" data-testid="hoy-empty">
      Aún no hay registros. Empieza con una comida, agua o tu peso.
    </p>
  ) : (
    <DaySummary
      kcal={kcal}
      kcalTarget={goal?.kcal ?? null}
      protein={protein}
      proteinTarget={goal?.protein ?? null}
      steps={stepsToday.value}
      stepGoal={stepGoal}
      footnote={footnote}
      partialWarning={todayLogs.length > 0 && partial.some((code) => ['kcal', 'protein', 'carbs', 'fat'].includes(code))}
    />
  )

  // Phone, top to bottom: greeting · (session bar | today's card) · day summary · quick actions · indicators and trends
  // (tiles, «Para hoy», notices, weekly summary) · training row.
  // From lg, two columns: the left one is today (card, summary, quick actions, then «Para hoy», notices, weekly summary and
  // the training row); the right one is the indicator tiles alone, spanning the left column's rows.
  const left = 'min-w-0 lg:col-start-1'
  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-5 lg:grid lg:grid-cols-2 lg:grid-rows-[repeat(7,auto)_1fr] lg:items-start lg:gap-x-10" data-testid="dashboard">
        {top ? <div className={left}>{top}</div> : null}
        <div className={left}>{summary}</div>
        <div className={left}>
          <QuickActions mealPath={searchPath(today, mealSlots.now.key, today)} onOpen={setQuick} />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-8 lg:row-start-1 lg:-mt-3">
          <IndicatorGrid present={present} tiles={tiles} />
        </div>
        {insights.length && !blank ? (
          <div className={left}>
            <InsightsSection items={insights} />
          </div>
        ) : null}
        {blank || !alerts.length ? null : (
          <div className={left}>
            <Notices alerts={alerts} />
          </div>
        )}
        {weeklyHasData ? (
          <div className={`${left} border-t border-line`}>
            <WeeklySummary
              from={win.current[0]!}
              to={win.current[6]!}
              kcal={cmpKcal}
              protein={cmpProt}
              steps={cmpSteps}
              sleep={cmpSleep}
              sessions={{ current: sessIn(win.current).length, previous: sessIn(win.previous).length, volumeCurrent: volIn(win.current), volumePrevious: volIn(win.previous) }}
              weight={{ current: tCur?.value ?? null, delta: tCur && tPrev && tCur.date !== tPrev.date ? tCur.value! - tPrev.value! : null }}
            />
          </div>
        ) : null}
        {endRow ? <div className={left}>{endRow}</div> : null}
      </div>
      <QuickLogHost target={quick} onTarget={setQuick} latestWeight={lastW ? { kg: lastW.value as number, date: lastW.date } : null} />
    </>
  )
}
