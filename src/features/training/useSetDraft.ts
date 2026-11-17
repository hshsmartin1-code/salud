/**
 * Thin React bindings over the crash-safe draft core (draft.ts). Use these for EVERY editable field of
 * a live session: they save to Dexie while typing (≤ 150 ms for numbers, ≤ 300 ms for notes) and on
 * blur, page hide, visibility change and unmount, so nothing typed is lost if the app is closed.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TrackingType } from '../../db/catalogTypes'
import type { Repo } from '../../db/repo'
import type { ExerciseSet } from '../../db/types'
import { classifyStoredChange, DraftWriter, NOTE_DRAFT_DELAY_MS, noteValue, SetDraftModel, setDraftKey, type SetDraftField, type SetDraftValues } from './draft'
import { updateExerciseNote } from './session'
import { markSetTouched, registerDraft } from './sessionWork'

/** Flushes on visibilitychange → hidden, pagehide, window blur and unmount. */
export function useFlushOnLeave(flush: () => void) {
  const ref = useRef(flush)
  useEffect(() => {
    ref.current = flush
  })
  useEffect(() => {
    const onHide = () => ref.current()
    const onVis = () => {
      if (document.visibilityState === 'hidden') ref.current()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('blur', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('blur', onHide)
      ref.current()
    }
  }, [])
}

// Only the error type is logged: never values (health data).
const reportError = (e: unknown) => console.warn('No se pudo guardar un cambio de la sesión', e instanceof Error ? e.name : 'error')

export interface SetDraft {
  /** Text shown in each input. */
  text: Record<SetDraftField, string>
  /** Fields whose current text is not a valid value (the stored value is kept). */
  invalid: Partial<Record<SetDraftField, boolean>>
  /** Last valid value of every drafted field (what is or will be stored). */
  values: SetDraftValues
  /** Whether the measure required by the tracking type is present (and nothing is invalid). */
  canComplete: boolean
  change(field: SetDraftField, text: string): void
  /** Writes anything pending now; await it before marking the set done. */
  flush(): Promise<void>
  /** A write failed and has not succeeded since (the value is kept and retried): show "no guardado". */
  failed: boolean
  /** Props for an <input>: value, onChange, onBlur. */
  bind(field: SetDraftField): { value: string; onChange: (e: { target: { value: string } }) => void; onBlur: () => void }
}

/**
 * Draft of one set row's numeric fields (`fields`: any of weight, reps, durationSec, distanceM, rpe,
 * rir). Valid values reach the set row in Dexie within 150 ms.
 */
export function useSetDraft(r: Repo, set: ExerciseSet, tracking: TrackingType, fields: readonly SetDraftField[]): SetDraft {
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const fieldsKey = fields.join(',')
  const setId = set.id
  const sessionId = set.sessionId
  const model = useMemo(
    () => new SetDraftModel({ fields, tracking, initial: set, write: (v) => r.update('exerciseSets', setId, v), onError: reportError }),
    // A new model only for another row, field set or tracking type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, setId, fieldsKey, tracking],
  )
  const storedKey = setDraftKey(set, fields)
  // Live-query updates: own echoes and pending typing are ignored; external changes adopted when idle.
  useEffect(() => {
    if (model.stored(set)) rerender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, model])
  useFlushOnLeave(() => void model.flush())
  // "Terminar" flushes every mounted draft; a failed write re-renders the row to say so.
  useEffect(() => registerDraft(model), [model])
  useEffect(() => model.writer.onFailedChange(rerender), [model])
  const change = useCallback(
    (field: SetDraftField, text: string) => {
      // A valid edit makes the row "touched": finishing offers to keep it (see sessionWork.ts).
      if (model.change(field, text)) markSetTouched(sessionId, setId)
      rerender()
    },
    [model, sessionId, setId],
  )
  const flush = useCallback(() => model.flush(), [model])
  return {
    text: model.text,
    invalid: model.invalid(),
    values: model.values,
    canComplete: model.canComplete(),
    change,
    flush,
    failed: model.writer.failed,
    bind: (field) => ({ value: model.text[field] ?? '', onChange: (e) => change(field, e.target.value), onBlur: () => void flush() }),
  }
}

export interface TextDraft {
  text: string
  change(text: string): void
  flush(): Promise<void>
  bind(): { value: string; onChange: (e: { target: { value: string } }) => void; onBlur: () => void }
}

/** Generic note draft (written within 250 ms). `write` receives the note, or undefined when emptied. */
export function useTextDraft(stored: string | undefined, write: (note: string | undefined) => Promise<void>, identity: string): TextDraft {
  const storedKey = JSON.stringify(stored ?? null)
  const [text, setText] = useState(stored ?? '')
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  })
  const writer = useMemo(
    () => new DraftWriter<string | undefined>({ delayMs: NOTE_DRAFT_DELAY_MS, initialKey: storedKey, key: (v) => JSON.stringify(v ?? null), write: (v) => writeRef.current(v), onError: reportError }),
    // One writer per note (identity), created with the value stored at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity],
  )
  useEffect(() => {
    if (classifyStoredChange(writer, storedKey) === 'ignore') return
    writer.acceptExternal(storedKey)
    setText(stored ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, writer])
  useFlushOnLeave(() => void writer.flush())
  useEffect(() => registerDraft(writer), [writer])
  const change = useCallback(
    (t: string) => {
      setText(t)
      writer.set(noteValue(t))
    },
    [writer],
  )
  const flush = useCallback(() => writer.flush(), [writer])
  return { text, change, flush, bind: () => ({ value: text, onChange: (e) => change(e.target.value), onBlur: () => void flush() }) }
}

/** Note of one set row (`ExerciseSet.notes`). */
export function useSetNoteDraft(r: Repo, set: Pick<ExerciseSet, 'id' | 'notes'>): TextDraft {
  return useTextDraft(set.notes, (note) => r.update('exerciseSets', set.id, { notes: note }), `set:${set.id}`)
}

/** Per-exercise note of a session (`exerciseOrder[].notes`). */
export function useExerciseNoteDraft(r: Repo, sessionId: string, exerciseId: string, stored: string | undefined): TextDraft {
  return useTextDraft(stored, (note) => updateExerciseNote(r, sessionId, exerciseId, note), `ex:${sessionId}:${exerciseId}`)
}

export type { SetDraftField, SetDraftValues }
