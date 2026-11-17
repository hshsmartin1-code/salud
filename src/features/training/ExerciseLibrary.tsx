import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import type { TrackingType } from '../../db/catalogTypes'
import { SelectField, TextArea, TextField } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Skeleton } from '../../ui/Skeleton'
import { Badge, EmptyState, PageHeader, Sheet } from '../../ui/kit'
import { activeFilterCount, EMPTY_FILTER, exercisePath, filterLibrary, LEVEL_LABEL, resolveExerciseId, type LibraryFilter } from './exerciseKnowledge'
import { muscleList, TRACKING_LABEL, useExercises, type Exercise } from './exercises'
import { ExerciseThumb, useExerciseMedia, type ExerciseMediaFile } from './exerciseMedia'
import { inGroup, MUSCLE_GROUPS, type MuscleGroupId } from './muscles'
import { normalize } from '../../domain/search'

// The detail (charts, muscle figure, history) is a separate chunk: the library and the pickers stay light.
const ExerciseDetailLazy = lazy(() => import('./ExerciseDetail').then((m) => ({ default: m.ExerciseDetail })))

const PAGE = 80
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const shortDay = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`
const sortedOpts = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'))

type Ctx = ReturnType<typeof useExercises>

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="-my-1.5 flex gap-2 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  )
}

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" className={`${on ? 'chip chip-on' : 'chip'} shrink-0`} aria-pressed={on} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  )
}

interface RowProps {
  e: Exercise
  ex: Ctx
  media: ExerciseMediaFile | null
  last: string | undefined
  selected: boolean
  browse: boolean
  onSelect: (e: Exercise) => void
  onInfo: (e: Exercise) => void
}

function LibraryRow({ e, ex, media, last, selected, browse, onSelect, onInfo }: RowProps) {
  const fav = ex.favorites.has(e.id)
  const inner = (
    <>
      <ExerciseThumb media={media} item={media?.items[e.id]} exerciseId={e.id} size={48} exercise={e} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium">{e.nameEs}</div>
        <div className="truncate text-label text-muted">
          {muscleList(e, ex.labels) || '—'}
          {e.equipment ? ` · ${ex.labels.equipment[e.equipment] ?? e.equipment}` : ''}
        </div>
      </div>
      {e.custom ? <Badge tone="accent">Mío</Badge> : null}
      {selected ? (
        <Icon name="check" size={20} className="shrink-0 text-accent" />
      ) : last ? (
        <span className="flex shrink-0 flex-col items-end text-micro text-muted" data-testid="exercise-logged" aria-label={`Ya registrado, última vez el ${shortDay(last)}`}>
          <Icon name="check" size={13} className="text-[rgb(var(--train))]" />
          <span className="num">{shortDay(last)}</span>
        </span>
      ) : null}
    </>
  )
  const cls = 'flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2 pl-1 pr-1 text-left'
  return (
    <li className="flex items-center" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 64px' }} data-testid="exercise-row">
      {browse ? (
        <Link to={exercisePath(e.id)} className={cls} aria-label={`${e.nameEs}: abrir ejercicio`}>
          {inner}
        </Link>
      ) : (
        <>
          <button type="button" className={cls} onClick={() => onSelect(e)}>
            {inner}
          </button>
          <IconButton icon="info" label={`Ver información de ${e.nameEs}`} onClick={() => onInfo(e)} data-testid="exercise-info" />
        </>
      )}
      <button
        type="button"
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${fav ? 'text-warn' : 'text-faint hover:text-muted'}`}
        aria-pressed={fav}
        aria-label={fav ? `Quitar ${e.nameEs} de favoritos` : `Marcar ${e.nameEs} como favorito`}
        onClick={() => void ex.toggleFavorite(e)}
        data-testid="favorite-toggle"
      >
        <Icon name="star" size={20} className={fav ? 'fill-current' : ''} />
      </button>
    </li>
  )
}

/**
 * Search + filters over catalog and custom exercises. `browse` (the library page) makes a row open the
 * exercise page; without it (routine and session pickers) a row selects and an info button opens the sheet.
 */
export function ExercisePicker({ onSelect, selectedIds = [], browse = false }: { onSelect?: (e: Exercise) => void; selectedIds?: string[]; browse?: boolean }) {
  const r = useRepo()
  const ex = useExercises()
  const media = useExerciseMedia()
  const [f, setF] = useState<LibraryFilter>(EMPTY_FILTER)
  const [group, setGroup] = useState<MuscleGroupId | ''>('')
  const [showFilters, setShowFilters] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [info, setInfo] = useState<Exercise | null>(null)
  const [shown, setShown] = useState(PAGE)
  const update = (patch: Partial<LibraryFilter>) => {
    setF((cur) => ({ ...cur, ...patch }))
    setShown(PAGE)
  }
  const clear = () => {
    setF(EMPTY_FILTER)
    setGroup('')
    setShown(PAGE)
  }

  // Last date each exercise was logged (renamed ids resolve to the current one).
  const usage = useLiveQuery(async () => {
    const rows = await r.all('exerciseSets')
    const m = new Map<string, string>()
    for (const s of rows) {
      if (!s.done) continue
      const id = resolveExerciseId(s.exerciseId, ex.aliases)
      const cur = m.get(id)
      if (!cur || s.date > cur) m.set(id, s.date)
    }
    return m
  }, [r, ex.aliases])

  // Search also matches the muscle and equipment names (accent-insensitive).
  const searchable = useMemo(
    () =>
      ex.list.map((e) => ({
        ...e,
        search: `${e.search} ${normalize([...e.primaryMuscles.map((m) => ex.labels.muscles[m] ?? m), e.equipment ? (ex.labels.equipment[e.equipment] ?? e.equipment) : ''].join(' '))}`,
      })),
    [ex.list, ex.labels],
  )
  const byGroup = useMemo(() => (group ? searchable.filter((e) => inGroup(e, group)) : searchable), [searchable, group])
  const results = useMemo(() => {
    const r = filterLibrary(byGroup, f, { favorites: ex.favorites, hasMedia: (id) => !!media?.items[id] }) as Exercise[]
    // Without a query the list is alphabetical: favourites already have their own section above.
    return f.q.trim() ? r : [...r].sort((a, b) => a.nameEs.localeCompare(b.nameEs, 'es'))
  }, [byGroup, f, ex.favorites, media])
  const equipChips = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of byGroup) n.set(e.equipment ?? 'body only', (n.get(e.equipment ?? 'body only') ?? 0) + 1)
    return [...n.entries()]
      .filter(([k]) => ex.labels.equipment[k] || k === f.equipment)
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => ({ value, label: ex.labels.equipment[value] ?? value }))
  }, [byGroup, ex.labels, f.equipment])
  const muscleOpts = useMemo(() => sortedOpts(ex.labels.muscles), [ex.labels])
  const equipOpts = useMemo(() => sortedOpts(ex.labels.equipment), [ex.labels])
  const catOpts = useMemo(() => sortedOpts(ex.labels.category), [ex.labels])
  const levelOpts = useMemo(() => Object.entries(LEVEL_LABEL).map(([value, label]) => ({ value, label })), [])
  const active = activeFilterCount(f)
  const dirty = active > 0 || f.q !== '' || group !== ''
  const quick: { key: 'favoritesOnly' | 'withMedia' | 'customOnly'; label: string }[] = [
    { key: 'favoritesOnly', label: 'Favoritos' },
    { key: 'withMedia', label: 'Con ilustración' },
    { key: 'customOnly', label: 'Propios' },
  ]

  // "Recientes" and "Favoritos" come first while nothing narrows the list.
  const recent = useMemo(() => {
    if (!usage) return []
    return [...usage.entries()]
      .sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? 1 : -1))
      .map(([id]) => ex.byId.get(id))
      .filter((e): e is Exercise => !!e)
      .slice(0, 6)
  }, [usage, ex.byId])
  const favs = useMemo(() => ex.list.filter((e) => ex.favorites.has(e.id)).slice(0, 8), [ex.list, ex.favorites])
  const sections = !dirty && ex.ready

  // Page the long list: more rows load when the end comes into view; the button is the fallback.
  const sentinel = useRef<HTMLDivElement>(null)
  const total = results.length
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) setShown((n) => (n < total ? n + PAGE : n))
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [total, shown])

  const rowProps = (e: Exercise) => ({
    e,
    ex,
    media,
    last: usage?.get(e.id),
    selected: selectedIds.includes(e.id),
    browse,
    onSelect: (x: Exercise) => onSelect?.(x),
    onInfo: setInfo,
  })

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="field pl-10"
            type="search"
            placeholder="Buscar por nombre, músculo o equipo"
            value={f.q}
            onChange={(e) => update({ q: e.target.value })}
            data-testid="exercise-search"
            aria-label="Buscar ejercicio"
          />
        </div>
        <button
          className={`btn-secondary px-3 ${active ? 'text-accent' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Filtros"
          aria-expanded={showFilters}
          data-testid="exercise-filters-toggle"
        >
          <Icon name="filter" size={18} />
          {active ? <span className="num text-label">{active}</span> : null}
        </button>
      </div>
      <ChipRow label="Filtrar por grupo muscular">
        <Chip on={group === ''} onClick={() => { setGroup(''); setShown(PAGE) }} testId="group-all">
          Todos
        </Chip>
        {MUSCLE_GROUPS.map((g) => (
          <Chip key={g.id} on={group === g.id} onClick={() => { setGroup(group === g.id ? '' : g.id); setShown(PAGE) }} testId={`group-${g.id}`}>
            {g.label}
          </Chip>
        ))}
      </ChipRow>
      <ChipRow label="Filtrar por equipamiento">
        {equipChips.map((q) => (
          <Chip key={q.value} on={f.equipment === q.value} onClick={() => update({ equipment: f.equipment === q.value ? '' : q.value })} testId={`equip-${q.value.replace(/\s+/g, '-')}`}>
            {q.label}
          </Chip>
        ))}
      </ChipRow>
      {showFilters ? (
        <div className="space-y-3" data-testid="exercise-filter-panel">
          <ChipRow label="Filtros rápidos">
            {quick.map((c) => (
              <Chip key={c.key} on={f[c.key]} onClick={() => update({ [c.key]: !f[c.key] })} testId={`filter-${c.key}`}>
                {c.key === 'favoritesOnly' ? <Icon name="star" size={13} /> : null}
                {c.label}
              </Chip>
            ))}
          </ChipRow>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Músculo principal" value={f.muscle} onChange={(v) => update({ muscle: v })} options={muscleOpts} placeholder="Todos" />
            <SelectField label="Equipo" value={f.equipment} onChange={(v) => update({ equipment: v })} options={equipOpts} placeholder="Todos" />
            <SelectField label="Dificultad" value={f.level} onChange={(v) => update({ level: v })} options={levelOpts} placeholder="Todas" />
            <SelectField label="Tipo" value={f.category} onChange={(v) => update({ category: v })} options={catOpts} placeholder="Todos" />
          </div>
        </div>
      ) : null}
      {ex.ready ? (
        <div className="flex min-h-[44px] items-center justify-between text-label text-muted">
          <span aria-live="polite" data-testid="exercise-count">
            {results.length} {results.length === 1 ? 'ejercicio' : 'ejercicios'}
          </span>
          {dirty ? (
            <button className="-mr-2 min-h-[44px] px-2 font-medium text-accent" onClick={clear} data-testid="filters-clear">
              Limpiar todo
            </button>
          ) : null}
        </div>
      ) : null}
      {!ex.ready ? (
        <div className="py-4">{ex.error ? <p className="text-center text-body text-muted">No se pudo cargar el catálogo: {ex.error}</p> : <Skeleton lines={6} label="Cargando ejercicios" />}</div>
      ) : (
        <>
          {sections && recent.length ? (
            <section aria-label="Recientes">
              <h2 className="text-heading">Recientes</h2>
              <ul className="divide-rows" data-testid="exercise-recent">
                {recent.map((e) => (
                  <LibraryRow key={e.id} {...rowProps(e)} />
                ))}
              </ul>
            </section>
          ) : null}
          {sections && favs.length ? (
            <section aria-label="Favoritos">
              <h2 className="text-heading">Favoritos</h2>
              <ul className="divide-rows" data-testid="exercise-favorites">
                {favs.map((e) => (
                  <LibraryRow key={e.id} {...rowProps(e)} />
                ))}
              </ul>
            </section>
          ) : null}
          {results.length ? (
            <section aria-label="Todos los ejercicios">
              {sections && (recent.length || favs.length) ? <h2 className="text-heading">Todos los ejercicios</h2> : null}
              <ul className="divide-rows" data-testid="exercise-results">
                {results.slice(0, shown).map((e) => (
                  <LibraryRow key={e.id} {...rowProps(e)} />
                ))}
              </ul>
              {results.length > shown ? (
                <>
                  <div ref={sentinel} aria-hidden="true" />
                  <button className="btn-ghost w-full text-body" onClick={() => setShown((n) => n + PAGE)}>
                    Mostrar más ({results.length - shown})
                  </button>
                </>
              ) : null}
            </section>
          ) : (
            <div className="py-6 text-center text-body text-muted">
              <p>Sin resultados con estos filtros.</p>
              {dirty ? (
                <button className="mt-1 min-h-[44px] px-3 font-medium text-accent" onClick={clear}>
                  Limpiar filtros
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
      <button className="btn-ghost w-full text-body" onClick={() => setCreateOpen(true)}>
        <Icon name="plus" size={16} /> Crear ejercicio propio
      </button>
      <CustomExerciseSheet open={createOpen} onClose={() => setCreateOpen(false)} initialName={f.q} labels={ex.labels} />
      {browse ? null : <ExerciseDetailSheet exercise={info} onClose={() => setInfo(null)} />}
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

/** Exercise info in a sheet (used where a picker needs it; the library opens the full page instead). */
export function ExerciseDetailSheet({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  // Opening a variant/substitute from inside the sheet swaps the shown exercise without touching the parent state.
  const [override, setOverride] = useState<{ from: string; ex: Exercise } | null>(null)
  const current = override && exercise && override.from === exercise.id ? override.ex : exercise
  const close = () => {
    setOverride(null)
    onClose()
  }
  return (
    <Sheet open={!!exercise} onClose={close} title={current?.nameEs} wide>
      {current && exercise ? (
        <Suspense fallback={<Skeleton lines={5} label="Cargando ejercicio" />}>
          <ExerciseDetailLazy key={current.id} exercise={current} onOpen={(e) => setOverride({ from: exercise.id, ex: e })} onLeave={close} onDeleted={close} />
        </Suspense>
      ) : null}
    </Sheet>
  )
}

export function ExerciseLibraryPage() {
  const ex = useExercises()
  return (
    <>
      <PageHeader title="Ejercicios" subtitle={ex.ready ? `${ex.list.length} en la biblioteca` : undefined} back="/entreno" />
      {ex.error && !ex.ready ? (
        <EmptyState icon="alert" title="Catálogo no disponible">
          {ex.error}
        </EmptyState>
      ) : (
        <ExercisePicker browse />
      )}
    </>
  )
}
