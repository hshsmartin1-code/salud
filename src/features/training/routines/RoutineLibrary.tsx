import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Routine } from '../../../db/types'
import { Icon } from '../../../ui/Icon'
import { Menu } from '../../../ui/Menu'
import { SectionHeader } from '../../../ui/SectionHeader'
import { Skeleton } from '../../../ui/Skeleton'
import { PageHeader } from '../../../ui/kit'
import { archivedRoutines, filterRoutines, hasManualOrder, sortRoutines } from '../routines'
import { groupLabel } from '../muscles'
import { useStartTraining } from '../shared/useStartTraining'
import { LIBRARY_GRID, LibraryRow } from './LibraryRow'
import { TemplatesSection } from './TemplatesSection'
import { routineSummary } from '../shared/format'
import { useTrainingData } from '../shared/useTrainingData'
import { routineStats } from '../trainingStats'
import { useRoutineActions } from './useRoutineActions'

/** `/entreno/rutinas`: the whole library. Manual order with move up/down, duplicate, archive and delete. */
export function RoutineLibrary() {
  const { routines, prepared, lastUsed, ex, today } = useTrainingData()
  const nav = useNavigate()
  const act = useRoutineActions(routines, lastUsed)
  const start = useStartTraining()
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<{ id: string; dy: number; from: number; over: number; h: number } | null>(null)
  const rows = useRef<Map<string, HTMLLIElement>>(new Map())
  const geo = useRef<{ startY: number; tops: number[] }>({ startY: 0, tops: [] })
  const view = useMemo(() => {
    if (!routines || !prepared) return null
    const active = sortRoutines(routines, lastUsed)
    return { active, archived: archivedRoutines(routines), stats: new Map(routines.map((rt) => [rt.id, routineStats(rt, prepared, today, ex.byId)])) }
  }, [routines, prepared, lastUsed, ex.byId, today])

  if (!view) {
    return (
      <>
        <PageHeader title="Rutinas" back="/entreno" />
        <Skeleton lines={5} label="Cargando rutinas" />
      </>
    )
  }
  const { active, archived, stats } = view
  const manual = hasManualOrder(routines ?? [])

  const menuFor = (rt: Routine, isArchived: boolean) => [
    { label: 'Editar', icon: 'edit' as const, onSelect: () => nav(`/entreno/rutinas/${rt.id}/editar`) },
    { label: 'Duplicar', icon: 'copy' as const, onSelect: () => void act.duplicate(rt) },
    isArchived ? { label: 'Restaurar', icon: 'rotateCcw' as const, onSelect: () => void act.restore(rt) } : { label: 'Archivar', icon: 'layers' as const, onSelect: () => void act.archive(rt) },
    { label: 'Eliminar', icon: 'trash' as const, tone: 'danger' as const, onSelect: () => void act.remove(rt) },
  ]

  const filtering = query.trim() !== ''
  const shown = filtering ? filterRoutines(active, query, (rt) => stats.get(rt.id)!.groups.map((g) => groupLabel(g.group))) : active

  function beginDrag(id: string, from: number, y: number) {
    const els = active.map((x) => rows.current.get(x.id))
    const rects = els.map((el) => el?.getBoundingClientRect())
    geo.current = { startY: y, tops: rects.map((r) => (r ? r.top + r.height / 2 : 0)) }
    setDrag({ id, dy: 0, from, over: from, h: rects[from]?.height ?? 0 })
  }
  function moveDrag(y: number) {
    setDrag((d) => {
      if (!d) return d
      const dy = y - geo.current.startY
      const center = geo.current.tops[d.from]! + dy
      let over = d.from
      geo.current.tops.forEach((t, i) => {
        if (i < d.from && center < t) over = Math.min(over, i)
        if (i > d.from && center > t) over = Math.max(over, i)
      })
      return { ...d, dy, over }
    })
  }
  function endDrag(cancel: boolean) {
    const d = drag
    setDrag(null)
    if (d && !cancel && d.over !== d.from) void act.moveTo(d.id, d.over)
  }

  return (
    <>
      <PageHeader
        title="Rutinas"
        back="/entreno"
        actions={
          <Link to="/entreno/rutinas/nueva" className="btn-secondary px-3" data-testid="new-routine">
            <Icon name="plus" size={16} /> Nueva
          </Link>
        }
      />
      <div className="space-y-7" data-testid="routine-library">
        <section aria-labelledby="active-title">
          <SectionHeader
            title={<span id="active-title">Activas ({active.length})</span>}
            hint={manual ? 'En el orden que elegiste' : 'Ordenadas por uso reciente. Al moverlas, el orden pasa a ser manual.'}
            action={manual ? <button type="button" className="btn-ghost px-2 text-label" onClick={() => void act.clearOrder()} data-testid="clear-order">Ordenar por uso</button> : undefined}
          />
          {active.length > 5 ? (
            <div className="relative mt-3">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className="field pl-10" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por rutina, ejercicio o músculo" aria-label="Buscar rutinas" data-testid="routine-search" />
            </div>
          ) : null}
          {active.length ? (
            shown.length ? (
              <>
              <div className={`mt-2 hidden border-b border-line pb-1 text-micro text-muted lg:grid ${LIBRARY_GRID}`} aria-hidden>
                <span className="col-start-2">Rutina</span>
                <span className="col-start-3">Contenido</span>
                <span className="col-start-4">Grupos</span>
                <span className="col-start-5">Última vez</span>
              </div>
              <ul className="divide-rows mt-2 lg:mt-0" data-testid="library-list">
                {shown.map((rt) => {
                  const st = stats.get(rt.id)!
                  const idx = active.findIndex((x) => x.id === rt.id)
                  const dragging = drag?.id === rt.id
                  let shift = 0
                  if (drag && !dragging) {
                    if (drag.from < drag.over && idx > drag.from && idx <= drag.over) shift = -drag.h
                    if (drag.from > drag.over && idx >= drag.over && idx < drag.from) shift = drag.h
                  }
                  return (
                    <LibraryRow
                      key={rt.id}
                      routine={rt}
                      stats={st}
                      ex={ex}
                      canDrag={!filtering}
                      visual={{ dy: dragging ? drag.dy : 0, shift, dragging }}
                      menu={[
                        { label: 'Iniciar', icon: 'play' as const, onSelect: () => void start(rt) },
                        { label: 'Subir', icon: 'chevronUp' as const, disabled: idx === 0, onSelect: () => void act.move(rt.id, -1) },
                        { label: 'Bajar', icon: 'chevronDown' as const, disabled: idx === active.length - 1, onSelect: () => void act.move(rt.id, 1) },
                        ...menuFor(rt, false),
                      ]}
                      rowRef={(el) => void (el ? rows.current.set(rt.id, el) : rows.current.delete(rt.id))}
                      onStart={() => void start(rt)}
                      onNudge={(dir) => void act.move(rt.id, dir)}
                      onDragStart={(y) => beginDrag(rt.id, idx, y)}
                      onDragMove={(y) => moveDrag(y)}
                      onDragEnd={(cancel) => endDrag(cancel)}
                    />
                  )
                })}
              </ul>
              </>
            ) : (
              <p className="mt-3 text-body text-muted">Ninguna rutina coincide con «{query}».</p>
            )
          ) : (
            <p className="mt-3 text-body text-muted">No tienes rutinas activas. Crea una o empieza con una plantilla.</p>
          )}
        </section>

        {archived.length ? (
          <section className="border-t border-line pt-4" aria-labelledby="archived-title">
            <h2 id="archived-title" className="sr-only">
              Rutinas archivadas
            </h2>
            <button
              type="button"
              className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left text-heading text-ink"
              aria-expanded={showArchived}
              aria-controls="archived-list"
              onClick={() => setShowArchived((v) => !v)}
              data-testid="archived-toggle"
            >
              <span>Archivadas ({archived.length})</span>
              <Icon name={showArchived ? 'chevronUp' : 'chevronDown'} size={20} className="text-muted" />
            </button>
            {showArchived ? (
              <ul id="archived-list" className="divide-rows" data-testid="archived-list">
                {archived.map((rt) => (
                  <li key={rt.id} className="flex items-center gap-1">
                    <Link to={`/entreno/rutinas/${rt.id}`} className="min-h-[56px] min-w-0 flex-1 py-2 text-body font-medium text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      <span className="block truncate">{rt.name}</span>
                      <span className="block truncate text-label">{routineSummary(rt.exercises.length, rt.exercises.reduce((a, e) => a + e.targetSets, 0))}</span>
                    </Link>
                    <button type="button" className="btn-secondary shrink-0 px-3" onClick={() => void act.restore(rt)} data-testid="restore-routine">
                      Restaurar
                    </button>
                    <Menu label={`Más acciones de ${rt.name}`} items={menuFor(rt, true)} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        <TemplatesSection defaultOpen={active.length < 3} onUse={(t) => act.applyTemplate(t)} />
      </div>
    </>
  )
}
