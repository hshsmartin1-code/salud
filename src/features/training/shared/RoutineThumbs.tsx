import type { RoutineExercise } from '../../../db/types'
import { useExercises } from '../exercises'
import { ExerciseThumb, useExerciseMedia } from '../exerciseMedia'

/** Overlapping thumbnails of a routine's first exercises, with "+n" for the rest. Decorative (the text carries the names). */
export function RoutineThumbs({ exercises, ex, max = 4, size = 32 }: { exercises: readonly RoutineExercise[]; ex: ReturnType<typeof useExercises>; max?: number; size?: number }) {
  const media = useExerciseMedia()
  const shown = exercises.slice(0, max)
  const more = exercises.length - shown.length
  if (!shown.length) return null
  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      <span className="flex -space-x-2">
        {shown.map((e) => {
          const c = ex.byId.get(e.exerciseId)
          return (
            <span key={e.key} className="rounded-lg ring-2 ring-surface">
              <ExerciseThumb media={media} item={media?.items[e.exerciseId]} exerciseId={e.exerciseId} size={size} exercise={c} />
            </span>
          )
        })}
      </span>
      {more > 0 ? <span className="num ml-1.5 text-label text-muted">+{more}</span> : null}
    </span>
  )
}
