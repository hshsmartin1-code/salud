import { useMemo } from 'react'
import { useRepo } from '../../app/profile'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/kit'
import { rankSubstitutions, reasonText, type Related } from './exerciseKnowledge'
import { ExerciseThumb, useExerciseMedia } from './exerciseMedia'
import { useExercises, type Exercise } from './exercises'
import { substituteExercise } from './substitution'

type OrderItem = TrainingSession['exerciseOrder'][number]

/** Ranked replacements for one exercise of a live session (favourites that fit are listed first). */
export function SubstituteSheet({
  item,
  session,
  sets,
  onClose,
}: {
  item: OrderItem | null
  session: TrainingSession
  sets: ExerciseSet[]
  onClose: () => void
}) {
  const r = useRepo()
  const ex = useExercises()
  const media = useExerciseMedia()
  const target = item ? ex.byId.get(item.exerciseId) : undefined
  const inSession = useMemo(() => new Set(session.exerciseOrder.map((o) => o.exerciseId)), [session.exerciseOrder])
  const { favs, rest } = useMemo(() => {
    if (!item || !target) return { favs: [] as Related[], rest: [] as Related[] }
    const ranked = rankSubstitutions(target, ex.list, { favorites: ex.favorites, limit: 40, compatibleTrackingOnly: true, exclude: inSession, labels: ex.labels })
    return { favs: ranked.filter((x) => ex.favorites.has(x.exercise.id)).slice(0, 5), rest: ranked.filter((x) => !ex.favorites.has(x.exercise.id)).slice(0, 12) }
  }, [item, target, ex.list, ex.favorites, ex.labels, inSession])
  const hasDone = !!item && sets.some((s) => s.exerciseId === item.exerciseId && s.done)

  async function choose(e: Exercise) {
    if (!item) return
    await substituteExercise(r, session, sets, item, e)
    onClose()
  }

  const row = (rel: Related) => {
    const e = rel.exercise as Exercise
    return (
      <li key={e.id}>
        <button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface2/60" onClick={() => void choose(e)} data-testid="substitute-option">
          <ExerciseThumb media={media} item={media?.items[e.id]} exerciseId={e.id} size={40} exercise={e} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{e.nameEs}</div>
            <div className="truncate text-xs text-muted">{reasonText(rel)}</div>
          </div>
          {ex.favorites.has(e.id) ? <Icon name="star" size={14} className="fill-current text-warn" /> : null}
          <Icon name="swap" size={16} className="text-faint" />
        </button>
      </li>
    )
  }

  return (
    <Sheet open={!!item} onClose={onClose} title={item ? `Sustituir ${item.name}` : 'Sustituir'} wide>
      <div className="space-y-3 pb-2" data-testid="substitute-sheet">
        <p className="text-xs text-muted">
          {hasDone
            ? 'Las series ya hechas se quedan con el ejercicio original; el sustituto se agrega justo debajo con las series pendientes.'
            : 'Reemplaza el ejercicio y sus series pendientes por el que elijas.'}
        </p>
        {!target ? (
          <p className="text-sm text-muted">Este ejercicio ya no está en la biblioteca; agrégalo de nuevo o elige otro desde «Agregar ejercicio».</p>
        ) : favs.length + rest.length === 0 ? (
          <p className="text-sm text-muted">No hay sustitutos con el mismo músculo principal y el mismo tipo de registro.</p>
        ) : (
          <>
            {favs.length ? (
              <section aria-label="Favoritos">
                <h3 className="section-title mb-1.5">Favoritos</h3>
                <ul className="card divide-y divide-line overflow-hidden">{favs.map(row)}</ul>
              </section>
            ) : null}
            {rest.length ? (
              <section aria-label="Sugeridos">
                <h3 className="section-title mb-1.5">Sugeridos</h3>
                <ul className="card divide-y divide-line overflow-hidden">{rest.map(row)}</ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  )
}
