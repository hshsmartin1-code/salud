import { useLiveQuery } from 'dexie-react-hooks'
import { useProfile, useRepo } from '../../app/profile'
import { useToday } from '../../app/useToday'

/** Today's water total (ml) and the profile goal (null = not defined). `totalMl` is null while loading. */
export function useTodayHydration(): { totalMl: number | null; goalMl: number | null; entries: number } {
  const r = useRepo()
  const profile = useProfile()
  const today = useToday()
  const rows = useLiveQuery(() => r.onDate('hydrationLogs', today), [r, today])
  return {
    totalMl: rows ? rows.reduce((s, l) => s + l.ml, 0) : null,
    goalMl: profile.settings.waterGoalMl ?? null,
    entries: rows?.length ?? 0,
  }
}
