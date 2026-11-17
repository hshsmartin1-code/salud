import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo, useRef } from 'react'
import { useProfile, useRepo } from '../../../app/profile'
import { useToday } from '../../../app/useToday'
import { updateProfile } from '../../../db/profiles'
import { db } from '../../../db/schema'
import type { ID, Routine, TrainingPlan } from '../../../db/types'
import { addDays, isoWeekStart } from '../../../domain/dates'
import { sortRoutines } from '../routines'
import { dayStatus, doneDates, hasPlan, nextPlanned, planFor, pruneOverrides, resolveRoutine, sanitizePlan, type DayStatus, type PlanDay } from './plan'

export interface PlanCell {
  date: string
  /** ISO weekday 1 (Monday) … 7 (Sunday). */
  weekday: number
  today: boolean
  past: boolean
  day: PlanDay | null
  status: DayStatus
  /** The active routine the day points at; null for rest, no routine, or a routine that was deleted or archived. */
  routine: Routine | null
}

export interface NextSession {
  date: string
  routineId: ID | null
  routine: Routine | null
}

export interface PlanState {
  /** False while routines and sessions are still loading. */
  ready: boolean
  /** The stored plan, sanitized (undefined = none). */
  plan: TrainingPlan | undefined
  has: boolean
  today: string
  /** Local dates with a counted finished session. */
  done: ReadonlySet<string>
  /** Active routines, in the order of the Entreno home (name order here: no usage history needed). */
  routines: Routine[]
  /** The current week, Monday to Sunday. */
  week: PlanCell[]
  /** Today's cell. */
  todayCell: PlanCell
  /** First training date ≥ today that is not done (so tomorrow's once today is done). Null = nothing planned in 14 days. */
  next: NextSession | null
  /** Writes the plan (undefined removes it). Prunes old overrides, keeps every other setting, never touches sessions. */
  save(next: TrainingPlan | undefined): Promise<void>
  /** Applies `edit` to the freshest stored plan and saves the result (safe for quick consecutive taps). */
  edit(change: (current: TrainingPlan | undefined) => TrainingPlan | undefined): Promise<void>
}

/**
 * The weekly plan of the active profile, resolved against today, the routines and the finished sessions.
 * Read-only for sessions: planning never creates, changes or deletes one.
 */
export function usePlan(): PlanState {
  const profile = useProfile()
  const r = useRepo()
  const today = useToday()
  const routinesRaw = useLiveQuery(() => r.all('routines'), [r])
  const sessions = useLiveQuery(() => r.all('trainingSessions'), [r])
  const stored = profile.settings.training?.plan
  const plan = useMemo(() => sanitizePlan(stored), [stored])
  const done = useMemo<ReadonlySet<string>>(() => (sessions ? doneDates(sessions) : new Set<string>()), [sessions])
  const routines = useMemo(() => sortRoutines(routinesRaw ?? [], new Map()), [routinesRaw])

  const view = useMemo(() => {
    const start = isoWeekStart(today)
    const week: PlanCell[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i)
      const day = planFor(plan, date)
      return { date, weekday: i + 1, today: date === today, past: date < today, day, status: dayStatus(plan, date, done), routine: resolveRoutine(day, routinesRaw) }
    })
    const n = nextPlanned(plan, today, done)
    const next: NextSession | null = n ? { ...n, routine: resolveRoutine({ kind: 'train', routineId: n.routineId }, routinesRaw) } : null
    return { week, todayCell: week.find((c) => c.today)!, next }
  }, [plan, today, done, routinesRaw])

  // Writes go one after another and always start from the freshest stored profile, so two quick taps never undo each other.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const profileId = profile.id
  const edit = useCallback(
    (change: (current: TrainingPlan | undefined) => TrainingPlan | undefined) => {
      const run = () => db.transaction('rw', db.profiles, async () => {
        const cur = await db.profiles.get(profileId)
        if (!cur) return
        const next = change(sanitizePlan(cur.settings.training?.plan))
        const { plan: old, ...training } = cur.settings.training ?? {}
        const cleaned = next === undefined ? undefined : pruneOverrides(next, today)
        const keep = cleaned && hasPlan(cleaned) ? cleaned : undefined
        if (!keep && old === undefined) return // nothing stored, nothing to write
        await updateProfile(profileId, { settings: { ...cur.settings, training: keep ? { ...training, plan: keep } : training } })
      })
      const p = queue.current.then(run, run)
      queue.current = p.catch(() => undefined)
      return p
    },
    [profileId, today],
  )
  const save = useCallback((next: TrainingPlan | undefined) => edit(() => next), [edit])

  return { ready: routinesRaw !== undefined && sessions !== undefined, plan, has: hasPlan(plan), today, done, routines, ...view, save, edit }
}
