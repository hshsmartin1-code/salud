import { createContext, useContext } from 'react'
import type { ExerciseSet } from '../../../db/types'

/**
 * Everything a block or a row can ask the screen to do. The object is created once per screen and
 * reads the latest state through refs, so passing it never breaks the memoisation of rows and blocks.
 */
export interface SessionActions {
  openDetail(exerciseId: string): void
  toggleOpen(exerciseId: string, open: boolean): void
  openSetMenu(setId: string): void
  openSetNote(setId: string): void
  openRestEdit(exerciseId: string): void
  substitute(exerciseId: string): void
  move(exerciseId: string, delta: -1 | 1): void
  remove(exerciseId: string): void
  addSet(exerciseId: string): void
  /** A set was just marked done: rest timer, haptic tick. */
  afterComplete(set: ExerciseSet, restSec: number): void
  /** Keeps a focused row (and its done button) clear of the sticky bar and the keyboard. */
  revealRow(el: HTMLElement): void
}

export const SessionActionsContext = createContext<SessionActions | null>(null)

export function useSessionActions(): SessionActions {
  const a = useContext(SessionActionsContext)
  if (!a) throw new Error('SessionActionsContext ausente')
  return a
}
