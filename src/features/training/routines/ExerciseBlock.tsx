import { useState } from 'react'
import type { RoutineExercise } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { Menu } from '../../../ui/Menu'
import { Stepper } from '../../../ui/Stepper'
import { TextField } from '../../../ui/fields'
import type { useExercises } from '../exercises'
import { ExerciseThumb, type ExerciseMediaFile } from '../exerciseMedia'
import { describeExercise, formatRest, type ExercisePatch } from '../routines'

const REST_PRESETS = [60, 90, 120, 180] as const

const REPS_LABEL: Record<RoutineExercise['trackingType'], { label: string; placeholder: string }> = {
  weight_reps: { label: 'Repeticiones objetivo', placeholder: '8–12' },
  bodyweight_reps: { label: 'Repeticiones objetivo', placeholder: '8–12' },
  time: { label: 'Duración objetivo', placeholder: '30–60 s' },
  distance: { label: 'Objetivo', placeholder: '5 km' },
}

/**
 * One exercise of the routine being edited. Collapsed it is one summary row (thumbnail, name, targets,
 * menu, chevron); expanded it shows the controls: work sets, warm-up sets, rest (presets plus "Otro"),
 * reps and an optional note.
 */
export function ExerciseBlock({
  item,
  index,
  count,
  ex,
  media,
  expanded,
  onToggle,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  item: RoutineExercise
  index: number
  count: number
  ex: ReturnType<typeof useExercises>
  media: ExerciseMediaFile | null
  expanded: boolean
  onToggle: () => void
  onPatch: (p: ExercisePatch) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const c = ex.byId.get(item.exerciseId)
  const muscles = c ? c.primaryMuscles.map((m) => ex.labels.muscles[m] ?? m).join(', ') : ''
  const [noteOpen, setNoteOpen] = useState(!!item.notes)
  const reps = REPS_LABEL[item.trackingType]
  const rest = item.restSec
  const custom = !(REST_PRESETS as readonly number[]).includes(rest)
  const [other, setOther] = useState(custom)
  const showOther = other || custom
  const summary = [describeExercise({ ...item, warmupSets: undefined }), item.warmupSets ? `${item.warmupSets} calent.` : null].filter(Boolean).join(' · ')
  const bodyId = `ex-${item.key}`
  return (
    <li className="card p-3" data-testid="routine-exercise-block">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          data-testid="exercise-summary"
        >
          <ExerciseThumb media={media} item={media?.items[item.exerciseId]} exerciseId={item.exerciseId} size={48} exercise={c} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-ink">{item.name}</span>
            <span className="num block text-label text-muted">
              {summary}
              {item.notes ? (
                <>
                  {' '}
                  <Icon name="pencil" size={12} className="inline align-[-1px]" />
                  <span className="sr-only"> con nota</span>
                </>
              ) : null}
            </span>
            {expanded ? (
              <span className="block truncate text-label text-muted">
                {index + 1} de {count}
                {muscles ? ` · ${muscles}` : ''}
              </span>
            ) : null}
          </span>
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={18} className="shrink-0 text-faint" />
        </button>
        <Menu
          label={`Acciones de ${item.name}`}
          items={[
            { label: 'Subir', icon: 'chevronUp', disabled: index === 0, onSelect: () => onMove(-1) },
            { label: 'Bajar', icon: 'chevronDown', disabled: index === count - 1, onSelect: () => onMove(1) },
            { label: 'Duplicar', icon: 'copy', onSelect: onDuplicate },
            { label: 'Quitar', icon: 'trash', tone: 'danger', onSelect: onRemove },
          ]}
        />
      </div>

      {expanded ? (
        <div id={bodyId}>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
            <Stepper label="Series" value={item.targetSets} onChange={(v) => onPatch({ targetSets: v })} step={1} min={1} max={30} />
            <Stepper label="Calentamiento" value={item.warmupSets ?? 0} onChange={(v) => onPatch({ warmupSets: v })} step={1} min={0} max={10} />
          </div>

          <div className="mt-3">
            <span className="label">Descanso</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Descanso">
              {REST_PRESETS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className={rest === sec && !other ? 'chip chip-on' : 'chip'}
                  aria-pressed={rest === sec && !other}
                  onClick={() => {
                    setOther(false)
                    onPatch({ restSec: sec })
                  }}
                >
                  {formatRest(sec)}
                </button>
              ))}
              <button type="button" className={showOther ? 'chip chip-on' : 'chip'} aria-pressed={showOther} onClick={() => setOther(true)}>
                Otro
              </button>
            </div>
            {showOther ? (
              <div className="mt-2">
                <Stepper label="Descanso (segundos)" value={rest} onChange={(v) => onPatch({ restSec: v })} step={15} min={0} max={900} unit="s" />
              </div>
            ) : null}
          </div>

          <div className="mt-3">
            <TextField label={`${reps.label} (opcional)`} value={item.targetReps} onChange={(v) => onPatch({ targetReps: v })} placeholder={reps.placeholder} />
          </div>

          <div className="mt-3">
            {noteOpen ? (
              <TextField label="Nota (opcional)" value={item.notes ?? ''} onChange={(v) => onPatch({ notes: v })} placeholder="p. ej. asiento 4, agarre estrecho" />
            ) : (
              <button type="button" className="btn-ghost -ml-2 px-2 text-label" onClick={() => setNoteOpen(true)}>
                <Icon name="plus" size={16} /> Añadir nota
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  )
}
