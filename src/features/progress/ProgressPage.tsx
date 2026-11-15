import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { useRepo } from '../../app/profile'
import { pickGoalForDate } from '../../db/queries'
import type { ExerciseSet } from '../../db/types'
import { addDays, formatDateEs, isoWeekStart, todayLocal } from '../../domain/dates'
import { movingAverage } from '../../domain/stats'
import { e1rm, weeklyVolume } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { EmptyState, PageHeader, Segmented } from '../../ui/kit'
import { dailyIntake, weightSeries } from '../dashboard/useRangeStats'

const C = {
  accent: 'rgb(var(--accent))',
  muted: 'rgb(var(--muted))',
  faint: 'rgb(var(--faint))',
  line: 'rgb(var(--line))',
  ink: 'rgb(var(--ink))',
  surface: 'rgb(var(--surface))',
  protein: 'rgb(var(--protein))',
  carbs: 'rgb(var(--carbs))',
  fat: 'rgb(var(--fat))',
}

const shortDate = (d: string) => formatDateEs(d)
const axisProps = { tick: { fill: C.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: C.line } } as const
const tooltipProps = {
  contentStyle: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, fontSize: 12, color: C.ink },
  labelStyle: { color: C.muted, marginBottom: 4 },
  itemStyle: { color: C.ink, padding: 0 },
  cursor: { stroke: C.line, strokeWidth: 1, fill: 'rgb(var(--surface2) / 0.6)' },
  labelFormatter: (l: unknown) => (typeof l === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l) ? formatDateEs(l, 'weekday') : String(l)),
} as const
const legendProps = { iconSize: 10, wrapperStyle: { fontSize: 12, color: C.muted, paddingTop: 4 } } as const

function ChartCard({ title, subtitle, empty, children, table }: { title: string; subtitle?: ReactNode; empty: boolean; children: ReactNode; table?: { head: string[]; rows: (string | number)[][] } }) {
  return (
    <section className="card p-4" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {subtitle ? <p className="mb-2 text-xs text-muted">{subtitle}</p> : null}
      {empty ? (
        <p className="py-8 text-center text-sm text-muted">Sin datos suficientes en este periodo.</p>
      ) : (
        <>
          <div className="h-56 w-full">{children}</div>
          {table ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">Ver tabla</summary>
              <div className="mt-2 max-h-56 overflow-auto">
                <table className="num w-full text-left text-xs">
                  <thead className="text-faint">
                    <tr>
                      {table.head.map((h) => (
                        <th key={h} className="py-1 pr-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows
                      .slice()
                      .reverse()
                      .map((r, i) => (
                        <tr key={i} className="border-t border-line">
                          {r.map((c, j) => (
                            <td key={j} className="py-1 pr-3">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

const f0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatNumber(n, 0))
const f1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatNumber(n, 1))

export function ProgressPage() {
  const r = useRepo()
  const today = todayLocal()
  const [range, setRange] = useState<'30' | '90' | '180' | '365'>('90')
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
    const kcal = intake.map((x) => ({ date: x.date, app: x.source === 'app' ? x.kcal : null, previo: x.source === 'imported' ? x.kcal : null, objetivo: x.target }))
    const protein = intake.filter((x) => x.source === 'app').map((x) => ({ date: x.date, proteina: x.protein, objetivo: x.proteinTarget }))
    const appDays = intake.filter((x) => x.source === 'app' && x.protein !== null && x.carbs !== null && x.fat !== null)
    const pk = appDays.reduce((s, x) => s + (x.protein as number) * 4, 0)
    const ck = appDays.reduce((s, x) => s + (x.carbs as number) * 4, 0)
    const fk = appDays.reduce((s, x) => s + (x.fat as number) * 9, 0)
    const tot = pk + ck + fk
    const macros = tot > 0 ? { p: (pk / tot) * 100, c: (ck / tot) * 100, f: (fk / tot) * 100, n: appDays.length } : null
    const done = data.sets.filter((s) => s.done)
    const volume = weeklyVolume(done).map((w) => ({ date: w.weekStart, volumen: Math.round(w.volume) }))
    const byEx = new Map<string, { name: string; sets: ExerciseSet[] }>()
    for (const s of done) {
      if (s.weight === null || s.reps === null || s.isWarmup) continue
      const cur = byEx.get(s.exerciseId) ?? { name: s.exerciseName, sets: [] }
      cur.sets.push(s)
      byEx.set(s.exerciseId, cur)
    }
    const exercises = [...byEx.entries()].sort((a, b) => b[1].sets.length - a[1].sets.length).map(([id, v]) => ({ id, name: v.name, n: v.sets.length }))
    const waist = data.body
      .filter((m) => m.date >= from && m.circumferences.waist !== undefined && !m.excludeFromStats)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((m) => ({ date: m.date, cintura: m.circumferences.waist as number }))
    const fat = data.body
      .filter((m) => m.date >= from && m.derived?.bodyFatPct !== undefined)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((m) => ({ date: m.date, grasa: Math.round((m.derived!.bodyFatPct as number) * 10) / 10 }))
    const sums = data.body
      .filter((m) => m.date >= from && m.derived?.sum !== null && m.derived?.sum !== undefined && m.derived.bodyFatPct === undefined)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((m) => ({ date: m.date, suma: m.derived!.sum as number }))
    const sleep = data.sleep
      .filter((s) => !s.excludeFromStats && s.hours !== null)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((s) => ({ date: s.date, horas: s.hours as number }))
    const stepsMap = new Map<string, number>()
    for (const a of data.acts) if (!a.excludeFromStats && a.steps !== null) stepsMap.set(a.date, (stepsMap.get(a.date) ?? 0) + a.steps)
    const steps = [...stepsMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, pasos]) => ({ date, pasos }))
    const goalNow = pickGoalForDate(data.goals, today)
    return { weight, kcal, protein, macros, volume, byEx, exercises, waist, fat, sums, sleep, steps, goalNow }
  }, [data, from, today])

  const exId = exercise || d?.exercises[0]?.id || ''
  const e1rmSeries = useMemo(() => {
    const ex = d?.byEx.get(exId)
    if (!ex) return []
    const bySession = new Map<string, { date: string; best: number }>()
    for (const s of ex.sets) {
      const v = e1rm(s.weight as number, s.reps as number)
      if (v === null) continue
      const cur = bySession.get(s.sessionId)
      if (!cur || v > cur.best) bySession.set(s.sessionId, { date: s.date, best: v })
    }
    return [...bySession.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ date: x.date, e1rm: Math.round(x.best * 10) / 10 }))
  }, [d, exId])

  if (!d) return <PageHeader title="Progreso" back="/mas" />
  const nothing = !d.weight.length && !d.kcal.length && !d.volume.length && !d.waist.length && !d.sleep.length && !d.steps.length
  return (
    <>
      <PageHeader title="Progreso" back="/mas" subtitle="Solo con tus datos registrados" />
      <div className="mb-4">
        <Segmented<'30' | '90' | '180' | '365'>
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
        <div className="grid gap-4 lg:grid-cols-2" data-testid="progress-charts">
          <ChartCard
            title="Peso"
            subtitle="Pesos diarios y media móvil de 7 días (desde 3 días con dato). Los valores aproximados no se incluyen."
            empty={d.weight.length < 2}
            table={{ head: ['Fecha', 'Peso (kg)', 'Media 7 d'], rows: d.weight.map((w) => [shortDate(w.date), f1(w.peso), f1(w.media)]) }}
          >
            <ResponsiveContainer>
              <ComposedChart data={d.weight} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke={C.line} strokeDasharray="0" strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} {...axisProps} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} formatter={(v: unknown, n: unknown) => [`${f1(v as number)} kg`, n === 'peso' ? 'Peso' : 'Media 7 días']} />
                <Legend {...legendProps} formatter={(v: string) => (v === 'peso' ? 'Peso diario' : 'Media 7 días')} />
                <Scatter dataKey="peso" fill={C.accent} fillOpacity={0.45} shape="circle" />
                <Line dataKey="media" stroke={C.accent} strokeWidth={2} dot={false} connectNulls type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Kcal consumidas vs objetivo"
            subtitle={d.kcal.some((k) => k.previo !== null) ? 'Incluye totales diarios del historial previo (sin detalle de alimentos).' : 'Días con alimentos registrados.'}
            empty={!d.kcal.length}
            table={{ head: ['Fecha', 'Kcal', 'Objetivo', 'Origen'], rows: d.kcal.map((k) => [shortDate(k.date), f0(k.app ?? k.previo), f0(k.objetivo), k.app !== null ? 'App' : 'Historial previo']) }}
          >
            <ResponsiveContainer>
              <ComposedChart data={d.kcal} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} formatter={(v: unknown, n: unknown) => [`${f0(v as number)} kcal`, n === 'app' ? 'Registrado' : n === 'previo' ? 'Historial previo' : 'Objetivo']} />
                <Legend {...legendProps} formatter={(v: string) => (v === 'app' ? 'Registrado en la app' : v === 'previo' ? 'Historial previo' : 'Objetivo')} />
                <Bar dataKey="app" stackId="k" fill={C.accent} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="previo" stackId="k" fill={C.faint} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Line dataKey="objetivo" stroke={C.ink} strokeWidth={1.5} strokeDasharray="5 4" dot={false} type="stepAfter" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Proteína vs objetivo"
            subtitle="Solo días con alimentos registrados en la app (los totales importados no tienen macros)."
            empty={!d.protein.length}
            table={{ head: ['Fecha', 'Proteína (g)', 'Objetivo (g)'], rows: d.protein.map((p) => [shortDate(p.date), f0(p.proteina), f0(p.objetivo)]) }}
          >
            <ResponsiveContainer>
              <ComposedChart data={d.protein} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={44} />
                <Tooltip {...tooltipProps} formatter={(v: unknown, n: unknown) => [`${f0(v as number)} g`, n === 'proteina' ? 'Proteína' : 'Objetivo']} />
                <Legend {...legendProps} formatter={(v: string) => (v === 'proteina' ? 'Proteína' : 'Objetivo')} />
                <Bar dataKey="proteina" fill={C.protein} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Line dataKey="objetivo" stroke={C.ink} strokeWidth={1.5} strokeDasharray="5 4" dot={false} type="stepAfter" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <section className="card p-4" aria-label="Reparto de macronutrientes">
            <h2 className="font-semibold">Reparto de macronutrientes</h2>
            <p className="mb-3 text-xs text-muted">
              Promedio del % de kcal de proteína, carbohidratos y grasa{d.macros ? ` en ${d.macros.n} días con datos completos` : ''}.
              {d.goalNow ? ` Objetivo actual: P ${f0(d.goalNow.protein)} g · C ${f0(d.goalNow.carbs)} g · G ${f0(d.goalNow.fat)} g.` : ''}
            </p>
            {d.macros ? (
              <>
                <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`Proteína ${f0(d.macros.p)} %, carbohidratos ${f0(d.macros.c)} %, grasa ${f0(d.macros.f)} %`}>
                  <div style={{ width: `${d.macros.p}%`, background: C.protein }} />
                  <div style={{ width: `${d.macros.c}%`, background: C.carbs }} />
                  <div style={{ width: `${d.macros.f}%`, background: C.fat }} />
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                  {[
                    ['Proteína', d.macros.p, C.protein],
                    ['Carbohidratos', d.macros.c, C.carbs],
                    ['Grasa', d.macros.f, C.fat],
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

          <ChartCard title="Volumen semanal de entrenamiento" subtitle="Peso × repeticiones de las series hechas, sin calentamientos (kg)." empty={!d.volume.length} table={{ head: ['Semana', 'Volumen (kg)'], rows: d.volume.map((v) => [shortDate(v.date), f0(v.volumen)]) }}>
            <ResponsiveContainer>
              <ComposedChart data={d.volume} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={(v: string) => `Sem. ${shortDate(isoWeekStart(v))}`} {...axisProps} minTickGap={16} />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} labelFormatter={(l: unknown) => `Semana del ${formatDateEs(String(l))}`} formatter={(v: unknown) => [`${f0(v as number)} kg`, 'Volumen']} />
                <Bar dataKey="volumen" fill={C.accent} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="1RM estimado"
            subtitle={
              d.exercises.length ? (
                <select className="field mt-1 py-1.5 text-sm" value={exId} onChange={(e) => setExercise(e.target.value)} aria-label="Ejercicio">
                  {d.exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.n} series)
                    </option>
                  ))}
                </select>
              ) : (
                'Mejor serie por sesión (Epley).'
              )
            }
            empty={e1rmSeries.length < 1}
            table={{ head: ['Fecha', '1RM estimado (kg)'], rows: e1rmSeries.map((x) => [shortDate(x.date), f1(x.e1rm)]) }}
          >
            <ResponsiveContainer>
              <ComposedChart data={e1rmSeries} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis domain={['dataMin - 5', 'dataMax + 5']} {...axisProps} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} formatter={(v: unknown) => [`${f1(v as number)} kg`, '1RM estimado']} />
                <Line dataKey="e1rm" stroke={C.accent} strokeWidth={2} dot={{ r: 4, fill: C.accent, stroke: C.surface, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Cintura" subtitle="Perímetro de cintura (cm)." empty={d.waist.length < 1} table={{ head: ['Fecha', 'Cintura (cm)'], rows: d.waist.map((w) => [shortDate(w.date), f1(w.cintura)]) }}>
            <ResponsiveContainer>
              <ComposedChart data={d.waist} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis domain={['dataMin - 2', 'dataMax + 2']} {...axisProps} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} formatter={(v: unknown) => [`${f1(v as number)} cm`, 'Cintura']} />
                <Line dataKey="cintura" stroke={C.accent} strokeWidth={2} dot={{ r: 4, fill: C.accent, stroke: C.surface, strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {d.fat.length ? (
            <ChartCard title="Grasa corporal estimada" subtitle="Calculada con ecuaciones de pliegues: es una estimación." empty={false} table={{ head: ['Fecha', 'Grasa (%)'], rows: d.fat.map((x) => [shortDate(x.date), f1(x.grasa)]) }}>
              <ResponsiveContainer>
                <ComposedChart data={d.fat} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                  <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                  <YAxis domain={['dataMin - 2', 'dataMax + 2']} {...axisProps} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
                  <Tooltip {...tooltipProps} formatter={(v: unknown) => [`${f1(v as number)} %`, 'Grasa estimada']} />
                  <Line dataKey="grasa" stroke={C.accent} strokeWidth={2} dot={{ r: 4, fill: C.accent, stroke: C.surface, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <ChartCard title="Suma de pliegues" subtitle="Protocolos sin ecuación de % de grasa (ISAK o suma personalizada), en mm." empty={!d.sums.length} table={{ head: ['Fecha', 'Suma (mm)'], rows: d.sums.map((x) => [shortDate(x.date), f1(x.suma)]) }}>
              <ResponsiveContainer>
                <ComposedChart data={d.sums} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                  <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                  <YAxis domain={['dataMin - 5', 'dataMax + 5']} {...axisProps} width={44} tickFormatter={(v: number) => formatNumber(v, 0)} />
                  <Tooltip {...tooltipProps} formatter={(v: unknown) => [`${f1(v as number)} mm`, 'Suma de pliegues']} />
                  <Line dataKey="suma" stroke={C.accent} strokeWidth={2} dot={{ r: 4, fill: C.accent, stroke: C.surface, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <ChartCard title="Sueño" subtitle="Horas dormidas por noche (registros exactos)." empty={!d.sleep.length} table={{ head: ['Fecha', 'Horas'], rows: d.sleep.map((s) => [shortDate(s.date), f1(s.horas)]) }}>
            <ResponsiveContainer>
              <ComposedChart data={d.sleep} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={36} domain={[0, 'dataMax + 1']} />
                <Tooltip {...tooltipProps} formatter={(v: unknown) => [`${f1(v as number)} h`, 'Sueño']} />
                <Bar dataKey="horas" fill={C.protein} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Pasos" subtitle="Pasos por día." empty={!d.steps.length} table={{ head: ['Fecha', 'Pasos'], rows: d.steps.map((s) => [shortDate(s.date), f0(s.pasos)]) }}>
            <ResponsiveContainer>
              <ComposedChart data={d.steps} margin={{ top: 8, right: 8, bottom: 0, left: -4 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => formatNumber(v, 0)} />
                <Tooltip {...tooltipProps} formatter={(v: unknown) => [f0(v as number), 'Pasos']} />
                <Bar dataKey="pasos" fill={C.accent} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </>
  )
}
