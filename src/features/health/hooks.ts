import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { useToday } from '../../app/useToday'
import { loadHealthInput } from './loadHealth'
import { PERIOD_PARAM, loadFrom, resolvePeriod, type ResolvedPeriod } from './period'
import type { HealthInput } from './series'

/** The Salud period from the URL (`?p=`), and a setter that keeps every other query parameter. */
export function usePeriod(): { period: ResolvedPeriod; setPeriod: (v: string) => void; today: string } {
  const [params, setParams] = useSearchParams()
  // Updates at local midnight and when the app resumes (see useToday).
  const today = useToday()
  const raw = params.get(PERIOD_PARAM)
  const period = useMemo(() => resolvePeriod(raw, today), [raw, today])
  const setPeriod = useCallback(
    (v: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(PERIOD_PARAM, v)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return { period, setPeriod, today }
}

/**
 * Rows for the period and the one before it (plus the weight warm-up), live. The window is wide enough for
 * every preset, so switching 7 / 30 / 90 days only recomputes. `undefined` until the first load.
 */
export function useHealthInput(period: ResolvedPeriod, today: string): HealthInput | undefined {
  const r = useRepo()
  const from = loadFrom(period, today)
  const data = useLiveQuery(() => loadHealthInput(r, from, today), [r, from, today])
  // Keep the last result while a wider custom window loads (no flash of skeletons).
  const last = useRef<{ r: unknown; data: HealthInput } | undefined>(undefined)
  if (data) last.current = { r, data }
  return data ?? (last.current?.r === r ? last.current.data : undefined)
}

/** A tab/sub-selection kept in the URL (`?m=`), validated against the allowed values. Other parameters stay. */
export function useQueryChoice<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(name)
  const value = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback
  const set = useCallback(
    (v: T) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(name, v)
          return next
        },
        { replace: true },
      ),
    [name, setParams],
  )
  return [value, set]
}
