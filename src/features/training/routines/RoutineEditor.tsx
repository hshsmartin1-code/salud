import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../../app/profile'
import { uuid } from '../../../db/repo'
import type { RoutineExercise } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { Skeleton } from '../../../ui/Skeleton'
import { useToast } from '../../../ui/Toast'
import { TextArea, TextField } from '../../../ui/fields'
import { PageHeader, Sheet } from '../../../ui/kit'
import { useExercises } from '../exercises'
import { ExercisePicker } from '../ExerciseLibrary'
import { useExerciseMedia } from '../exerciseMedia'
import {
  buildRoutine,
  draftFromRoutine,
  duplicateItem,
  hasManualOrder,
  insertItem,
  isDirty,
  moveItem,
  newExerciseItem,
  orderAfter,
  patchExercise,
  patchFromDraft,
  removeItem,
  sortRoutines,
  type ExercisePatch,
  type RoutineDraft,
} from '../routines'
import { DEFAULT_REST } from '../session'
import { DockBar } from '../shared/DockBar'
import { plural } from '../routines'
import { ExerciseBlock } from './ExerciseBlock'
import { useLeaveGuard } from './useLeaveGuard'

const EMPTY: RoutineDraft = { name: '', notes: '', exercises: [] }

/** `/entreno/rutinas/nueva` and `/entreno/rutinas/:id/editar`. */
export function RoutineEditor() {
  const { id } = useParams()
  const isNew = !id
  const r = useRepo()
  const nav = useNavigate()
  const toast = useToast()
  const ex = useExercises()
  const media = useExerciseMedia()
  const existing = useLiveQuery(async () => (id ? ((await r.get('routines', id)) ?? null) : undefined), [r, id])
  const all = useLiveQuery(() => r.all('routines'), [r])
  // `initial` is frozen the first time the routine arrives: later emissions of the live query (a sync, say)
  // must not overwrite what is being typed. Edits live apart and win over it.
  const [initial, setInitial] = useState<RoutineDraft | null>(isNew ? EMPTY : null)
  const [edits, setEdits] = useState<RoutineDraft | null>(null)
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // One block open at a time; a block just added or duplicated starts open.
  const [openKey, setOpenKey] = useState<string | null>(null)
  if (initial === null && existing) setInitial(draftFromRoutine(existing))
  const loaded = initial !== null
  const draft = edits ?? initial ?? EMPTY
  const setDraft = (fn: (d: RoutineDraft) => RoutineDraft) => setEdits((cur) => fn(cur ?? initial ?? EMPTY))

  const dirty = loaded && !saved && isDirty(initial, draft)
  useLeaveGuard(dirty, isNew ? '/entreno' : `/entreno/rutinas/${id}`)

  const nameOk = draft.name.trim().length > 0
  const canSave = nameOk && !saving && (isNew || dirty)

  const patchItem = (key: string, p: ExercisePatch) => setDraft((d) => ({ ...d, exercises: d.exercises.map((x) => (x.key === key ? patchExercise(x, p) : x)) }))
  const setItems = (fn: (items: RoutineExercise[]) => RoutineExercise[]) => setDraft((d) => ({ ...d, exercises: fn(d.exercises) }))

  function remove(i: number) {
    const item = draft.exercises[i]
    if (!item) return
    setItems((items) => removeItem(items, i).items)
    toast.show({ message: `«${item.name}» quitado`, actionLabel: 'Deshacer', onAction: () => setItems((items) => insertItem(items, i, item)) })
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      let to: string
      if (existing) {
        await r.update('routines', existing.id, patchFromDraft(draft))
        to = existing.id
      } else {
        const rows = all ?? []
        const order = hasManualOrder(rows) ? orderAfter(sortRoutines(rows, new Map()), null) : undefined
        const row = await r.add('routines', { ...buildRoutine(undefined, draft), ...(order !== undefined ? { order } : {}) } as Parameters<typeof r.add<'routines'>>[1])
        to = row.id
      }
      setSaved(true)
      toast.show({ message: 'Rutina guardada' })
      nav(`/entreno/rutinas/${to}`, { replace: true })
    } finally {
      setSaving(false)
    }
  }

  const title = isNew ? 'Nueva rutina' : 'Editar rutina'
  const back = isNew ? '/entreno' : `/entreno/rutinas/${id}`
  const body = useMemo(() => draft.exercises, [draft.exercises])

  if (!loaded || (!isNew && existing === undefined)) {
    return (
      <>
        <PageHeader title={title} back={back} />
        <div className="space-y-6" data-testid="editor-loading">
          <Skeleton height={140} label="Cargando rutina" />
          <Skeleton height={260} label="" />
        </div>
      </>
    )
  }
  if (!isNew && existing === null) {
    return (
      <>
        <PageHeader title={title} back="/entreno" />
        <p className="text-body text-muted">Esta rutina ya no existe.</p>
      </>
    )
  }

  return (
    <>
      <PageHeader title={title} back={back} />
      <div className="space-y-7" data-testid="routine-editor">
        <section className="space-y-3" aria-label="Datos de la rutina">
          <TextField label="Nombre" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="p. ej. Pierna A" hint="Es lo único obligatorio." />
          <TextArea rows={1} label="Notas (opcional)" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="Enfoque, material, recordatorios" />
        </section>

        <section aria-labelledby="ex-title">
          <h2 id="ex-title" className="text-heading text-ink">
            Ejercicios {body.length ? <span className="num text-muted">({body.length})</span> : null}
          </h2>
          {body.length ? (
            <ul className="mt-3 space-y-3" data-testid="routine-exercise-list">
              {body.map((it, i) => (
                <ExerciseBlock
                  key={it.key}
                  item={it}
                  index={i}
                  count={body.length}
                  ex={ex}
                  media={media}
                  expanded={openKey === it.key || it.targetSets < 1}
                  onToggle={() => setOpenKey((k) => (k === it.key ? null : it.key))}
                  onPatch={(p) => patchItem(it.key, p)}
                  onMove={(dir) => setItems((items) => moveItem(items, i, dir))}
                  onDuplicate={() => {
                    const key = uuid()
                    setItems((items) => duplicateItem(items, i, key))
                    setOpenKey(key)
                  }}
                  onRemove={() => remove(i)}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-body text-muted">Aún no hay ejercicios. Búscalos por nombre, músculo o equipo.</p>
          )}
          <button type="button" className="btn-secondary mt-3 min-h-[52px] w-full" onClick={() => setPicker(true)} data-testid="routine-add-exercise">
            <Icon name="plus" size={18} /> Añadir ejercicio
          </button>
          {body.length ? <p className="mt-2 text-label text-muted">{plural(body.reduce((a, e) => a + e.targetSets, 0), 'serie de trabajo', 'series de trabajo')} en total.</p> : null}
        </section>
      </div>

      <DockBar label="Guardar rutina">
        <button type="button" className="btn-primary min-h-[52px] flex-1" disabled={!canSave} onClick={() => void save()} data-testid="save-routine">
          Guardar rutina
        </button>
      </DockBar>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Añadir a la rutina" wide>
        <ExercisePicker
          selectedIds={body.map((i) => i.exerciseId)}
          onSelect={(e) => {
            if (!body.some((i) => i.exerciseId === e.id)) {
              const item = newExerciseItem(e, uuid(), DEFAULT_REST)
              setItems((items) => [...items, item])
              setOpenKey(item.key)
            }
            setPicker(false)
          }}
        />
      </Sheet>
    </>
  )
}
