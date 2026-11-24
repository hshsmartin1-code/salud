import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRepo } from '../../../app/profile'
import type { ExerciseSet, SessionExercise, TrainingSession } from '../../../db/types'
import { setKind, setKindPatch } from '../../../domain/setKind'
import { useConfirm } from '../../../ui/Confirm'
import { Sheet } from '../../../ui/kit'
import { useToast } from '../../../ui/Toast'
import { ExerciseDetailSheet, ExercisePicker } from '../ExerciseLibrary'
import type { Exercise, useExercises } from '../exercises'
import { addSessionExercise, addSetLikeLast, moveSessionExercise, removeSessionExercise } from '../session'
import { SubstituteSheet } from '../SubstituteSheet'
import type { SessionActions } from './actions'
import { setSignature, workOrdinals } from './model'
import { kindName } from './kinds'
import { useSaveGuard } from './saveGuard'
import { PlateSheet } from './PlateSheet'
import { RestEditSheet, SetMenuSheet, SetNoteSheet } from './sheets'

export type Catalog = ReturnType<typeof useExercises>

/** Rows of each exercise, sorted by setIndex. */
export function groupSets(sets: readonly ExerciseSet[]): Map<string, ExerciseSet[]> {
  const m = new Map<string, ExerciseSet[]>()
  for (const s of sets) m.set(s.exerciseId, [...(m.get(s.exerciseId) ?? []), s])
  for (const rows of m.values()) rows.sort((a, b) => a.setIndex - b.setIndex)
  return m
}

/** Signature of one block: anything it renders (memo comparator of ExerciseBlock). */
export function blockSignature(item: SessionExercise, rows: readonly ExerciseSet[], prs: ReadonlyMap<string, string>): string {
  return `${JSON.stringify(item)}#${rows.map(setSignature).join(';')}#${rows.map((s) => prs.get(s.id) ?? '').join(',')}`
}

export const smoothScroll = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

export interface EditorHooks {
  toggleOpen?: (exerciseId: string, open: boolean) => void
  afterComplete?: SessionActions['afterComplete']
  revealRow?: SessionActions['revealRow']
  /** An exercise was just added through the picker. */
  onAdded?: (exerciseId: string) => void
}

/**
 * Editing of a session's exercises and sets, shared by the live session and the finished session's
 * "Editar" mode: the stable actions object for blocks and rows, and the sheets they open.
 */
export function useSessionEditor(session: TrainingSession, sets: readonly ExerciseSet[], ex: Catalog, hooks: EditorHooks = {}) {
  const r = useRepo()
  const toast = useToast()
  const confirm = useConfirm()
  const guard = useSaveGuard()
  const [picker, setPicker] = useState(false)
  const [detail, setDetail] = useState<Exercise | null>(null)
  const [subFor, setSubFor] = useState<SessionExercise | null>(null)
  const [menuSetId, setMenuSetId] = useState<string | null>(null)
  const [noteSetId, setNoteSetId] = useState<string | null>(null)
  const [platesSetId, setPlatesSetId] = useState<string | null>(null)
  const [restEditId, setRestEditId] = useState<string | null>(null)

  const byExercise = useMemo(() => groupSets(sets), [sets])
  // Latest state for the stable actions object (rows and blocks never re-render because of it).
  const latest = useRef({ session, byExercise, ex, hooks })
  useLayoutEffect(() => {
    latest.current = { session, byExercise, ex, hooks }
  })

  const actions = useMemo<SessionActions>(() => {
    const itemOf = (id: string) => latest.current.session.exerciseOrder.find((o) => o.exerciseId === id)
    return {
      openDetail: (id) => {
        const e = latest.current.ex.byId.get(id)
        if (e) setDetail(e)
        else toast.show({ message: 'Este ejercicio ya no está en la biblioteca.' })
      },
      toggleOpen: (id, open) => latest.current.hooks.toggleOpen?.(id, open),
      openSetMenu: setMenuSetId,
      openSetNote: setNoteSetId,
      openRestEdit: setRestEditId,
      substitute: (id) => setSubFor(itemOf(id) ?? null),
      move: (id, d) => void guard(moveSessionExercise(r, latest.current.session.id, id, d)),
      remove: async (id) => {
        const item = itemOf(id)
        if (!item) return
        const done = (latest.current.byExercise.get(id) ?? []).filter((s) => s.done).length
        const ok = await confirm({
          title: `¿Quitar ${item.name}?`,
          body: done ? `Se borrarán también ${done === 1 ? 'la serie registrada' : `sus ${done} series registradas`} en esta sesión.` : 'Sus series pendientes se quitan de esta sesión.',
          confirmLabel: 'Quitar ejercicio',
          tone: 'danger',
        })
        if (ok) await guard(removeSessionExercise(r, latest.current.session.id, id))
      },
      addSet: (id) => {
        const item = itemOf(id)
        if (item) void guard(addSetLikeLast(r, latest.current.session, item, latest.current.ex.aliases))
      },
      afterComplete: (set, restSec) => latest.current.hooks.afterComplete?.(set, restSec),
      revealRow: (el) => latest.current.hooks.revealRow?.(el),
    }
  }, [r, toast, confirm, guard])

  const order = session.exerciseOrder
  const menuSet = menuSetId ? (sets.find((s) => s.id === menuSetId) ?? null) : null
  const platesSet = platesSetId ? (sets.find((s) => s.id === platesSetId) ?? null) : null
  const noteSet = noteSetId ? (sets.find((s) => s.id === noteSetId) ?? null) : null
  const setTitle = (s: ExerciseSet | null) => {
    if (!s) return ''
    const rows = byExercise.get(s.exerciseId) ?? []
    const n = workOrdinals(rows)[rows.findIndex((x) => x.id === s.id)] ?? 0
    return `${kindName(setKind(s), n)} · ${s.exerciseName}`
  }
  const restItem = restEditId ? (order.find((o) => o.exerciseId === restEditId) ?? null) : null

  const sheets: ReactNode = (
    <>
      <Sheet open={picker} onClose={() => setPicker(false)} title="Agregar ejercicio" wide>
        <ExercisePicker
          onSelect={async (e) => {
            setPicker(false)
            if (await guard(addSessionExercise(r, session.id, e, ex.aliases))) latest.current.hooks.onAdded?.(e.id)
          }}
          selectedIds={order.map((o) => o.exerciseId)}
        />
      </Sheet>
      <ExerciseDetailSheet exercise={detail} onClose={() => setDetail(null)} />
      <SubstituteSheet item={subFor} session={session} sets={sets as ExerciseSet[]} onClose={() => setSubFor(null)} />
      <SetMenuSheet
        set={menuSet}
        title={setTitle(menuSet)}
        onClose={() => setMenuSetId(null)}
        onKind={(k) => {
          if (menuSet) void guard(r.update('exerciseSets', menuSet.id, setKindPatch(k)))
          setMenuSetId(null)
        }}
        onPlates={
          menuSet && ex.byId.get(menuSet.exerciseId)?.equipment === 'barbell'
            ? () => {
                setMenuSetId(null)
                setPlatesSetId(menuSet.id)
              }
            : undefined
        }
        onNote={() => {
          setMenuSetId(null)
          setNoteSetId(menuSet?.id ?? null)
        }}
        onDelete={async () => {
          const id = menuSet?.id
          setMenuSetId(null)
          if (!id) return
          const row = await r.get('exerciseSets', id)
          if (!row) return
          if ((await guard(r.remove('exerciseSets', id).then(() => true))) !== true) return
          // Undo puts back the exact row (same id, values, type and creation time).
          toast.show({ message: 'Serie eliminada', actionLabel: 'Deshacer', onAction: () => void guard(r.put('exerciseSets', row)) })
        }}
      />
      <PlateSheet set={platesSet} title={platesSet ? `Discos · ${platesSet.exerciseName}` : ''} onClose={() => setPlatesSetId(null)} />
      <SetNoteSheet set={noteSet} title={noteSet ? `Nota · ${setTitle(noteSet)}` : ''} onClose={() => setNoteSetId(null)} />
      <RestEditSheet sessionId={session.id} item={restItem} onClose={() => setRestEditId(null)} />
    </>
  )

  return { actions, sheets, byExercise, openPicker: () => setPicker(true) }
}
