import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { ExerciseSet } from '../../db/types'
import { addDays, dateRange, daysBetween, isoWeekStart } from '../../domain/dates'
import { useToday } from '../../app/useToday'
import { isWarmupSet } from '../../domain/setKind'
import { movingAverage } from '../../domain/stats'
import { weeklyVolume } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { ChartPanel } from '../../ui/charts/ChartPanel'
import { ChartTable } from '../../ui/charts/ChartTable'
import { TimeSeriesChart } from '../../ui/charts/TimeSeriesChart'
import type { Point, Series } from '../../ui/charts/types'
import { EmptyState, PageHeader, Segmented } from '../../ui/kit'
import { dailyIntake, weightSeries } from '../dashboard/useRangeStats'
import { shortDate } from '../../ui/charts/geometry'
import { headlineOf, headlinePeriod, type HeadlineKind } from './headline'
import { MAX_GAP_DAYS, metricSeries, sessionPoints } from '../training/exerciseProgress'

type Range = '30' | '90' | '180' | '365'
const PERIOD_TEXT: Record<Range, string> = { '30': 'Últimos 30 días', '90': 'Últimos 90 días', '180': 'Últimos 6 meses', '365': 'Último año' }

const f0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatNumber(n, 0))

const pts = (rows: { date: string; value: number | null }[], extra?: Partial<Point>): Point[] => rows.map((r) => ({ date: r.date, value: r.value, ...extra }))
const bySortedDate = <T extends { date: string }>(rows: T[]) => rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1))

interface ProgressChartProps {
  title: string
  series: Series[]
  /** Series for "Ver tabla" (defaults to `series`). */
  tableSeries?: Series[]
  from: string
  to: string
  period: string
  /** Text under the chart (what the numbers mean). */
  note?: string
  coverage?: (count: number) => string
  height?: number
  maxGapDays?: number
  headerAction?: ReactNode
  /** `sum`: the big number is the mean of complete days/weeks; `level`: the latest value with its date. */
  kind: HeadlineKind
  today: string
  /** Bars are weeks (the current one is partial). */
  weekly?: boolean
}

/** One chart of the page: approved panel + time-axis chart + table alternative. Fewer than 2 points: a plain message. */
function ProgressChart({ title, series, tableSeries, from, to, period, note, coverage, height = 200, maxGapDays, headerAction, kind, today, weekly }: ProgressChartProps) {
  const primary = series[0]!
  const inRange = primary.points.filter((p) => p.value !== null && p.date >= from && p.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1))
  const head = headlineOf(inRange, kind, today, weekly)
  if (inRange.length < 2)
    return (
      <section className="rounded-2xl border border-line bg-surface p-4" aria-label={title} data-testid="chart-panel">
        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <h3 className="text-label font-medium text-muted">{title}</h3>
          {headerAction}
        </div>
        {note ? <p className="mb-2 text-label text-muted">{note}</p> : null}
        <p className="py-8 text-center text-sm text-muted">Sin datos suficientes en este periodo.</p>
      </section>
    )
  const label = (v: number, unit: string) => `${f1Or0(v)}${unit ? ` ${unit}` : ''}`
  return (
    <ChartPanel
      title={title}
      value={head.value !== null ? f1Or0(head.value) : null}
      unit={primary.unit}
      period={headlinePeriod(head, period, today, shortDate)}
      coverage={coverage ? `${coverage(inRange.length)}${head.partialExcluded ? (weekly ? ' · la semana en curso no cuenta en la media' : ' · hoy (en curso) no cuenta en la media') : ''}` : undefined}
      note={note}
      headerAction={headerAction}
      table={<ChartTable series={tableSeries ?? series} from={from} to={to} caption={`${title}, valores por día`} formatValue={label} />}
    >
      <TimeSeriesChart series={series} from={from} to={to} height={height} maxGapDays={maxGapDays} ariaLabel={`${title}, ${period.toLowerCase()}`} formatValue={label} />
    </ChartPanel>
  )
}

const f1Or0 = (v: number) => formatNumber(v, Math.abs(v) >= 100 ? 0 : 1)
const daysWith = (n: number) => `${n} ${n === 1 ? 'día' : 'días'} con dato`

const MACRO = { protein: 'rgb(var(--protein))', carbs: 'rgb(var(--carbs))', fat: 'rgb(var(--fat))' }

export function ProgressPage() {
  const r = useRepo()
  const today = useToday()
  const [range, setRange] = useState<Range>('90')
  const from = addDays(today, -(Number(range) - 1))
  const data = useLiveQuery(async () => {
    const [logs, imported, goals, body, sets, sleep, acts] = await Promise.all([
      r.range('foodLogs', from, today),
      r.range('importedDaily', from, today),
      r.all('goals'),
      r.range('bodyMeasurements', addDays(from, -7), today),
      r.range('exerciseSets', from, today),
      r.range('sleepLogs', from, today),
      r.range('activityLogs', from, today),
    ])
    return { logs, imported, goals, body, sets, sleep, acts }
  }, [r, from, today])
  const [exercise, setExercise] = useState<string>('')

  const d = useMemo(() => {
    if (!data) return null
    const ws = weightSeries(data.body)
    const ma = movingAverage(ws, 7).filter((p) => p.date >= from)
    const weight = ma.map((p) => ({ date: p.date, peso: p.value, media: p.n >= 3 ? Math.round(p.avg * 100) / 100 : null }))
    const intake = dailyIntake(data.logs, data.imported, data.goals, from, today)
    const days = dateRange(from, today)
    const kcal = intake.filter((x) => x.kcal !== null).map((x) => ({ date: x.date, value: x.kcal, previo: x.source === 'imported', target: x.target }))
    const protein = intake.filter((x) => x.source === 'app' && x.protein !== null).map((x) => ({ date: x.date, value: x.protein, target: x.proteinTarget }))
    // Target lines run over every day of the period (the goal in force that day), not only the days with food logged.
    const kcalTarget = days.map((date) => ({ date, value: pickGoalForDate(data.goals, date)?.kcal ?? null }))
    const proteinTarget = days.map((date) => ({ date, value: pickGoalForDate(data.goals, date)?.protein ?? null }))
    const appDays = intake.filter((x) => x.source === 'app' && x.protein !== null && x.carbs !== null && x.fat !== null)
    const pk = appDays.reduce((s, x) => s + (x.protein as number) * 4, 0)
    const ck = appDays.reduce((s, x) => s + (x.carbs as number) * 4, 0)
    const fk = appDays.reduce((s, x) => s + (x.fat as number) * 9, 0)
    const tot = pk + ck + fk
    const macros = tot > 0 ? { p: (pk / tot) * 100, c: (ck / tot) * 100, f: (fk / tot) * 100, n: appDays.length } : null
    const done = data.sets.filter((s) => s.done)
    const weekFrom = isoWeekStart(from)
    const volume = weeklyVolume(done).map((w) => ({ date: w.weekStart, value: Math.round(w.volume), span: Math.min(7, daysBetween(w.weekStart, today) + 1) }))
    const byEx = new Map<string, { name: string; sets: ExerciseSet[] }>()
    for (const s of done) {
      if (s.weight === null || s.reps === null || isWarmupSet(s)) continue
      const cur = byEx.get(s.exerciseId) ?? { name: s.exerciseName, sets: [] }
      cur.sets.push(s)
      byEx.set(s.exerciseId, cur)
    }
    const exercises = [...byEx.entries()].sort((a, b) => b[1].sets.length - a[1].sets.length).map(([id, v]) => ({ id, name: v.name, n: v.sets.length }))
    const waist = bySortedDate(data.body.filter((m) => m.date >= from && m.circumferences.waist !== undefined && !m.excludeFromStats)).map((m) => ({ date: m.date, value: m.circumferences.waist as number }))
    const fat = bySortedDate(data.body.filter((m) => m.date >= from && m.derived?.bodyFatPct !== undefined)).map((m) => ({ date: m.date, value: Math.round((m.derived!.bodyFatPct as number) * 10) / 10 }))
    const sums = bySortedDate(data.body.filter((m) => m.date >= from && m.derived?.sum !== null && m.derived?.sum !== undefined && m.derived.bodyFatPct === undefined)).map((m) => ({ date: m.date, value: m.derived!.sum as number }))
    const sleep = bySortedDate(data.sleep.filter((s) => !s.excludeFromStats && s.hours !== null)).map((s) => ({ date: s.date, value: s.hours as number }))
    const stepsMap = new Map<string, number>()
    for (const a of data.acts) if (!a.excludeFromStats && a.steps !== null) stepsMap.set(a.date, (stepsMap.get(a.date) ?? 0) + a.steps)
    const steps = [...stepsMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }))
    const goalNow = pickGoalForDate(data.goals, today)
    return { weight, kcal, protein, kcalTarget, proteinTarget, macros, volume, weekFrom, byEx, exercises, waist, fat, sums, sleep, steps, goalNow }
  }, [data, from, today])

  const exId = exercise || d?.exercises[0]?.id || ''
  const e1rmSeries = useMemo<Series>(() => {
    const ex = d?.byEx.get(exId)
    const base = metricSeries(ex ? sessionPoints(ex.sets) : [], 'e1rm')
    return { ...base, label: '1RM estimado', unit: 'kg' }
  }, [d, exId])

  const charts = useMemo(() => {
    if (!d) return null
    const period = PERIOD_TEXT[range]
    const body = 'body'
    const targetSeries = (id: string, rows: { date: string; value: number | null }[], unit: string, colorVar: string): Series => ({ id, label: 'Objetivo', unit, colorVar, kind: 'line', role: 'previous', points: pts(rows) })
    // Table version of the target: only the days that have a logged value (the chart draws it over the whole period).
    const targetCol = (id: string, rows: { date: string; target: number | null }[], unit: string, colorVar: string): Series => ({ id, label: 'Objetivo', unit, colorVar, kind: 'line', role: 'trend', points: rows.map((x) => ({ date: x.date, value: x.target })) })

    const peso: Series = { id: 'peso', label: 'Peso diario', unit: 'kg', colorVar: body, kind: 'dots', role: 'measured', points: pts(d.weight.map((w) => ({ date: w.date, value: w.peso }))) }
    const media: Series = { id: 'media', label: 'Media 7 días', unit: 'kg', colorVar: body, kind: 'line', role: 'trend', points: pts(d.weight.map((w) => ({ date: w.date, value: w.media }))) }

    const kcalBars: Series = { id: 'kcal', label: 'Kcal', unit: 'kcal', colorVar: 'energy', kind: 'bar', role: 'measured', points: d.kcal.map((k) => ({ date: k.date, value: k.value, ...(k.previo ? { estimated: true } : {}) })) }
    const proteinBars: Series = { id: 'proteina', label: 'Proteína', unit: 'g', colorVar: 'protein', kind: 'bar', role: 'measured', points: pts(d.protein) }
    const haveKcalGoal = d.kcalTarget.some((x) => x.value !== null)
    const haveProteinGoal = d.proteinTarget.some((x) => x.value !== null)

    const volumeBars: Series = { id: 'volumen', label: 'Volumen', unit: 'kg', colorVar: 'train', kind: 'bar', role: 'measured', points: d.volume }
    const line = (id: string, label: string, unit: string, colorVar: string, rows: { date: string; value: number | null }[], estimated = false): Series => ({ id, label, unit, colorVar, kind: 'line', role: 'measured', points: pts(rows, estimated ? { estimated: true } : undefined) })
    return {
      period,
      weight: { series: [peso, media] },
      kcal: { series: haveKcalGoal ? [kcalBars, targetSeries('kcal-goal', d.kcalTarget, 'kcal', 'energy')] : [kcalBars], table: haveKcalGoal ? [kcalBars, targetCol('kcal-goal', d.kcal, 'kcal', 'energy')] : [kcalBars] },
      protein: { series: haveProteinGoal ? [proteinBars, targetSeries('protein-goal', d.proteinTarget, 'g', 'protein')] : [proteinBars], table: haveProteinGoal ? [proteinBars, targetCol('protein-goal', d.protein, 'g', 'protein')] : [proteinBars] },
      volume: { series: [volumeBars] },
      waist: { series: [line('cintura', 'Cintura', 'cm', body, d.waist)] },
      fat: { series: [line('grasa', 'Grasa estimada', '%', body, d.fat, true)] },
      sums: { series: [line('suma', 'Suma de pliegues', 'mm', body, d.sums)] },
      sleep: { series: [{ id: 'sueno', label: 'Sueño', unit: 'h', colorVar: 'sleep', kind: 'bar', role: 'measured', points: pts(d.sleep) } satisfies Series] },
      steps: { series: [{ id: 'pasos', label: 'Pasos', unit: 'pasos', colorVar: 'move', kind: 'bar', role: 'measured', points: pts(d.steps) } satisfies Series] },
    }
  }, [d, range])

  if (!d || !charts) return <PageHeader title="Progreso" back="/mas" />
  const { period } = charts
  const nothing = !d.weight.length && !d.kcal.length && !d.volume.length && !d.waist.length && !d.sleep.length && !d.steps.length
  const hasPrevious = d.kcal.some((k) => k.previo)
  return (
    <>
      <PageHeader title="Progreso" back="/mas" subtitle="Solo con tus datos registrados" />
      <div className="mb-4">
        <Segmented<Range>
          value={range}
          onChange={setRange}
          ariaLabel="Periodo"
          options={[
            { value: '30', label: '30 d' },
            { value: '90', label: '90 d' },
            { value: '180', label: '6 m' },
            { value: '365', label: '1 año' },
          ]}
        />
      </div>
      {nothing ? (
        <EmptyState icon="chart" title="Aún no hay datos para graficar">
          Las gráficas aparecen cuando registras peso, comidas, entrenos, sueño o actividad. Nada se rellena con valores de ejemplo.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2" data-testid="progress-charts" key={range}>
          <ProgressChart
            title="Peso"
            kind="level"
            today={today}
            series={charts.weight.series}
            from={from}
            to={today}
            period={period}
            note="Pesos diarios y media móvil de 7 días (desde 3 días con dato). Los valores aproximados no se incluyen."
            coverage={daysWith}
            maxGapDays={7}
          />
          <ProgressChart
            title="Kcal consumidas vs objetivo"
            kind="sum"
            today={today}
            series={charts.kcal.series}
            tableSeries={charts.kcal.table}
            from={from}
            to={today}
            period={period}
            note={hasPrevious ? 'Barras huecas: totales diarios del historial previo (sin detalle de alimentos).' : 'Días con alimentos registrados. La línea fina es tu objetivo.'}
            coverage={daysWith}
          />
          <ProgressChart
            title="Proteína vs objetivo"
            kind="sum"
            today={today}
            series={charts.protein.series}
            tableSeries={charts.protein.table}
            from={from}
            to={today}
            period={period}
            note="Solo días con alimentos registrados en la app (los totales importados no tienen macros)."
            coverage={daysWith}
          />

          <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Reparto de macronutrientes" data-testid="chart-panel">
            <h3 className="flex min-h-[44px] items-center text-label font-medium text-muted">Reparto de macronutrientes</h3>
            <p className="mb-3 text-xs text-muted">
              Promedio del % de kcal de proteína, carbohidratos y grasa{d.macros ? ` en ${d.macros.n} días con datos completos` : ''}.
              {d.goalNow ? ` Objetivo actual: P ${f0(d.goalNow.protein)} g · C ${f0(d.goalNow.carbs)} g · G ${f0(d.goalNow.fat)} g.` : ''}
            </p>
            {d.macros ? (
              <>
                <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`Proteína ${f0(d.macros.p)} %, carbohidratos ${f0(d.macros.c)} %, grasa ${f0(d.macros.f)} %`}>
                  <div style={{ width: `${d.macros.p}%`, background: MACRO.protein }} />
                  <div style={{ width: `${d.macros.c}%`, background: MACRO.carbs }} />
                  <div style={{ width: `${d.macros.f}%`, background: MACRO.fat }} />
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                  {[
                    ['Proteína', d.macros.p, MACRO.protein],
                    ['Carbohidratos', d.macros.c, MACRO.carbs],
                    ['Grasa', d.macros.f, MACRO.fat],
                  ].map(([l, v, c]) => (
                    <li key={l as string} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c as string }} />
                      <span className="text-muted">{l as string}</span>
                      <span className="num font-semibold">{f0(v as number)} %</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted">Sin datos suficientes en este periodo.</p>
            )}
          </section>

          <ProgressChart
            title="Volumen semanal de entrenamiento"
            kind="sum"
            weekly
            today={today}
            series={charts.volume.series}
            from={d.weekFrom}
            to={today}
            period={period}
            note="Peso × repeticiones de las series hechas, sin calentamientos (kg). Cada barra es una semana (lunes a domingo)."
            coverage={(n) => `${n} ${n === 1 ? 'semana' : 'semanas'} con entreno`}
          />
          <ProgressChart
            title="1RM estimado"
            kind="level"
            today={today}
            series={[e1rmSeries]}
            from={from}
            to={today}
            period={period}
            note="Mejor serie por sesión (Epley). Es una estimación, no una medición directa."
            coverage={(n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`}
            maxGapDays={MAX_GAP_DAYS}
            headerAction={
              d.exercises.length ? (
                <select className="field min-h-[44px] max-w-[11.5rem] truncate py-1.5 text-sm" value={exId} onChange={(e) => setExercise(e.target.value)} aria-label="Ejercicio">
                  {d.exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.n} series)
                    </option>
                  ))}
                </select>
              ) : null
            }
          />
          <ProgressChart kind="level" today={today} title="Cintura" series={charts.waist.series} from={from} to={today} period={period} note="Perímetro de cintura (cm)." coverage={(n) => `${n} registros`} maxGapDays={14} />
          {d.fat.length ? (
            <ProgressChart kind="level" today={today} title="Grasa corporal estimada" series={charts.fat.series} from={from} to={today} period={period} note="Calculada con ecuaciones de pliegues: es una estimación." coverage={(n) => `${n} registros`} maxGapDays={45} />
          ) : (
            <ProgressChart kind="level" today={today} title="Suma de pliegues" series={charts.sums.series} from={from} to={today} period={period} note="Protocolos sin ecuación de % de grasa (ISAK o suma personalizada), en mm." coverage={(n) => `${n} registros`} maxGapDays={45} />
          )}
          <ProgressChart kind="sum" today={today} title="Sueño" series={charts.sleep.series} from={from} to={today} period={period} note="Horas dormidas por noche (registros exactos)." coverage={daysWith} />
          <ProgressChart kind="sum" today={today} title="Pasos" series={charts.steps.series} from={from} to={today} period={period} note="Pasos por día." coverage={daysWith} />
        </div>
      )}
    </>
  )
}
