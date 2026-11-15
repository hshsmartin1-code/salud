import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { TrackingType } from '../../db/catalogTypes'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { SelectField, TextArea, TextField } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, EmptyState, PageHeader, Segmented, Sheet } from '../../ui/kit'
import { filterExercises, muscleList, TRACKING_LABEL, useExercises, type Exercise, type ExerciseFilter } from './exercises'
import { bestE1rm, formatSet } from './sets'

const EMPTY: ExerciseFilter = { q: '', muscle: '', equipment: '', category: '' }

/** Search + filters over catalog and custom exercises. */
export function ExercisePicker({ onSelect, selectedIds = [] }: { onSelect: (e: Exercise) => void; selectedIds?: string[] }) {
  const ex = useExercises()
  const [f, setF] = useState<ExerciseFilter>(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const results = useMemo(() => filterExercises(ex.list, f), [ex.list, f])
  const opts = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const active = [f.muscle, f.equipment, f.category].filter(Boolean).length
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="field pl-10"
            type="search"
            placeholder="Buscar ejercicio (sentadilla, press, remo…)"
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            data-testid="exercise-search"
            aria-label="Buscar ejercicio"
          />
        </div>
        <button className={`btn-secondary px-3 ${active ? 'text-accent' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-label="Filtros">
          <Icon name="filter" size={18} />
          {active ? <span className="num text-xs">{active}</span> : null}
        </button>
      </div>
      {showFilters ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SelectField label="Músculo" value={f.muscle} onChange={(v) => setF({ ...f, muscle: v })} options={opts(ex.labels.muscles)} placeholder="Todos" />
          <SelectField label="Equipo" value={f.equipment} onChange={(v) => setF({ ...f, equipment: v })} options={opts(ex.labels.equipment)} placeholder="Todos" />
          <SelectField label="Tipo" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={opts(ex.labels.category)} placeholder="Todos" />
        </div>
      ) : null}
      {!ex.ready ? (
        <p className="py-6 text-center text-sm text-muted">{ex.error ? `No se pudo cargar el catálogo: ${ex.error}` : 'Cargando ejercicios…'}</p>
      ) : results.length ? (
        <ul className="card divide-y divide-line overflow-hidden" data-testid="exercise-results">
          {results.map((e) => {
            const sel = selectedIds.includes(e.id)
            return (
              <li key={e.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface2/60" onClick={() => onSelect(e)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{e.nameEs}</div>
                    <div className="truncate text-xs text-muted">
                      {muscleList(e, ex.labels) || '—'}
                      {e.equipment ? ` · ${ex.labels.equipment[e.equipment] ?? e.equipment}` : ''}
                    </div>
                  </div>
                  {e.custom ? <Badge tone="accent">Mío</Badge> : null}
                  {sel ? <Icon name="check" size={18} className="text-accent" /> : <Icon name="plus" size={18} className="text-faint" />}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted">Sin resultados.</p>
      )}
      <button className="btn-ghost w-full text-sm" onClick={() => setCreateOpen(true)}>
        <Icon name="plus" size={16} /> Crear ejercicio propio
      </button>
      <CustomExerciseSheet open={createOpen} onClose={() => setCreateOpen(false)} initialName={f.q} labels={ex.labels} />
    </div>
  )
}

function CustomExerciseSheet({
  open,
  onClose,
  initialName,
  labels,
}: {
  open: boolean
  onClose: () => void
  initialName: string
  labels: ReturnType<typeof useExercises>['labels']
}) {
  const r = useRepo()
  const [name, setName] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [tracking, setTracking] = useState<TrackingType>('weight_reps')
  const [notes, setNotes] = useState('')
  const opts = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const shownName = name || initialName
  return (
    <Sheet open={open} onClose={onClose} title="Ejercicio propio">
      <div className="space-y-3 pb-2">
        <TextField label="Nombre" value={shownName} onChange={setName} autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Músculo principal" value={muscle} onChange={setMuscle} options={opts(labels.muscles)} placeholder="—" />
          <SelectField label="Equipo" value={equipment} onChange={setEquipment} options={opts(labels.equipment)} placeholder="—" />
        </div>
        <SelectField<TrackingType>
          label="Se registra como"
          value={tracking}
          onChange={setTracking}
          options={(Object.keys(TRACKING_LABEL) as TrackingType[]).map((k) => ({ value: k, label: TRACKING_LABEL[k] }))}
        />
        <TextArea label="Notas o instrucciones" value={notes} onChange={setNotes} />
        <button
          className="btn-primary w-full"
          disabled={!shownName.trim()}
          onClick={async () => {
            await r.add('customExercises', {
              nameEs: shownName.trim(),
              aliases: [],
              primaryMuscles: muscle ? [muscle] : [],
              secondaryMuscles: [],
              equipment: equipment || null,
              category: tracking === 'time' || tracking === 'distance' ? 'cardio' : 'strength',
              trackingType: tracking,
              instructionsEs: notes.trim() ? [notes.trim()] : [],
            })
            setName('')
            setNotes('')
            onClose()
          }}
        >
          Guardar ejercicio
        </button>
      </div>
    </Sheet>
  )
}

/** Exercise info + this profile's own history with it. */
export function ExerciseDetailSheet({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  const r = useRepo()
  const ex = useExercises()
  const [tab, setTab] = useState<'info' | 'hist'>('hist')
  const sets = useLiveQuery(
    () => (exercise ? r.byProfileIndex('exerciseSets', 'exerciseId', exercise.id) : Promise.resolve([])),
    [r, exercise?.id],
  )
  const done = (sets ?? []).filter((s) => s.done)
  const bySession = new Map<string, typeof done>()
  for (const s of done) bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s])
  const sessions = [...bySession.values()].sort((a, b) => (b[0]!.date < a[0]!.date ? -1 : 1)).slice(0, 8)
  const best = bestE1rm(done)
  const maxW = done.reduce<number | null>((m, s) => (s.weight !== null && !s.isWarmup && (m === null || s.weight > m) ? s.weight : m), null)
  const custom = exercise?.custom
  return (
    <Sheet open={!!exercise} onClose={onClose} title={exercise?.nameEs} wide>
      {exercise ? (
        <div className="space-y-3 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {exercise.primaryMuscles.map((m) => (
              <Badge key={m} tone="accent">
                {ex.labels.muscles[m] ?? m}
              </Badge>
            ))}
            {exercise.secondaryMuscles.map((m) => (
              <Badge key={m}>{ex.labels.muscles[m] ?? m}</Badge>
            ))}
            {exercise.equipment ? <Badge>{ex.labels.equipment[exercise.equipment] ?? exercise.equipment}</Badge> : null}
            <Badge>{TRACKING_LABEL[exercise.trackingType]}</Badge>
          </div>
          <Segmented<'info' | 'hist'>
            value={tab}
            onChange={setTab}
            size="sm"
            options={[
              { value: 'hist', label: 'Mi historial' },
              { value: 'info', label: 'Instrucciones' },
            ]}
          />
          {tab === 'info' ? (
            exercise.instructionsEs.length ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
                {exercise.instructionsEs.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">Sin instrucciones.</p>
            )
          ) : sessions.length ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-surface2 p-2">
                  <div className="num text-lg font-semibold">{best !== null ? formatNumber(best, 1) : '—'}</div>
                  <div className="text-[11px] text-muted">1RM estimado (Epley), kg</div>
                </div>
                <div className="rounded-xl bg-surface2 p-2">
                  <div className="num text-lg font-semibold">{maxW !== null ? formatNumber(maxW, 2) : '—'}</div>
                  <div className="text-[11px] text-muted">Peso máximo, kg</div>
                </div>
              </div>
              <ul className="space-y-2">
                {sessions.map((ss) => (
                  <li key={ss[0]!.sessionId} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <div className="text-xs font-medium text-muted">{formatDateEs(ss[0]!.date, 'weekday')}</div>
                    <div className="num mt-0.5">
                      {ss
                        .sort((a, b) => a.setIndex - b.setIndex)
                        .map((s) => (s.isWarmup ? `(${formatSet(s, exercise.trackingType)})` : formatSet(s, exercise.trackingType)))
                        .join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">Aún no has registrado este ejercicio.</p>
          )}
          {custom ? (
            <button
              className="btn-danger w-full"
              onClick={async () => {
                if (!confirm('¿Eliminar este ejercicio propio? Las series registradas se conservan.')) return
                await r.remove('customExercises', exercise.id.replace(/^custom:/, ''))
                onClose()
              }}
            >
              <Icon name="trash" size={16} /> Eliminar ejercicio
            </button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

export function ExerciseLibraryPage() {
  const ex = useExercises()
  const [detail, setDetail] = useState<Exercise | null>(null)
  return (
    <>
      <PageHeader title="Ejercicios" subtitle={ex.ready ? `${ex.list.length} en la biblioteca` : undefined} back="/entreno" />
      {ex.error && !ex.ready ? (
        <EmptyState icon="alert" title="Catálogo no disponible">
          {ex.error}
        </EmptyState>
      ) : (
        <ExercisePicker onSelect={setDetail} />
      )}
      <ExerciseDetailSheet exercise={detail} onClose={() => setDetail(null)} />
    </>
  )
}
