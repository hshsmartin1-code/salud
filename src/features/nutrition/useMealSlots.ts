import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useProfile, useRepo } from '../../app/profile'
import { updateProfile } from '../../db/profiles'
import { db } from '../../db/schema'
import type { MealKey } from '../../db/types'
import { addDays, nowLocalTime } from '../../domain/dates'
import { useToday } from '../../app/useToday'
import { subscribeMealClock } from './mealClock'
import { chooserSlots, resolveSlots, slotForTime, toPrefs, USED_WINDOW_DAYS, visibleSlots, type MealSlot } from './mealSlots'

/**
 * The meal slots of the active profile: every screen that lists meals, names one or picks the meal of the hour
 * goes through here. Without stored preferences the slots are breakfast, lunch, dinner and any slot used in the
 * last 30 days.
 */
export function useMealSlots() {
  const profile = useProfile()
  const r = useRepo()
  const today = useToday()
  const stored = profile.settings.meals
  // Only a profile without preferences needs the recent logs (to keep the slots it already uses).
  const used = useLiveQuery(
    async () => (stored ? [] : (await r.range('foodLogs', addDays(today, -USED_WINDOW_DAYS), today)).map((l) => l.meal)),
    [r, today, stored === undefined],
  )
  const slots = useMemo(() => resolveSlots(stored, used ?? []), [stored, used])
  const nowKey = useSyncExternalStore(
    subscribeMealClock,
    () => slotForTime(slots, nowLocalTime()).key,
    () => slotForTime(slots, nowLocalTime()).key,
  )
  const labels = useMemo(() => Object.fromEntries(slots.map((s) => [s.key, s.label])) as Record<MealKey, string>, [slots])
  const label = useCallback((key: MealKey) => labels[key] ?? key, [labels])
  const lower = useCallback((key: MealKey) => (labels[key] ?? key).toLowerCase(), [labels])
  const save = useCallback(
    (next: readonly MealSlot[] | null) => {
      return db.transaction('rw', db.profiles, async () => {
        const current = await db.profiles.get(profile.id)
        if (!current) return
        const { meals: _old, ...rest } = current.settings
        void _old
        await updateProfile(profile.id, { settings: next ? { ...rest, meals: toPrefs(next) } : rest })
      })
    },
    [profile.id],
  )
  return {
    /** All six, in display order, with `on`. */
    slots,
    /** The slot of the hour (always an active one); follows the clock. */
    now: slots.find((s) => s.key === nowKey) ?? slots[0]!,
    label,
    lower,
    /** Names by key, for places that cannot call the hook (sync conflict labels). */
    labels,
    /** Active slots plus any slot with entries in `logs`. */
    visible: (logs: readonly { meal: MealKey }[]) => visibleSlots(slots, logs),
    /** Active slots plus `current` when it is hidden (a chooser while editing a row). */
    choices: (...current: (MealKey | null | undefined)[]) => chooserSlots(slots, ...current),
    customised: stored !== undefined,
    save,
  }
}
