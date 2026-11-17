import type { HealthCategory, HealthMetric } from '../../db/types'

/** Raw (non-summed) record types the native plugin can read. Everything else is a daily aggregate. */
export type HcRawType = 'ExerciseSession' | 'SleepSession' | 'Weight' | 'BodyFat' | 'LeanBodyMass'
/** Metrics computed by Health Connect as per-day aggregates (de-duplicated between apps by the person's priority). */
export type HcDailyMetric = 'steps' | 'activeKcal' | 'distanceM' | 'restingHr' | 'heartRateAvg'

export type HcUnavailableReason = 'web' | 'android-version' | 'not-installed' | 'update-required' | 'unknown'

export interface HcStatus {
  available: boolean
  /** Present when `available` is false. */
  reason?: HcUnavailableReason
  sdkInt?: number
}

export type HcRecordingMethod = 'active' | 'automatic' | 'manual' | 'unknown'

/** One raw record as sent by the native plugin (nulls are omitted). */
export interface HcNativeRecord {
  /** Health Connect `metadata.id`. */
  id: string
  type: HcRawType
  lastModified: string
  /** `metadata.dataOrigin.packageName`. */
  origin: string
  recordingMethod?: HcRecordingMethod
  clientRecordId?: string
  deviceType?: string
  deviceManufacturer?: string
  deviceModel?: string
  start: string
  end?: string
  /** Local calendar date YYYY-MM-DD (start; wake-up date for sleep). */
  date: string
  value?: number
  unit?: string
  title?: string
  /** Exercise only: stable key (running, walking, …). */
  exerciseKey?: string
  /** Display-only extras (exercise: activeKcal/distanceM; sleep: stage minutes). Never daily totals. */
  detail?: Record<string, number | string>
}

export interface HcDailyDay {
  date: string
  values: Partial<Record<HcDailyMetric, number>>
  origins: Partial<Record<HcDailyMetric, string[]>>
}

export interface HcChanges {
  expired: boolean
  upserts: HcNativeRecord[]
  /** Health Connect ids (the type is unknown for deletions). */
  deletedIds: string[]
  nextToken: string
  hasMore: boolean
}

export interface HealthConnectPlugin {
  getStatus(): Promise<HcStatus>
  openInstallOrUpdate(): Promise<void>
  openSettings(): Promise<void>
  getGrantedPermissions(): Promise<{ granted: string[] }>
  /** Native validates against a read-only whitelist. */
  requestReadPermissions(o: { permissions: string[] }): Promise<{ granted: string[] }>
  revokeAll(): Promise<void>
  readDailyAggregates(o: { from: string; to: string; metrics: HcDailyMetric[] }): Promise<{ days: HcDailyDay[]; skipped: HcDailyMetric[] }>
  readRecords(o: { type: HcRawType; from: string; to: string; pageToken?: string }): Promise<{ records: HcNativeRecord[]; pageToken?: string }>
  getChangesToken(o: { type: HcRawType }): Promise<{ token: string }>
  getChanges(o: { token: string }): Promise<HcChanges>
}

export type { HealthCategory, HealthMetric }
