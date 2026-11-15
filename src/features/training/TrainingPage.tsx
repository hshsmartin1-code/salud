import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { uuid } from '../../db/repo'
import type { Routine, RoutineExercise } from '../../db/types'
import { addDays, formatDateEs, isoWeekStart, todayLocal } from '../../domain/dates'
import { sessionVolume } from '../../domain/training'
import { formatNumber } from '../../domain/units'
import { NumField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Card, EmptyState, PageHeader, Sheet } from '../../ui/kit'
import { ExercisePicker } from './ExerciseLibrary'
import { DEFAULT_REST, startSession } from './session'
import { formatDuration } from './sets'

export function TrainingPage() {
  const r = useRepo()
  const nav = useNavigate()
  const routines = useLiveQuery(() => r.all('routines'), [r])
  const sessions = useLiveQuery(() => r.latest('trainingSessions', 40), [r])
  const weekStart = isoWeekStart(todayLocal())
  const weekSets = useLiveQuery(() => r.range('exerciseSets', weekStart, addDays(weekStart, 6)), [r, weekStart])
  const active = (sessions ?? []).find((s) => s.status === 'active')
  const done = (sessions ?? []).filter((s) => s.status === 'done')
  const weekSessions = done.filter((s) => s.date >= weekStart).length
  const weekVolume = sessionVolume((weekSets ?? []).filter((s) => s.done))
  const setsBySession = useLiveQuery(async () => {
    const m = new Map<string, { n: number; volume: number }>()
    for (const s of done.slice(0, 15)) {
      const xs = (await r.byIndex('exerciseSets', 'sessionId', s.id)).filter((x) => x.done)
      m.set(s.id, { n: xs.length, volume: sessionVolume(xs) })
    }
    return m
  }, [r, done.map((s) => s.id).join()])

  async function start(routine?: Routine) {
    if (active && !confirm('Ya hay una sesión en curso. ¿Iniciar otra de todos modos?')) return
    const s = await startSession(r, { routine })
    nav(`/entreno/sesion/${s.id}`)
  }

  return (
    <>
      <PageHeader
        title="Entreno"
        actions={
          <Link to="/entreno/ejercicios" className="btn-secondary px-3">
            <Icon name="book" size={18} /> Ejercicios
          </Link>
        }
      />
      <div className="space-y-5">
        {active ? (
          <Link to={`/entreno/sesion/${active.id}`} className="card flex items-center gap-3 border-accent/40 p-4" data-testid="active-session">
            <span className="rounded-xl bg-accent/15 p-2 text-accent">
              <Icon name="play" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{active.name}</div>
              <div className="text-xs text-muted">Sesión en curso · {formatDateEs(active.date, 'weekday')}</div>
            </div>
            <Icon name="chevronRight" className="text-faint" />
          </Link>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <div className="text-xs text-muted">Sesiones esta semana</div>
            <div className="num mt-1 text-2xl font-bold">{weekSessions}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Volumen semanal</div>
            <div className="num mt-1 text-2xl font-bold">
              {formatNumber(weekVolume, 0)} <span className="text-sm font-medium text-muted">kg</span>
            </div>
          </Card>
        </div>

        <button className="btn-primary w-full py-3" onClick={() => void start()} data-testid="start-empty-session">
          <Icon name="play" size={18} /> Empezar entrenamiento libre
        </button>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Rutinas</h2>
            <Link to="/entreno/rutinas/nueva" className="btn-ghost px-2 py-1 text-sm" data-testid="new-routine">
              <Icon name="plus" size={16} /> Nueva
            </Link>
          </div>
          {routines && routines.filter((x) => !x.archived).length ? (
            <ul className="space-y-2">
              {routines
                .filter((x) => !x.archived)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((rt) => (
                  <li key={rt.id} className="card flex items-center gap-3 p-3">
                    <Link to={`/entreno/rutinas/${rt.id}`} className="min-w-0 flex-1">
                      <div className="font-medium">{rt.name}</div>
                      <div className="truncate text-xs text-muted">
                        {rt.exercises.length} ejercicios · {rt.exercises.map((e) => e.name).join(', ')}
                      </div>
                    </Link>
                    <button className="btn-secondary px-3" onClick={() => void start(rt)} data-testid="start-routine">
                      <Icon name="play" size={16} /> Iniciar
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
              Crea rutinas con tus ejercicios, series objetivo y descanso para iniciarlas con un toque.
            </p>
          )}
        </section>

        <section>
          <h2 className="section-title mb-2">Historial</h2>
          {done.length ? (
            <ul className="card divide-y divide-line overflow-hidden">
              {done.map((s) => {
                const st = setsBySession?.get(s.id)
                return (
                  <li key={s.id}>
                    <Link to={`/entreno/sesion/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface2/60">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted">
                          {formatDateEs(s.date, 'weekday')}
                          {s.durationMin ? ` · ${formatDuration(s.durationMin * 60)}` : ''}
                          {st ? ` · ${st.n} series · ${formatNumber(st.volume, 0)} kg` : ''}
                        </div>
                      </div>
                      {s.origin === 'phase0' ? <Badge>Importado</Badge> : null}
                      <Icon name="chevronRight" size={18} className="text-faint" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon="dumbbell" title="Sin sesiones">
              Tus entrenamientos terminados aparecerán aquí.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  )
}

export function RoutineEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'nueva'
  const r = useRepo()
  const nav = useNavigate()
  const existing = useLiveQuery(() => (isNew ? undefined : r.get('routines', id as string)), [r, id])
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RoutineExercise[]>([])
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setNotes(existing.notes ?? '')
    setItems(existing.exercises)
  }, [existing])

  const canSave = name.trim().length > 0 && items.length > 0
  async function save() {
    if (!canSave) return
    const data = { name: name.trim(), notes, exercises: items }
    if (existing) await r.put('routines', { ...existing, ...data })
    else await r.add('routines', data)
    nav('/entreno')
  }
  function patch(key: string, p: Partial<RoutineExercise>) {
    setItems((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)))
  }
  function move(i: number, d: -1 | 1) {
    setItems((s) => {
      const o = s.slice()
      const j = i + d
      if (j < 0 || j >= o.length) return s
      ;[o[i], o[j]] = [o[j]!, o[i]!]
      return o
    })
  }

  return (
    <>
      <PageHeader title={isNew ? 'Nueva rutina' : 'Rutina'} back="/entreno" />
      <div className="space-y-4">
        <Card className="space-y-3">
          <TextField label="Nombre" value={name} onChange={setName} autoFocus={isNew} placeholder="p. ej. Pierna A" />
          <TextArea label="Notas" value={notes} onChange={setNotes} />
        </Card>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Ejercicios</h2>
            <button className="btn-secondary px-3 py-2" onClick={() => setPicker(true)} data-testid="routine-add-exercise">
              <Icon name="plus" size={16} /> Ejercicio
            </button>
          </div>
          {items.length ? (
            <ul className="space-y-2">
              {items.map((it, i) => (
                <li key={it.key} className="card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                    <button className="btn-ghost p-1" aria-label="Subir" onClick={() => move(i, -1)} disabled={i === 0}>
                      <Icon name="chevronUp" size={16} />
                    </button>
                    <button className="btn-ghost p-1" aria-label="Bajar" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                      <Icon name="chevronDown" size={16} />
                    </button>
                    <button className="btn-ghost p-1" aria-label="Quitar" onClick={() => setItems((s) => s.filter((x) => x.key !== it.key))}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumField compact label="Series" value={numStr(it.targetSets, 0)} onChange={(v) => patch(it.key, { targetSets: Math.max(1, Math.round(toNum(v) ?? 1)) })} />
                    <TextField label="Reps" value={it.targetReps} onChange={(v) => patch(it.key, { targetReps: v })} placeholder="8-12" />
                    <NumField compact label="Descanso" unit="s" value={numStr(it.restSec, 0)} onChange={(v) => patch(it.key, { restSec: Math.max(0, Math.round(toNum(v) ?? 0)) })} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Agrega ejercicios desde la biblioteca.</p>
          )}
        </div>
        <button className="btn-primary w-full" disabled={!canSave} onClick={() => void save()} data-testid="save-routine">
          Guardar rutina
        </button>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar esta rutina? Las sesiones hechas se conservan.')) return
              await r.remove('routines', existing.id)
              nav('/entreno')
            }}
          >
            <Icon name="trash" size={16} /> Eliminar rutina
          </button>
        ) : null}
      </div>
      <Sheet open={picker} onClose={() => setPicker(false)} title="Agregar a la rutina" wide>
        <ExercisePicker
          selectedIds={items.map((i) => i.exerciseId)}
          onSelect={(e) => {
            if (!items.some((i) => i.exerciseId === e.id)) {
              setItems((s) => [
                ...s,
                { key: uuid(), exerciseId: e.id, name: e.nameEs, trackingType: e.trackingType, targetSets: 3, targetReps: e.trackingType === 'time' ? '30-60 s' : '8-12', restSec: DEFAULT_REST[e.trackingType] },
              ])
            }
            setPicker(false)
          }}
        />
      </Sheet>
    </>
  )
}
