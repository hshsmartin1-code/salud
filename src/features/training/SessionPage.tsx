import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import type { TrackingType } from '../../db/catalogTypes'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { formatDateEs } from '../../domain/dates'
import { sessionVolume } from '../../domain/training'
import { formatNumber, parseDecimal } from '../../domain/units'
import { numStr } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, EmptyState, PageHeader, Sheet } from '../../ui/kit'
import { ExerciseDetailSheet, ExercisePicker } from './ExerciseLibrary'
import { ExerciseThumb, useExerciseMedia } from './exerciseMedia'
import { useExercises, type Exercise } from './exercises'
import { addPendingSets, deleteSession, DEFAULT_REST, finishSession, lastPerformance } from './session'
import { formatDuration, formatSet, PR_LABEL, prsBySet } from './sets'

type OrderItem = TrainingSession['exerciseOrder'][number]

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** "90" → 90 s (or min when plain='min'); "1:30" → 90 s; "1:02:03" → 3723 s. */
export function parseDuration(s: string, plain: 'sec' | 'min' = 'sec'): number | null {
  const t = s.trim()
  if (!t) return null
  if (t.includes(':')) {
    const parts = t.split(':').map((p) => Number(p))
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null
    return parts.reduce((a, p) => a * 60 + p, 0)
  }
  const n = parseDecimal(t)
  if (n === null || n < 0) return null
  return Math.round(plain === 'min' ? n * 60 : n)
}

export function SessionPage() {
  const { id } = useParams()
  const r = useRepo()
  const nav = useNavigate()
  const ex = useExercises()
  const session = useLiveQuery(() => r.get('trainingSessions', id ?? ''), [r, id])
  const sets = useLiveQuery(() => r.byIndex('exerciseSets', 'sessionId', id ?? ''), [r, id])
  const exerciseIds = session?.exerciseOrder.map((o) => o.exerciseId).join('|') ?? ''
  const history = useLiveQuery(async () => {
    const m = new Map<string, ExerciseSet[]>()
    for (const eid of exerciseIds.split('|').filter(Boolean)) m.set(eid, await r.byProfileIndex('exerciseSets', 'exerciseId', eid))
    return m
  }, [r, exerciseIds, sets?.length, sets?.filter((s) => s.done).length])
  const [picker, setPicker] = useState(false)
  const [detail, setDetail] = useState<Exercise | null>(null)
  const now = useNow(1000)

  const prs = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const [, hs] of history ?? []) for (const [sid, types] of prsBySet(hs)) out.set(sid, types.map((t) => PR_LABEL[t]))
    return out
  }, [history])

  if (session === undefined || sets === undefined) return null
  if (!session) {
    return (
      <>
        <PageHeader title="Sesión" back="/entreno" />
        <EmptyState icon="dumbbell" title="Sesión no encontrada" />
      </>
    )
  }
  const s = session
  const active = s.status === 'active'
  const doneSets = sets.filter((x) => x.done)
  const volume = sessionVolume(doneSets)
  const elapsed = s.startedAt ? (active ? now : s.endedAt ? new Date(s.endedAt).getTime() : now) - new Date(s.startedAt).getTime() : null
  const prCount = doneSets.filter((x) => s.id === x.sessionId && prs.has(x.id)).length

  async function addExercise(e: Exercise) {
    if (s.exerciseOrder.some((o) => o.exerciseId === e.id)) {
      setPicker(false)
      return
    }
    const item: OrderItem = { exerciseId: e.id, name: e.nameEs, trackingType: e.trackingType, restSec: DEFAULT_REST[e.trackingType] }
    const order = [...s.exerciseOrder, item]
    await r.update('trainingSessions', s.id, { exerciseOrder: order })
    const prev = await lastPerformance(r, e.id, s.date, s.id)
    await addPendingSets(r, { ...s, exerciseOrder: order }, item, Math.max(1, prev.filter((p) => !p.isWarmup).length))
    setPicker(false)
  }

  async function moveExercise(i: number, d: -1 | 1) {
    const order = s.exerciseOrder.slice()
    const j = i + d
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    await r.update('trainingSessions', s.id, { exerciseOrder: order })
  }

  async function removeExercise(item: OrderItem) {
    const mine = sets!.filter((x) => x.exerciseId === item.exerciseId)
    if (mine.some((x) => x.done) && !confirm(`¿Quitar ${item.name} y sus series registradas de esta sesión?`)) return
    await r.removeMany('exerciseSets', mine.map((x) => x.id))
    await r.update('trainingSessions', s.id, { exerciseOrder: s.exerciseOrder.filter((o) => o.exerciseId !== item.exerciseId) })
  }

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={`${formatDateEs(s.date, 'weekday')}${active ? ' · en curso' : ''}`}
        back="/entreno"
        actions={
          active ? (
            <button
              className="btn-primary px-3"
              data-testid="finish-session"
              onClick={async () => {
                const pending = sets!.filter((x) => !x.done).length
                if (pending && !confirm(`Hay ${pending} series sin marcar como hechas; se descartarán. ¿Terminar la sesión?`)) return
                await finishSession(r, s)
              }}
            >
              <Icon name="check" size={18} /> Terminar
            </button>
          ) : null
        }
      />

      <div className="card mb-4 grid grid-cols-3 divide-x divide-line">
        <div className="p-3.5">
          <div className="text-[13px] text-muted">Duración</div>
          <div className="readout mt-1.5 text-[26px]">{elapsed !== null ? formatDuration(elapsed / 1000) : s.durationMin ? `${s.durationMin} min` : '—'}</div>
        </div>
        <div className="p-3.5">
          <div className="text-[13px] text-muted">Volumen, kg</div>
          <div className="readout mt-1.5 text-[26px]" data-testid="session-volume">
            {formatNumber(volume, 0)}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[13px] text-muted">Series hechas</div>
          <div className="readout mt-1.5 text-[26px]">
            {doneSets.length}
            {prCount ? <span className="ml-1.5 text-sm tracking-normal text-warn [font-stretch:100%]">{prCount} PR</span> : null}
          </div>
        </div>
      </div>

      {active ? <RestTimer session={s} now={now} /> : null}

      <div className="space-y-3">
        {s.exerciseOrder.length === 0 ? (
          <EmptyState icon="dumbbell" title="Sesión vacía">
            Agrega ejercicios y registra cada serie al terminarla.
          </EmptyState>
        ) : null}
        {s.exerciseOrder.map((item, i) => (
          <ExerciseBlock
            key={item.exerciseId}
            session={s}
            item={item}
            sets={sets.filter((x) => x.exerciseId === item.exerciseId).sort((a, b) => a.setIndex - b.setIndex)}
            prs={prs}
            onInfo={() => {
              const e = ex.byId.get(item.exerciseId)
              if (e) setDetail(e)
            }}
            onUp={i > 0 ? () => void moveExercise(i, -1) : undefined}
            onDown={i < s.exerciseOrder.length - 1 ? () => void moveExercise(i, 1) : undefined}
            onRemove={() => void removeExercise(item)}
          />
        ))}
        <button className="btn-secondary w-full" onClick={() => setPicker(true)} data-testid="add-exercise">
          <Icon name="plus" size={18} /> Agregar ejercicio
        </button>
        {!active ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar esta sesión y todas sus series?')) return
              await deleteSession(r, s)
              nav('/entreno')
            }}
          >
            <Icon name="trash" size={16} /> Eliminar sesión
          </button>
        ) : null}
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Agregar ejercicio" wide>
        <ExercisePicker onSelect={(e) => void addExercise(e)} selectedIds={s.exerciseOrder.map((o) => o.exerciseId)} />
      </Sheet>
      <ExerciseDetailSheet exercise={detail} onClose={() => setDetail(null)} />
    </>
  )
}

function RestTimer({ session, now }: { session: TrainingSession; now: number }) {
  const r = useRepo()
  const left = session.restEndsAt ? Math.ceil((session.restEndsAt - now) / 1000) : null
  const buzzed = useRef<number | null>(null)
  // Longest remaining time seen for the current timer, used to draw the depleting bar.
  const maxLeft = useRef(0)
  const timerKey = useRef<number | null>(null)
  if (timerKey.current !== session.restEndsAt) {
    const prevEnd = timerKey.current
    timerKey.current = session.restEndsAt
    // A new timer (not a ±15 s nudge) restarts the bar.
    if (prevEnd === null || session.restEndsAt === null || Math.abs(session.restEndsAt - prevEnd) > 16000) maxLeft.current = 0
  }
  useEffect(() => {
    if (left !== null && left <= 0 && session.restEndsAt && buzzed.current !== session.restEndsAt) {
      buzzed.current = session.restEndsAt
      try {
        navigator.vibrate?.([200, 100, 200])
      } catch {
        /* not supported */
      }
    }
  }, [left, session.restEndsAt])
  if (left !== null && left > maxLeft.current) maxLeft.current = left
  if (left === null || left < -30) return null
  const over = left <= 0
  const total = maxLeft.current
  return (
    <div
      className={`sticky top-[4.25rem] z-20 mb-3 overflow-hidden rounded-2xl border shadow-pop lg:top-3 ${over ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
      role="timer"
      aria-live="polite"
      data-testid="rest-timer"
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Icon name="timer" size={20} className={over ? '' : 'text-muted'} />
        <div className="flex-1">
          <div className={`text-[13px] ${over ? '' : 'text-muted'}`}>{over ? 'Descanso terminado' : 'Descanso'}</div>
          <div className="readout text-[30px]">{over ? 'Siguiente serie' : formatDuration(left)}</div>
        </div>
      {!over ? (
        <>
          <button className="btn-secondary num min-h-[36px] px-2.5 py-1 text-sm" aria-label="Restar 15 segundos" onClick={() => void r.update('trainingSessions', session.id, { restEndsAt: (session.restEndsAt ?? Date.now()) - 15000 })}>
            −15
          </button>
          <button className="btn-secondary num min-h-[36px] px-2.5 py-1 text-sm" aria-label="Sumar 15 segundos" onClick={() => void r.update('trainingSessions', session.id, { restEndsAt: (session.restEndsAt ?? Date.now()) + 15000 })}>
            +15
          </button>
        </>
      ) : null}
        <button className={`btn-ghost p-1.5 ${over ? 'text-accent-ink hover:bg-black/10 hover:text-accent-ink' : ''}`} aria-label="Cerrar temporizador" onClick={() => void r.update('trainingSessions', session.id, { restEndsAt: null })}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {!over && total > 0 ? (
        <div className="h-1 bg-surface2">
          <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function ExerciseBlock({
  session,
  item,
  sets,
  prs,
  onInfo,
  onUp,
  onDown,
  onRemove,
}: {
  session: TrainingSession
  item: OrderItem
  sets: ExerciseSet[]
  prs: Map<string, string[]>
  onInfo: () => void
  onUp?: () => void
  onDown?: () => void
  onRemove: () => void
}) {
  const r = useRepo()
  const media = useExerciseMedia()
  const [menu, setMenu] = useState(false)
  const prev = useLiveQuery(() => lastPerformance(r, item.exerciseId, session.date, session.id), [r, item.exerciseId, session.date, session.id])
  const t = item.trackingType
  const cols = COLS[t]
  return (
    <section className="card overflow-hidden" data-testid="exercise-block">
      <div className="flex items-start gap-2 px-4 pb-2 pt-3">
        <button type="button" className="mt-0.5 shrink-0" onClick={onInfo} aria-label={`Ver ${item.name}`} tabIndex={-1}>
          <ExerciseThumb media={media} item={media?.items[item.exerciseId]} size={40} />
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={onInfo}>
          <h3 className="truncate font-semibold">{item.name}</h3>
          <p className="truncate text-xs text-muted">
            {prev && prev.length ? `Anterior: ${prev.map((p) => formatSet(p, t)).join(' · ')}` : 'Sin registro anterior'}
          </p>
        </button>
        <button className="btn-ghost p-1.5" aria-label="Opciones del ejercicio" onClick={() => setMenu((v) => !v)}>
          <Icon name="dots" size={18} />
        </button>
      </div>
      {menu ? (
        <div className="flex flex-wrap gap-2 border-y border-line bg-surface2/50 px-4 py-2 text-sm">
          {onUp ? (
            <button className="chip" onClick={onUp}>
              <Icon name="chevronUp" size={14} /> Subir
            </button>
          ) : null}
          {onDown ? (
            <button className="chip" onClick={onDown}>
              <Icon name="chevronDown" size={14} /> Bajar
            </button>
          ) : null}
          <label className="chip">
            Descanso
            <select
              className="bg-transparent"
              value={item.restSec}
              onChange={(e) =>
                void r.update('trainingSessions', session.id, {
                  exerciseOrder: session.exerciseOrder.map((o) => (o.exerciseId === item.exerciseId ? { ...o, restSec: Number(e.target.value) } : o)),
                })
              }
            >
              {[0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((v) => (
                <option key={v} value={v}>
                  {v ? formatDuration(v) : 'sin'}
                </option>
              ))}
            </select>
          </label>
          {sets.length ? (
            <button
              className="chip"
              onClick={() => {
                const last = sets[sets.length - 1]!
                if (!last.done || confirm('¿Eliminar la última serie registrada?')) void r.remove('exerciseSets', last.id)
              }}
            >
              <Icon name="minus" size={14} /> Quitar última serie
            </button>
          ) : null}
          <button className="chip text-bad" onClick={onRemove}>
            <Icon name="trash" size={14} /> Quitar
          </button>
        </div>
      ) : null}
      <div className="px-2 pb-2">
        <div className="grid grid-cols-[2.25rem_1fr_1fr_3rem] items-center gap-2 px-2 pb-1 text-xs font-medium text-faint">
          <span>Serie</span>
          <span>{cols[0]}</span>
          <span>{cols[1]}</span>
          <span className="text-center">Hecha</span>
        </div>
        {sets.map((st, i) => (
          <SetRow key={st.id} set={st} next={sets[i + 1]} n={sets.slice(0, i + 1).filter((x) => !x.isWarmup).length} tracking={t} session={session} restSec={item.restSec} prs={prs.get(st.id)} />
        ))}
        <button
          className="btn-ghost mt-1 w-full py-1.5 text-sm"
          onClick={() => void addPendingSets(r, session, item, 1)}
          data-testid="add-set"
        >
          <Icon name="plus" size={16} /> Serie
        </button>
      </div>
    </section>
  )
}

const COLS: Record<TrackingType, [string, string]> = {
  weight_reps: ['kg', 'Reps'],
  bodyweight_reps: ['+kg', 'Reps'],
  time: ['Tiempo', '—'],
  distance: ['km', 'Tiempo'],
}

function SetRow({
  set,
  next,
  n,
  tracking,
  session,
  restSec,
  prs,
}: {
  set: ExerciseSet
  next?: ExerciseSet
  n: number
  tracking: TrackingType
  session: TrainingSession
  restSec: number
  prs?: string[]
}) {
  const r = useRepo()
  const nextSet = next
  const init = (): [string, string] => {
    switch (tracking) {
      case 'weight_reps':
      case 'bodyweight_reps':
        return [numStr(set.weight, 2), numStr(set.reps, 0)]
      case 'time':
        return [set.durationSec !== null ? formatDuration(set.durationSec) : '', '']
      case 'distance':
        return [set.distanceM !== null ? numStr(set.distanceM / 1000, 3) : '', set.durationSec !== null ? formatDuration(set.durationSec) : '']
    }
  }
  const [a, setA] = useState(init()[0])
  const [b, setB] = useState(init()[1])
  // Values this row wrote itself; echoes of our own saves must not overwrite what is being typed.
  const lastSaved = useRef<string | null>(null)
  const stored = JSON.stringify([set.weight, set.reps, set.durationSec, set.distanceM])
  useEffect(() => {
    if (lastSaved.current === stored) return
    const [x, y] = init()
    setA(x)
    setB(y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  function parsed(): Partial<ExerciseSet> | null {
    switch (tracking) {
      case 'weight_reps':
      case 'bodyweight_reps': {
        const w = a.trim() ? parseDecimal(a) : null
        const rp = b.trim() ? parseDecimal(b) : null
        if ((a.trim() && w === null) || (b.trim() && (rp === null || !Number.isInteger(rp)))) return null
        return { weight: w, reps: rp }
      }
      case 'time': {
        const d = parseDuration(a, 'sec')
        if (a.trim() && d === null) return null
        return { durationSec: d }
      }
      case 'distance': {
        const km = a.trim() ? parseDecimal(a) : null
        const d = parseDuration(b, 'min')
        if ((a.trim() && km === null) || (b.trim() && d === null)) return null
        return { distanceM: km !== null ? Math.round(km * 1000) : null, durationSec: d }
      }
    }
  }
  const p = parsed()
  const invalid = p === null
  const canComplete =
    !!p &&
    (tracking === 'weight_reps' ? p.weight != null && p.reps != null : tracking === 'bodyweight_reps' ? p.reps != null : tracking === 'time' ? p.durationSec != null : p.distanceM != null || p.durationSec != null)

  function remember(v: Partial<ExerciseSet>) {
    const pick = <K extends 'weight' | 'reps' | 'durationSec' | 'distanceM'>(k: K) => (k in v ? (v[k] ?? null) : set[k])
    lastSaved.current = JSON.stringify([pick('weight'), pick('reps'), pick('durationSec'), pick('distanceM')])
  }
  async function save() {
    if (!p) return
    remember(p)
    await r.update('exerciseSets', set.id, p)
  }
  async function toggleDone() {
    if (!set.done && !canComplete) return
    const next = !set.done
    if (p) remember(p)
    await r.update('exerciseSets', set.id, { ...(p ?? {}), done: next })
    const following = nextSet
    if (next && p && following && !following.done && following.weight === null && following.reps === null && following.durationSec === null && following.distanceM === null) {
      await r.update('exerciseSets', following.id, p)
    }
    if (next && session.status === 'active' && restSec > 0 && !set.isWarmup) {
      await r.update('trainingSessions', session.id, { restEndsAt: Date.now() + restSec * 1000 })
    }
  }

  const inputCls = `field num h-11 px-2 text-center text-base font-semibold ${invalid ? 'border-bad' : ''} ${set.done ? 'border-transparent bg-transparent' : ''}`
  return (
    <div className={`grid grid-cols-[2.25rem_1fr_1fr_3rem] items-center gap-2 rounded-xl px-2 py-1 transition-colors ${set.done ? 'bg-accent/10' : ''}`} data-testid="set-row">
      <button
        className={`num text-center text-sm font-semibold ${set.isWarmup ? 'text-warn' : 'text-muted'}`}
        title="Tocar para marcar como calentamiento; mantener para eliminar"
        aria-label={set.isWarmup ? 'Calentamiento' : `Serie ${n}`}
        onClick={() => void r.update('exerciseSets', set.id, { isWarmup: !set.isWarmup })}
        onContextMenu={(e) => {
          e.preventDefault()
          if (confirm('¿Eliminar esta serie?')) void r.remove('exerciseSets', set.id)
        }}
      >
        {set.isWarmup ? 'C' : n}
      </button>
      <input className={inputCls} inputMode={tracking === 'time' ? 'text' : 'decimal'} value={a} onChange={(e) => setA(e.target.value)} onBlur={() => void save()} aria-label={COLS[tracking][0]} placeholder={tracking === 'time' ? 'm:ss' : '—'} />
      {tracking === 'time' ? (
        <span className="text-center text-xs text-faint">{prs?.length ? <PrBadge prs={prs} /> : ''}</span>
      ) : (
        <div className="relative">
          <input className={inputCls + ' w-full'} inputMode={tracking === 'distance' ? 'text' : 'numeric'} value={b} onChange={(e) => setB(e.target.value)} onBlur={() => void save()} aria-label={COLS[tracking][1]} placeholder={tracking === 'distance' ? 'm:ss' : '—'} />
          {prs?.length ? (
            <span className="absolute -right-1 -top-2">
              <PrBadge prs={prs} />
            </span>
          ) : null}
        </div>
      )}
      <div className="flex items-center justify-center gap-0.5">
        <button
          className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 transition-colors ${set.done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-faint hover:border-ink hover:text-ink'} disabled:opacity-40`}
          aria-label={set.done ? 'Marcar como no hecha' : 'Marcar serie como hecha'}
          aria-pressed={set.done}
          disabled={!set.done && !canComplete}
          onClick={() => void toggleDone()}
          data-testid="set-done"
        >
          <Icon name="check" size={20} className={set.done ? 'anim-pop' : ''} />
        </button>
      </div>
    </div>
  )
}

function PrBadge({ prs }: { prs: string[] }) {
  return (
    <span title={prs.join(', ')} data-testid="pr-badge">
      <Badge tone="warn">
        <Icon name="trophy" size={12} /> PR
      </Badge>
    </span>
  )
}
