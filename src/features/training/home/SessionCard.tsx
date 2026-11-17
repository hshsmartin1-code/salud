import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatNumber } from '../../../domain/units'
import { Icon } from '../../../ui/Icon'
import { Menu, type MenuItem } from '../../../ui/Menu'
import { ExerciseThumb, useExerciseMedia } from '../exerciseMedia'
import type { useExercises } from '../exercises'
import { plural } from '../routines'
import { weekdayDay } from '../shared/format'
import { minutesText, sessionExerciseLines, type Prepared, type SessionDigest } from '../trainingStats'

const SHOWN = 3

/**
 * A finished session as a card: name and date, then duration · volume · records on one line, then up to three
 * exercises with their thumbnail ("3 × Sentadilla con barra") and "Ver N ejercicios más". The whole card is the
 * link to the session; `menu` adds the actions of the history page.
 */
export function SessionCard({ digest, prepared, ex, menu }: { digest: SessionDigest; prepared: Prepared; ex: ReturnType<typeof useExercises>; menu?: readonly MenuItem[] }) {
  const { session: s, workSets, volume, minutes, records } = digest
  const media = useExerciseMedia()
  const lines = useMemo(() => sessionExerciseLines(prepared, s), [prepared, s])
  const shown = lines.slice(0, SHOWN)
  const more = lines.length - shown.length
  const stats = [minutes !== null ? minutesText(minutes) : null, volume > 0 ? `${formatNumber(volume, 0)} kg` : plural(workSets, 'serie', 'series')].filter(Boolean).join(' · ')
  return (
    <li className="relative rounded-2xl border border-line bg-surface" data-testid="session-row">
      <Link
        to={`/entreno/sesion/${s.id}`}
        className="block rounded-2xl px-4 py-3 outline-none hover:bg-surface2/40 focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`${s.name}, ${weekdayDay(s.date)}. ${stats}${records ? `, ${plural(records, 'récord', 'récords')}` : ''}. Abrir sesión`}
      >
        <span className={`flex items-baseline justify-between gap-3 ${menu ? 'pr-9' : ''}`}>
          <span className="min-w-0 truncate text-heading text-ink">{s.name}</span>
          <span className="num shrink-0 text-label text-muted">{weekdayDay(s.date)}</span>
        </span>
        <span className="num mt-0.5 flex items-center gap-1.5 text-label text-muted">
          <span className="min-w-0 truncate">{stats}</span>
          {records > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-ink">
              <span aria-hidden>·</span>
              <Icon name="trophy" size={14} className="text-warn" />
              {plural(records, 'récord', 'récords')}
            </span>
          ) : null}
        </span>
        {shown.length ? (
          <ul className="mt-2.5 space-y-1.5" data-testid="session-exercises">
            {shown.map((l) => {
              const e = ex.byId.get(l.exerciseId)
              return (
                <li key={l.exerciseId} className="flex items-center gap-2.5" data-testid="session-exercise">
                  <ExerciseThumb media={media} item={media?.items[l.exerciseId]} size={32} exercise={e} muscle={e?.primaryMuscles[0] ? ex.labels.muscles[e.primaryMuscles[0]] : undefined} exerciseId={l.exerciseId} />
                  <span className="min-w-0 truncate text-body text-ink">
                    <span className="num text-muted">{l.sets} ×</span> {l.name}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}
        {more > 0 ? (
          <span className="mt-2 block text-label font-medium text-muted" data-testid="session-more">
            Ver {more} {more === 1 ? 'ejercicio más' : 'ejercicios más'}
          </span>
        ) : null}
      </Link>
      {menu ? (
        <span className="absolute right-1 top-1">
          <Menu label={`Más acciones de ${s.name}, ${weekdayDay(s.date)}`} items={menu} />
        </span>
      ) : null}
    </li>
  )
}
