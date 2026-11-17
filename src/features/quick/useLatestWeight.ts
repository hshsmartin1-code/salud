import { useLiveQuery } from 'dexie-react-hooks'
import { useRepo } from '../../app/profile'
import { addDays } from '../../domain/dates'
import { useToday } from '../../app/useToday'
import { weightByDay } from '../dashboard/controlCenter'

/**
 * Latest daily weight (hand-entered first, Health Connect as fallback), the same rule Hoy and Salud use to
 * prefill the quick weight sheet. Only queries while `enabled` (the "+" sheet or the weight sheet is open).
 */
export function useLatestWeight(enabled: boolean): { kg: number; date: string } | null {
  const r = useRepo()
  const today = useToday()
  const latest = useLiveQuery(async () => {
    if (!enabled) return null
    const from = addDays(today, -60)
    const [body, health] = await Promise.all([r.range('bodyMeasurements', from, today), r.range('healthRecords', from, today)])
    const last = weightByDay(body, health).filter((d) => d.value !== null).at(-1)
    return last ? { kg: last.value as number, date: last.date } : null
  }, [r, enabled, today])
  return latest ?? null
}
