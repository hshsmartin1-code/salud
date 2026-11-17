import { useCallback } from 'react'
import { useRepo } from '../../../app/profile'
import { uuid } from '../../../db/repo'
import type { Routine } from '../../../db/types'
import { useConfirm } from '../../../ui/Confirm'
import { useToast } from '../../../ui/Toast'
import { duplicateRoutine, moveRoutine, moveRoutineTo, orderAfter, sortRoutines } from '../routines'
import { routinesFromTemplate, type RoutineTemplate } from '../templates'

/**
 * Library actions on routines, each writing only the rows it has to (duplicate adds one row, archive
 * touches one, a move touches the rows whose position changes). Archive and duplicate offer "Deshacer";
 * deleting asks first and cannot be undone.
 */
export function useRoutineActions(routines: readonly Routine[] | undefined, lastUsed: ReadonlyMap<string, string>) {
  const r = useRepo()
  const toast = useToast()
  const confirm = useConfirm()

  const duplicate = useCallback(
    async (routine: Routine): Promise<Routine | undefined> => {
      const all = routines ?? []
      const display = sortRoutines(all, lastUsed)
      const copy = await r.add('routines', duplicateRoutine(routine, all.map((x) => x.name), uuid, orderAfter(display, routine.id)))
      toast.show({ message: `Duplicada como «${copy.name}»`, actionLabel: 'Deshacer', onAction: () => void r.remove('routines', copy.id) })
      return copy
    },
    [r, routines, lastUsed, toast],
  )

  const archive = useCallback(
    async (routine: Routine) => {
      await r.update('routines', routine.id, { archived: true })
      toast.show({ message: `«${routine.name}» archivada`, actionLabel: 'Deshacer', onAction: () => void r.update('routines', routine.id, { archived: undefined }) })
    },
    [r, toast],
  )

  const restore = useCallback(
    async (routine: Routine) => {
      await r.update('routines', routine.id, { archived: undefined })
      toast.show({ message: `«${routine.name}» restaurada`, actionLabel: 'Deshacer', onAction: () => void r.update('routines', routine.id, { archived: true }) })
    },
    [r, toast],
  )

  const remove = useCallback(
    async (routine: Routine): Promise<boolean> => {
      const ok = await confirm({
        title: `¿Eliminar «${routine.name}»?`,
        body: 'Se borra la rutina. Las sesiones que ya hiciste con ella se conservan. No se puede deshacer.',
        confirmLabel: 'Eliminar rutina',
        tone: 'danger',
      })
      if (!ok) return false
      await r.remove('routines', routine.id)
      toast.show({ message: `«${routine.name}» eliminada` })
      return true
    },
    [r, toast, confirm],
  )

  const move = useCallback(
    async (id: string, dir: -1 | 1) => {
      const changes = moveRoutine(sortRoutines(routines ?? [], lastUsed), id, dir)
      if (!changes.length) return
      await r.db.transaction('rw', [r.db.routines], async () => {
        for (const c of changes) await r.update('routines', c.id, { order: c.order })
      })
    },
    [r, routines, lastUsed],
  )

  const moveTo = useCallback(
    async (id: string, toIndex: number) => {
      const changes = moveRoutineTo(sortRoutines(routines ?? [], lastUsed), id, toIndex)
      if (!changes.length) return
      await r.db.transaction('rw', [r.db.routines], async () => {
        for (const c of changes) await r.update('routines', c.id, { order: c.order })
      })
    },
    [r, routines, lastUsed],
  )

  /** Creates the template's routines as normal rows; "Deshacer" removes exactly those. */
  const applyTemplate = useCallback(
    async (t: RoutineTemplate): Promise<Routine[]> => {
      const created: Routine[] = []
      for (const data of routinesFromTemplate(t, routines ?? [], uuid)) created.push(await r.add('routines', data))
      toast.show({ message: `«${t.name}» añadida a tus rutinas`, actionLabel: 'Deshacer', onAction: () => void r.removeMany('routines', created.map((c) => c.id)) })
      return created
    },
    [r, routines, toast],
  )

  /** Back to automatic order (most recently used first): removes the manual positions. */
  const clearOrder = useCallback(async () => {
    const manual = (routines ?? []).filter((x) => typeof x.order === 'number')
    await r.db.transaction('rw', [r.db.routines], async () => {
      for (const x of manual) await r.update('routines', x.id, { order: undefined })
    })
    toast.show({ message: 'Rutinas ordenadas por uso reciente' })
  }, [r, routines, toast])

  return { duplicate, archive, restore, remove, move, moveTo, clearOrder, applyTemplate }
}
