import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import type { TrackingType } from '../../db/catalogTypes'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { useToday } from '../../app/useToday'
import { formatDateEs } from '../../domain/dates'
import { e1rm } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { useConfirm } from '../../ui/Confirm'
import { Icon } from '../../ui/Icon'
import { Metric } from '../../ui/Metric'
import { SectionHeader } from '../../ui/SectionHeader'
import { Skeleton } from '../../ui/Skeleton'
import { Tabs, tabId, tabPanelId } from '../../ui/Tabs'
import { ChartPanel } from '../../ui/charts/ChartPanel'
import { ChartTable } from '../../ui/charts/ChartTable'
import { fmtNumber, repsUnit } from '../../ui/charts/geometry'
import { TimeSeriesChart } from '../../ui/charts/TimeSeriesChart'
import { EmptyState, PageHeader, Segmented } from '../../ui/kit'
import {
  exercisePath,
  FORCE_LABEL,
  findVariants,
  LEVEL_LABEL,
  loadExerciseSets,
  MECHANIC_LABEL,
  rankSubstitutions,
  reasonText,
  summarizeSessions,
  type Related,
} from './exerciseKnowledge'
import {
  bestVolumeSession,
  countInRange,
  defaultPeriod,
  E1RM_NOTE,
  isHistorySet,
  MAX_GAP_DAYS,
  METRIC_META,
  metricSeries,
  metricsFor,
  PERIOD_OPTIONS,
  periodRange,
  recordList,
  repRecords,
  sessionPoints,
  setKindOf,
  weeklyFrequency,
  type MetricId,
  type ProgressPeriod,
  type RecordEntry,
  type SetKind,
} from './exerciseProgress'
import { ExerciseIllustration, ExerciseThumb, useExerciseMedia, type ExerciseMedia } from './exerciseMedia'
import { MuscleMap } from './MuscleMap'
import { muscleList, TRACKING_LABEL, useExercises, type Exercise } from './exercises'
import { formatDuration, formatSet, PR_LABEL, prsBySet } from './sets'

type Tab = 'summary' | 'history' | 'records' | 'technique'
const TABS: { value: Tab; label: string }[] = [
  { value: 'summary', label: 'Resumen' },
  { value: 'history', label: 'Historial' },
  { value: 'records', label: 'Récords' },
  { value: 'technique', label: 'Técnica' },
]

export function FavoriteButton({ on, onToggle, name }: { on: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      className={`btn-ghost p-1.5 ${on ? 'text-warn' : 'text-faint'}`}
      aria-pressed={on}
      aria-label={on ? `Quitar ${name} de favoritos` : `Marcar ${name} como favorito`}
      onClick={onToggle}
      data-testid="favorite-toggle"
    >
      <Icon name="star" size={22} className={on ? 'fill-current' : ''} />
    </button>
  )
}

// ───────────── formatting ─────────────
/** Value and unit of a record, ready for a Metric. */
function recordValue(r: Pick<RecordEntry, 'value' | 'unit'>): { value: string; unit: string } {
  switch (r.unit) {
    case 'kg':
      return { value: fmtNumber(r.value, 1), unit: 'kg' }
    case 'reps':
      return { value: fmtNumber(r.value, 0), unit: 'reps' }
    case 's':
      return { value: formatDuration(r.value), unit: '' }
    default:
      return r.value >= 1000 ? { value: fmtNumber(r.value / 1000, 2), unit: 'km' } : { value: fmtNumber(r.value, 0), unit: 'm' }
  }
}
const setText = (r: RecordEntry, t: TrackingType) => formatSet(r.set, t)

const sessionMinutes = (s: TrainingSession | undefined): number | null => {
  if (!s) return null
  if (typeof s.durationMin === 'number' && s.durationMin > 0) return Math.round(s.durationMin)
  if (s.startedAt && s.endedAt) {
    const m = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000)
    return m > 0 && m < 600 ? m : null
  }
  return null
}

const PR_SHORT: Record<string, string> = {
  max_weight: 'Peso',
  max_e1rm: '1RM',
  max_reps_at_weight: 'Reps',
  max_volume_set: 'Volumen',
  max_duration: 'Tiempo',
  max_distance: 'Distancia',
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-rows text-body" data-testid="exercise-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-[44px] items-center justify-between gap-4">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function EmptyHistory({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'py-6' : 'rounded-2xl border border-dashed border-line-strong px-4 py-6'} data-testid="exercise-empty-progress">
      <p className="text-heading">Aún no has registrado este ejercicio</p>
      <p className="mt-1 text-body text-muted">
        Cuando completes series de este ejercicio en una sesión, aquí aparecerán tu gráfica de progreso, el historial por sesión y tus récords con su fecha.
      </p>
    </div>
  )
}

// ───────────── the detail ─────────────
/**
 * Exercise detail: one component for the full page and for the sheet used by pickers. `onOpen` opens a
 * variant or substitute; `onLeave` runs when a link inside leaves the screen (a sheet closes itself).
 */
export function ExerciseDetail({
  exercise,
  onOpen,
  onLeave,
  onDeleted,
}: {
  exercise: Exercise
  onOpen: (e: Exercise) => void
  onLeave?: () => void
  onDeleted?: () => void
}) {
  const r = useRepo()
  const ex = useExercises()
  const confirm = useConfirm()
  const media = useExerciseMedia()
  const item = media?.items[exercise.id]
  const [tab, setTab] = useState<Tab>('summary')
  const sets = useLiveQuery(() => loadExerciseSets(r, exercise.id, ex.aliases), [r, exercise.id, ex.aliases])
  const sessionRows = useLiveQuery(() => r.all('trainingSessions'), [r])
  const t = exercise.trackingType
  const labels = ex.labels
  const isFav = ex.favorites.has(exercise.id)

  const stat = useMemo(() => (sets ?? []).filter(isHistorySet), [sets])
  const points = useMemo(() => sessionPoints(stat), [stat])
  const hasHistory = points.length > 0
  const sessionById = useMemo(() => new Map((sessionRows ?? []).map((s) => [s.id, s])), [sessionRows])

  const equipment = exercise.equipment ? (labels.equipment[exercise.equipment] ?? exercise.equipment) : 'Sin equipo'
  const muscles = muscleList(exercise, labels)
  const tile = { equipment: exercise.equipment, category: exercise.category, primaryMuscles: exercise.primaryMuscles, secondaryMuscles: exercise.secondaryMuscles }

  const body: Record<Tab, ReactNode> = {
    summary: (
      <SummaryTab
        exercise={exercise}
        t={t}
        sets={stat}
        loaded={sets !== undefined}
        hasHistory={hasHistory}
        labels={labels}
        equipment={equipment}
        illustration={
          exercise.custom ? null : <ExerciseIllustration key={exercise.id} exerciseId={exercise.id} media={media} item={item} exercise={tile} muscle={muscles || undefined} equipment={equipment} />
        }
      />
    ),
    history: sets === undefined ? <Skeleton lines={4} label="Cargando historial" /> : !hasHistory ? <EmptyHistory compact /> : <HistoryTab sets={sets.filter(isHistorySet)} t={t} sessionById={sessionById} onLeave={onLeave} />,
    records: sets === undefined ? <Skeleton lines={4} label="Cargando récords" /> : !hasHistory ? <EmptyHistory compact /> : <RecordsTab sets={stat} t={t} sessionById={sessionById} onLeave={onLeave} />,
    technique: <TechniqueTab exercise={exercise} item={item} onOpen={onOpen} />,
  }

  return (
    <div className="space-y-5 pb-2" data-testid="exercise-detail">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-label text-muted">{[muscles, equipment].filter(Boolean).join(' · ')}</p>
        <FavoriteButton on={isFav} onToggle={() => void ex.toggleFavorite(exercise)} name={exercise.nameEs} />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        fit
        idBase="exercise"
        ariaLabel="Secciones del ejercicio"
        tabs={TABS}
      />
      <div role="tabpanel" id={tabPanelId('exercise', tab)} aria-labelledby={tabId('exercise', tab)} tabIndex={-1} className="outline-none">
        {body[tab]}
      </div>
      {exercise.custom ? (
        <button
          className="btn-danger w-full"
          onClick={async () => {
            const ok = await confirm({ title: 'Eliminar ejercicio propio', body: 'Las series registradas se conservan.', confirmLabel: 'Eliminar', tone: 'danger' })
            if (!ok) return
            await r.remove('customExercises', exercise.id.replace(/^custom:/, ''))
            onDeleted?.()
          }}
        >
          <Icon name="trash" size={16} /> Eliminar ejercicio
        </button>
      ) : null}
    </div>
  )
}

// ───────────── Resumen ─────────────
function SummaryTab({
  exercise,
  t,
  sets,
  loaded,
  hasHistory,
  labels,
  equipment,
  illustration,
}: {
  exercise: Exercise
  t: TrackingType
  sets: ExerciseSet[]
  loaded: boolean
  hasHistory: boolean
  labels: ReturnType<typeof useExercises>['labels']
  equipment: string
  illustration: ReactNode
}) {
  return (
    <div className="space-y-7">
      {illustration}
      {!loaded ? <Skeleton lines={5} label="Cargando progreso" /> : hasHistory ? <ProgressSection exercise={exercise} t={t} sets={sets} /> : <EmptyHistory />}
      <section aria-label="Músculos" className="space-y-3">
        <SectionHeader title="Músculos" />
        {exercise.primaryMuscles.length || exercise.secondaryMuscles.length ? (
          <MuscleMap primary={exercise.primaryMuscles} secondary={exercise.secondaryMuscles} labels={labels.muscles} />
        ) : (
          <p className="text-body text-muted">Sin músculos indicados para este ejercicio.</p>
        )}
      </section>
      <section aria-label="Datos" className="space-y-1">
        <SectionHeader title="Datos" />
        <Facts
          rows={[
            ['Equipo', equipment],
            ['Dificultad', exercise.level ? (LEVEL_LABEL[exercise.level] ?? exercise.level) : '—'],
            ['Tipo', labels.category[exercise.category] ?? exercise.category],
            ['Mecánica', exercise.mechanic ? (MECHANIC_LABEL[exercise.mechanic] ?? exercise.mechanic) : '—'],
            ['Fuerza', exercise.force ? (FORCE_LABEL[exercise.force] ?? exercise.force) : '—'],
            ['Se registra como', TRACKING_LABEL[t]],
          ]}
        />
      </section>
    </div>
  )
}

/** Compact period choice for a chart header: a native select with a 44 px hit area. */
function PeriodSelect({ value, onChange }: { value: ProgressPeriod; onChange: (v: ProgressPeriod) => void }) {
  return (
    <label className="relative inline-flex min-h-[44px] items-center">
      <span className="sr-only">Periodo</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProgressPeriod)}
        className="min-h-[44px] cursor-pointer appearance-none rounded-lg bg-surface2 py-1 pl-3 pr-7 text-label font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="period-select"
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2 text-muted" />
    </label>
  )
}

function ProgressSection({ exercise, t, sets }: { exercise: Exercise; t: TrackingType; sets: ExerciseSet[] }) {
  const points = useMemo(() => sessionPoints(sets), [sets])
  const metrics = useMemo(() => metricsFor(t, sets), [t, sets])
  const [metricPick, setMetric] = useState<MetricId | null>(null)
  const [periodPick, setPeriod] = useState<ProgressPeriod | null>(null)
  const metric = metricPick && metrics.includes(metricPick) ? metricPick : metrics[0]!
  const meta = METRIC_META[metric]
  const today = useToday()
  const first = points[0]?.date ?? null
  const series = useMemo(() => metricSeries(points, metric), [points, metric])
  const period = periodPick ?? defaultPeriod(metricSeries(points, metrics[0]!), today, first)
  const { from, to } = periodRange(period, today, first)
  const inRange = series.points.filter((p) => p.value !== null && p.date >= from && p.date <= to)
  const latest = inRange[inRange.length - 1]
  const firstIn = inRange[0]
  const periodLong = PERIOD_OPTIONS.find((o) => o.value === period)!.long
  const n = countInRange(series, from, to)
  const freq = useMemo(() => weeklyFrequency(points, from, to), [points, from, to])
  const recs = useMemo(() => recordList(sets), [sets])
  const bestVol = useMemo(() => bestVolumeSession(points), [points])
  const shown = ['maxWeight', 'e1rm', 'volumeSet', 'maxReps', 'maxDuration', 'maxDistance']
    .map((id) => recs.find((x) => x.id === id))
    .filter((x): x is RecordEntry => !!x)
    .slice(0, 4)
  const chartLabel = `${meta.title} de ${exercise.nameEs}`

  return (
    <>
      <section aria-label="Progreso" className="space-y-3" data-testid="exercise-progress">
        <SectionHeader title="Progreso" hint={`${new Set(points.map((p) => p.sessionId)).size} sesiones desde ${formatDateEs(points[0]!.date)}`} />
        {metrics.length > 1 ? (
          <Segmented<MetricId> value={metric} onChange={setMetric} size="sm" ariaLabel="Métrica de la gráfica" options={metrics.map((m) => ({ value: m, label: METRIC_META[m].short }))} />
        ) : null}
        <ChartPanel
          key={`${metric}-${period}`}
          title={meta.title}
          value={latest ? fmtNumber(latest.value as number, series.unit === 'kg' || series.unit === 'min' || series.unit === 'km' ? ((latest.value as number) < 1000 ? 1 : 0) : 0) : null}
          unit={series.unit}
          period={`${periodLong} · último valor`}
          coverage={`${n} ${n === 1 ? 'sesión' : 'sesiones'} con dato en el periodo`}
          note={`${meta.estimated ? 'Estimación, no medida' : 'Medido'}. La línea se corta si pasan más de ${MAX_GAP_DAYS} días entre dos sesiones.`}
          headerAction={<PeriodSelect value={period} onChange={setPeriod} />}
          pointCount={n}
          delta={
            latest && firstIn && n >= 2 && latest.date !== firstIn.date
              ? { value: (latest.value as number) - (firstIn.value as number), unit: repsUnit((latest.value as number) - (firstIn.value as number), series.unit), period: `desde el ${formatDateEs(firstIn.date)}`, goodWhen: 'up' }
              : undefined
          }
          table={<ChartTable series={[series]} from={from} to={to} caption={chartLabel} />}
        >
          <TimeSeriesChart series={[series]} from={from} to={to} maxGapDays={MAX_GAP_DAYS} zeroBaseline={meta.zeroBaseline} height={200} ariaLabel={chartLabel} />
        </ChartPanel>
        {metric === 'e1rm' ? (
          <p className="text-label text-muted" data-testid="e1rm-note">
            {E1RM_NOTE}
          </p>
        ) : null}
        <ChartPanel
          title="Frecuencia de entreno"
          value={fmtNumber(freq.perWeek, 1)}
          unit={Math.round(freq.perWeek * 10) === 10 ? "sesión por semana" : "sesiones por semana"}
          period={periodLong}
          coverage={`${freq.sessions} ${freq.sessions === 1 ? 'sesión' : 'sesiones'} en ${freq.weeks} ${freq.weeks === 1 ? 'semana' : 'semanas'}`}
          pointCount={freq.series.points.length}
          table={<ChartTable series={[freq.series]} from={from} to={to} caption="Sesiones por semana" />}
        >
          <TimeSeriesChart series={[freq.series]} from={from} to={to} zeroBaseline integerTicks height={72} ariaLabel={`Sesiones por semana de ${exercise.nameEs}`} />
        </ChartPanel>
      </section>
      {shown.length ? (
        <section aria-label="Récords" className="mt-7 space-y-3" data-testid="records-summary">
          <SectionHeader title="Récords" hint="Con la fecha en que se lograron" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {shown.map((rec) => {
              const v = recordValue(rec)
              return (
                <Metric
                  key={rec.id}
                  label={rec.label}
                  value={v.value}
                  unit={v.unit}
                  hint={
                    <>
                      <span className="block">{formatDateEs(rec.date)}</span>
                      {rec.id !== 'maxWeight' || rec.set.reps ? <span className="block truncate">{rec.id === 'e1rm' ? `Estimado, de ${setText(rec, t)}` : setText(rec, t)}</span> : null}
                    </>
                  }
                />
              )
            })}
            {bestVol && t === 'weight_reps' ? <Metric label="Volumen en una sesión" value={fmtNumber(bestVol.value, 0)} unit="kg" hint={formatDateEs(bestVol.date)} /> : null}
          </div>
        </section>
      ) : null}
    </>
  )
}

// ───────────── Historial ─────────────
function setLabel(kind: SetKind, n: number): { text: string; cls: string } {
  if (kind === 'warmup') return { text: 'C', cls: 'text-warn' }
  return { text: String(n), cls: 'text-muted' }
}

function HistoryTab({ sets, t, sessionById, onLeave }: { sets: ExerciseSet[]; t: TrackingType; sessionById: Map<string, TrainingSession>; onLeave?: () => void }) {
  const [shown, setShown] = useState(8)
  const sessions = useMemo(() => summarizeSessions(sets, t), [sets, t])
  const prs = useMemo(() => prsBySet(sets), [sets])
  const showE1rm = t === 'weight_reps' || t === 'bodyweight_reps'
  return (
    <div className="space-y-4">
      <ul className="space-y-6" data-testid="exercise-history">
        {sessions.slice(0, shown).map((ss) => {
          const meta = sessionById.get(ss.sessionId)
          const min = sessionMinutes(meta)
          let work = 0
          const head = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{meta?.name || 'Sesión'}</span>
                <span className="block truncate text-label text-muted">
                  {formatDateEs(ss.date, 'weekday')}
                  {min ? ` · ${min} min` : ''}
                </span>
              </span>
              {meta ? <Icon name="chevronRight" size={18} className="shrink-0 text-faint" /> : null}
            </>
          )
          return (
            <li key={ss.sessionId} data-testid="history-session">
              {meta ? (
                <Link to={`/entreno/sesion/${ss.sessionId}`} onClick={onLeave} className="flex min-h-[52px] items-center gap-3" data-testid="history-session-link">
                  {head}
                </Link>
              ) : (
                <div className="flex min-h-[52px] items-center gap-3">{head}</div>
              )}
              {meta?.notes ? <p className="mb-1 text-label text-muted">Nota: {meta.notes}</p> : null}
              <div className="flex items-center gap-2 px-2 text-micro text-muted">
                <span className="w-7 shrink-0">Serie</span>
                <span className="flex-1">Marca</span>
                {showE1rm ? <span>1RM est.</span> : null}
              </div>
              <ul>
                {ss.sets.map((s) => {
                  const kind = setKindOf(s)
                  if (kind === 'work') work++
                  const lab = setLabel(kind, work)
                  const best = ss.best?.id === s.id
                  const est = kind === 'work' && s.weight !== null && s.reps !== null ? e1rm(s.weight, s.reps) : null
                  const recs = prs.get(s.id) ?? []
                  return (
                    <li
                      key={s.id}
                      className={`flex min-h-[40px] items-center gap-2 rounded-lg px-2 ${best ? 'font-semibold' : ''} ${kind === 'warmup' ? 'text-muted' : ''}`}
                      style={best ? { backgroundColor: 'rgb(var(--train) / 0.12)' } : undefined}
                      data-testid="history-set"
                    >
                      <span className={`num w-7 shrink-0 text-label font-medium ${lab.cls}`}>
                        {lab.text}
                        {kind === 'warmup' ? <span className="sr-only"> calentamiento</span> : null}
                      </span>
                      <span className="num shrink-0 text-body">
                        {formatSet(s, t)}
                        {best ? <span className="sr-only"> mejor serie</span> : null}
                      </span>
                      {recs.length ? (
                        <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1 py-1" data-testid="set-records">
                          {recs.map((p) => (
                            <span key={p} title={PR_LABEL[p]} className="inline-flex items-center gap-0.5 rounded-full bg-warn/15 px-1.5 text-micro font-medium text-warn">
                              <Icon name="trophy" size={11} />
                              <span className="text-ink">{PR_SHORT[p]}</span>
                              <span className="sr-only"> récord: {PR_LABEL[p]}</span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {showE1rm ? <span className="num ml-auto w-14 shrink-0 text-right text-label text-muted">{est !== null ? `≈ ${formatNumber(est, 0)} kg` : '—'}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
      {sessions.length > shown ? (
        <button className="btn-secondary w-full" onClick={() => setShown((n) => n + 10)}>
          Mostrar más sesiones ({sessions.length - shown})
        </button>
      ) : null}
      <p className="text-label text-muted">
        C: calentamiento (no cuenta en volumen ni récords). Las marcas de récord indican que esa serie superó todo lo anterior. {showE1rm ? E1RM_NOTE : ''}
      </p>
    </div>
  )
}

// ───────────── Récords ─────────────
function RecordsTab({ sets, t, sessionById, onLeave }: { sets: ExerciseSet[]; t: TrackingType; sessionById: Map<string, TrainingSession>; onLeave?: () => void }) {
  const recs = useMemo(() => recordList(sets), [sets])
  const points = useMemo(() => sessionPoints(sets), [sets])
  const bestVol = useMemo(() => bestVolumeSession(points), [points])
  const reps = useMemo(() => (t === 'weight_reps' ? repRecords(sets) : []), [sets, t])
  const link = (sessionId: string, children: ReactNode) =>
    sessionById.has(sessionId) ? (
      <Link to={`/entreno/sesion/${sessionId}`} onClick={onLeave} className="underline-offset-2 hover:underline">
        {children}
      </Link>
    ) : (
      children
    )
  return (
    <div className="space-y-7">
      <section aria-label="Récords personales" className="space-y-1">
        <SectionHeader title="Récords personales" hint="Calentamientos y filas excluidas no cuentan" />
        <ul className="divide-rows" data-testid="exercise-records">
          {recs.map((rec) => {
            const v = recordValue(rec)
            return (
              <li key={rec.id} className="flex min-h-[56px] items-center justify-between gap-3 py-2" data-testid="record-row">
                <div className="min-w-0">
                  <div className="text-body font-medium">{rec.label}</div>
                  <div className="truncate text-label text-muted">
                    {link(rec.sessionId, <>{formatDateEs(rec.date)}</>)} · {rec.id === 'e1rm' ? `de ${setText(rec, t)} (estimado)` : setText(rec, t)}
                  </div>
                </div>
                <div className="readout shrink-0 text-title">
                  {v.value}
                  {v.unit ? <span className="ml-1 text-label font-medium tracking-normal text-muted">{v.unit}</span> : null}
                </div>
              </li>
            )
          })}
          {bestVol && t === 'weight_reps' ? (
            <li className="flex min-h-[56px] items-center justify-between gap-3 py-2" data-testid="record-row">
              <div className="min-w-0">
                <div className="text-body font-medium">Mayor volumen en una sesión</div>
                <div className="truncate text-label text-muted">{link(bestVol.sessionId, <>{formatDateEs(bestVol.date)}</>)}</div>
              </div>
              <div className="readout shrink-0 text-title">
                {fmtNumber(bestVol.value, 0)}
                <span className="ml-1 text-label font-medium tracking-normal text-muted">kg</span>
              </div>
            </li>
          ) : null}
        </ul>
        {recs.some((x) => x.id === 'e1rm') ? <p className="pt-2 text-label text-muted">{E1RM_NOTE}</p> : null}
      </section>
      {reps.length ? (
        <section aria-label="Récords por repeticiones" className="space-y-2">
          <SectionHeader title="Mejor peso por repeticiones" hint="Mayor peso levantado con ese número exacto de repeticiones" />
          <table className="w-full text-left text-body" data-testid="rep-records">
            <caption className="sr-only">Mejor peso por número de repeticiones</caption>
            <thead className="text-label text-muted">
              <tr>
                <th scope="col" className="h-10 font-medium">
                  Reps
                </th>
                <th scope="col" className="h-10 text-right font-medium">
                  Mejor peso
                </th>
                <th scope="col" className="h-10 text-right font-medium">
                  Fecha
                </th>
              </tr>
            </thead>
            <tbody className="divide-rows">
              {reps.map((x) => (
                <tr key={x.reps} className="h-12">
                  <th scope="row" className="num font-medium">
                    {x.orMore ? `10 o más${x.repsDone > 10 ? ` (${x.repsDone})` : ''}` : x.reps}
                  </th>
                  <td className="num text-right font-semibold">{formatNumber(x.weight, 2)} kg</td>
                  <td className="text-right text-label text-muted">{link(x.sessionId, <>{formatDateEs(x.date)}</>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  )
}

// ───────────── Técnica ─────────────
function TechniqueTab({ exercise, item, onOpen }: { exercise: Exercise; item: ExerciseMedia | undefined; onOpen: (e: Exercise) => void }) {
  const ex = useExercises()
  const labels = ex.labels
  const steps = exercise.instructionsEs.length ? exercise.instructionsEs : (item?.instructionsEs ?? [])
  const norm = (s: string) => s.trim().toLowerCase()
  const aliases = exercise.aliases.filter((a) => norm(a) !== norm(exercise.nameEs) && norm(a) !== norm(exercise.nameEn))
  const variants = useMemo(() => findVariants(exercise, ex.list, { labels }), [exercise, ex.list, labels])
  const subs = useMemo(() => rankSubstitutions(exercise, ex.list, { favorites: ex.favorites, limit: 10, labels }), [exercise, ex.list, ex.favorites, labels])
  return (
    <div className="space-y-7">
      <section aria-label="Instrucciones" className="space-y-2">
        <SectionHeader title="Instrucciones" />
        {steps.length ? (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-body text-muted" data-testid="exercise-instructions">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {!exercise.instructionsEs.length ? <p className="text-micro text-muted">Instrucciones: RepDB (repdb.co).</p> : null}
          </>
        ) : (
          <p className="text-body text-muted">Sin instrucciones.</p>
        )}
      </section>
      {exercise.nameEn || aliases.length ? (
        <section aria-label="Otros nombres" className="space-y-1">
          <SectionHeader title="También se conoce como" />
          <p className="text-body text-muted" data-testid="exercise-aliases">
            {[exercise.nameEn, ...aliases].filter(Boolean).join(' · ')}
          </p>
        </section>
      ) : null}
      <RelatedList title="Variantes" empty="No hay variantes de este movimiento en la biblioteca." items={variants} onOpen={onOpen} ex={ex} testId="exercise-variants" />
      <RelatedList title="Alternativas compatibles" empty="Sin sustitutos con el mismo músculo principal." items={subs} onOpen={onOpen} ex={ex} testId="exercise-substitutes" />
    </div>
  )
}

function RelatedList({
  title,
  empty,
  items,
  onOpen,
  ex,
  testId,
}: {
  title: string
  empty: string
  items: Related[]
  onOpen: (e: Exercise) => void
  ex: ReturnType<typeof useExercises>
  testId: string
}) {
  const media = useExerciseMedia()
  return (
    <section aria-label={title} className="space-y-1">
      <SectionHeader title={title} />
      {items.length ? (
        <ul className="divide-rows" data-testid={testId}>
          {items.map((rel) => {
            const e = rel.exercise as Exercise
            return (
              <li key={e.id}>
                <button className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left" onClick={() => onOpen(e)}>
                  <ExerciseThumb
                    media={media}
                    item={media?.items[e.id]}
                    exerciseId={e.id}
                    size={40}
                    exercise={e}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium">{e.nameEs}</div>
                    <div className="truncate text-label text-muted">{reasonText(rel)}</div>
                  </div>
                  {ex.favorites.has(e.id) ? <Icon name="star" size={14} className="fill-current text-warn" /> : null}
                  <Icon name="chevronRight" size={16} className="text-faint" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-body text-muted">{empty}</p>
      )}
    </section>
  )
}

// ───────────── full page (route /entreno/ejercicios/:id) ─────────────
export function ExerciseDetailPage() {
  const { id = '' } = useParams()
  const ex = useExercises()
  const nav = useNavigate()
  const exercise = ex.byId.get(id)
  if (!exercise) {
    return (
      <>
        <PageHeader title="Ejercicio" back="/entreno/ejercicios" />
        {ex.ready || ex.error ? (
          <EmptyState icon="alert" title="No encontramos este ejercicio">
            Puede que se haya eliminado o que el enlace sea antiguo. Búscalo en la biblioteca.
          </EmptyState>
        ) : (
          <Skeleton lines={4} label="Cargando ejercicio" />
        )}
      </>
    )
  }
  return (
    <>
      <PageHeader title={exercise.nameEs} back="/entreno/ejercicios" />
      <ExerciseDetail key={exercise.id} exercise={exercise} onOpen={(e) => nav(exercisePath(e.id))} onDeleted={() => nav('/entreno/ejercicios', { replace: true })} />
    </>
  )
}
