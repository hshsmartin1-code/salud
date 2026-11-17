import type { HealthMetric, HealthRecord } from '../../db/types'
import { deviceLabel } from './sources'
import type { HcDailyDay, HcDailyMetric, HcNativeRecord, HcRawType } from './types'

/** A row ready for `repo.bulkPut` (id/profileId/timestamps are stamped by the repo). */
export type HealthRow = Omit<HealthRecord, 'createdAt' | 'updatedAt'>

export const RAW_METRIC: Record<HcRawType, HealthMetric> = {
  ExerciseSession: 'exercise',
  SleepSession: 'sleep',
  Weight: 'weight',
  BodyFat: 'bodyFat',
  LeanBodyMass: 'leanMassKg',
}

const DAILY_UNIT: Record<HcDailyMetric, string> = {
  steps: 'pasos',
  activeKcal: 'kcal',
  distanceM: 'm',
  restingHr: 'lpm',
  heartRateAvg: 'lpm',
}

export const dailyRowId = (profileId: string, metric: HealthMetric, date: string) => `${profileId}|hc:daily:${metric}:${date}`
export const rawRowId = (profileId: string, healthConnectId: string) => `${profileId}|hc:${healthConnectId}`

/** Plausible ranges: out-of-range values are imported but excluded by default (the person can include them). */
const PLAUSIBLE: Partial<Record<HealthMetric, [number, number]>> = {
  weight: [20, 400],
  bodyFat: [2, 70],
  leanMassKg: [10, 250],
  restingHr: [25, 250],
  heartRateAvg: [25, 250],
}
export function isPlausible(metric: HealthMetric, value: number | null): boolean {
  const r = PLAUSIBLE[metric]
  return !r || value === null || (value >= r[0] && value <= r[1])
}

const round = (n: number, d = 0) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}

/** Daily aggregates → rows. Only the metrics requested are produced (a day without a value yields no row). */
export function dailyToRows(profileId: string, days: readonly HcDailyDay[], metrics: readonly HcDailyMetric[], nowIso: string): HealthRow[] {
  const rows: HealthRow[] = []
  for (const day of days) {
    for (const m of metrics) {
      const raw = day.values[m]
      if (raw === undefined || raw === null || !Number.isFinite(raw)) continue
      const value = round(raw)
      const plausible = isPlausible(m, value)
      rows.push({
        id: dailyRowId(profileId, m, day.date),
        profileId,
        provider: 'health-connect',
        kind: 'daily',
        metric: m,
        date: day.date,
        start: null,
        end: null,
        value,
        unit: DAILY_UNIT[m],
        sources: [...new Set(day.origins[m] ?? [])],
        device: null,
        externalId: null,
        lastModified: null,
        title: null,
        // default exclusion only for implausible values; an existing choice is preserved by the merge
        ...(plausible ? {} : { excluded: true }),
        importedAt: nowIso,
      })
    }
  }
  return rows
}

export function rawToRow(profileId: string, rec: HcNativeRecord, nowIso: string): HealthRow {
  const metric = RAW_METRIC[rec.type]
  const value = rec.value === undefined || !Number.isFinite(rec.value) ? null : metric === 'weight' || metric === 'leanMassKg' || metric === 'bodyFat' ? round(rec.value, 2) : round(rec.value)
  const detail: Record<string, number | string | null> = { ...(rec.detail ?? {}) }
  if (rec.recordingMethod) detail.recordingMethod = rec.recordingMethod
  if (rec.exerciseKey) detail.exerciseKey = rec.exerciseKey
  return {
    id: rawRowId(profileId, rec.id),
    profileId,
    provider: 'health-connect',
    kind: 'record',
    metric,
    date: rec.date,
    start: rec.start,
    end: rec.end ?? null,
    value,
    unit: rec.unit ?? '',
    sources: rec.origin ? [rec.origin] : [],
    device: deviceLabel(rec.deviceType, rec.deviceManufacturer, rec.deviceModel),
    externalId: rec.id,
    lastModified: rec.lastModified,
    title: rec.title ?? null,
    detail,
    ...(isPlausible(metric, value) ? {} : { excluded: true }),
    importedAt: nowIso,
  }
}

export function rawToRows(profileId: string, recs: readonly HcNativeRecord[], nowIso: string): HealthRow[] {
  return recs.map((r) => rawToRow(profileId, r, nowIso))
}
