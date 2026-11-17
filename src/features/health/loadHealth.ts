/**
 * Reads only what the Salud dashboard needs, with `[profileId+date]` range queries, and tells which
 * metrics have data. One async function to call inside `useLiveQuery`.
 */
import type { Repo } from '../../db/repo'
import { METRIC_IDS, type MetricId } from './metrics'
import { addDays } from '../../domain/dates'
import { buildSeries, type HealthInput } from './series'

/**
 * Rows of [from, to] (pass the previous period start as `from` to also get the comparison data), plus `warmupDays` (default 60) of weight history before `from` for the smoothed trend, plus
 * the profile (height, goals) and the habits list. Sleep is read by wake-up date, like everywhere else.
 */
export async function loadHealthInput(r: Repo, from: string, to: string, warmupDays = 60): Promise<HealthInput> {
  const warmFrom = addDays(from, -Math.max(0, warmupDays))
  const warm = warmupDays > 0 ? [r.range('bodyMeasurements', warmFrom, addDays(from, -1)), r.range('healthRecords', warmFrom, addDays(from, -1))] : [Promise.resolve([]), Promise.resolve([])]
  const [body, activity, sleep, recovery, vitals, hydration, health, habitLogs, habits, profile, warmBody, warmHealth] = await Promise.all([
    r.range('bodyMeasurements', from, to),
    r.range('activityLogs', from, to),
    r.range('sleepLogs', from, to),
    r.range('recoveryLogs', from, to),
    r.range('vitals', from, to),
    r.range('hydrationLogs', from, to),
    r.range('healthRecords', from, to),
    r.range('habitLogs', from, to),
    r.all('habits'),
    r.db.profiles.get(r.profileId),
    ...warm,
  ])
  return {
    profile: profile ? { heightCm: profile.heightCm, settings: profile.settings } : null,
    // The weight history before `from` is only for the smoothed trend (see weightHistory); other series ignore dates outside their range.
    body: [...warmBody, ...body] as typeof body,
    activity,
    sleep,
    recovery,
    vitals,
    hydration,
    health: [...(warmHealth as typeof health).filter((h) => h.metric === 'weight'), ...health],
    habits,
    habitLogs,
  }
}

/** Metrics with at least one point in [from, to] and the ones without (registry order). */
export function metricsWithData(input: HealthInput, from: string, to: string): { withData: MetricId[]; withoutData: MetricId[] } {
  const withData: MetricId[] = []
  const withoutData: MetricId[] = []
  for (const id of METRIC_IDS) (buildSeries(id, input, from, to).some((p) => p.value !== null) ? withData : withoutData).push(id)
  return { withData, withoutData }
}
