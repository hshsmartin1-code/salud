/**
 * Where training goes on Hoy, and what it says (pure). Training is state or a plan reminder, never a default
 * recommendation:
 *  - a session in progress: nothing here. The app shell already shows its «Sesión en curso» bar on every layout (above
 *    the bottom navigation on phones, in the sidebar from lg), so Hoy does not repeat it;
 *  - today is a planned training day and nothing is finished today: the one card under the greeting;
 *  - a finished session today: one quiet row at the end, «Entrenamiento hecho»;
 *  - anything else (rest day, no plan): one quiet row at the end with the next planned session, or «Ir a Entreno».
 */
import type { Routine } from '../../db/types'
import { isoWeekday } from '../../domain/dates'
import { offeredRoutine, type StartSuggestion } from '../training/plan/startSuggestion'

const ABBR = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

export type TrainingSlot =
  | { kind: 'active' }
  | { kind: 'due'; title: string; routine: Routine | null; detail: string | null }
  | { kind: 'done'; sessionId: string; name: string }
  | { kind: 'next'; text: string }
  | { kind: 'go' }

/** `jue 19`. */
export const shortDate = (date: string): string => `${ABBR[isoWeekday(date) - 1]} ${Number(date.slice(8, 10))}`

export function trainingSlot(input: {
  active: boolean
  suggestion: StartSuggestion
  /** The latest counted session finished today. */
  doneToday: { id: string; name: string } | null
  /** First planned, not-done date from today (null = no plan or nothing planned soon). */
  next: { date: string; routine: Pick<Routine, 'name'> | null } | null
}): TrainingSlot {
  const { active, suggestion, doneToday, next } = input
  if (active) return { kind: 'active' }
  if (suggestion.kind === 'planned') {
    const planned = suggestion.routine
    const offer = offeredRoutine(suggestion)
    // A days-only day names no routine: the card says «Entrenamiento de hoy» and shows the one it will start.
    return { kind: 'due', title: planned ? planned.name : 'Entrenamiento de hoy', routine: offer, detail: planned ? null : (offer?.name ?? null) }
  }
  if (doneToday) return { kind: 'done', sessionId: doneToday.id, name: doneToday.name }
  if (next) return { kind: 'next', text: `Próxima sesión: ${shortDate(next.date)}${next.routine ? ` · ${next.routine.name}` : ''}` }
  return { kind: 'go' }
}

/** `top` renders under the greeting, `end` after everything else, `none` renders nothing (the shell shows the session bar). */
export const slotPosition = (s: TrainingSlot): 'top' | 'end' | 'none' => (s.kind === 'active' ? 'none' : s.kind === 'due' ? 'top' : 'end')
