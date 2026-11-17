import { describe, expect, it } from 'vitest'
import type { HealthRecord } from '../../db/types'
import { ALL_PERMISSIONS, activeCategories, CATEGORIES, dailyMetricsFor, grantedCategories, permissionsFor, rawTypesFor } from './categories'
import { dailyRowId, dailyToRows, isPlausible, rawRowId, rawToRow } from './mapper'
import { planSync } from './plan'
import { deviceLabel, exerciseLabel, isPhoneSource, PHONE_LABEL, sourceLabel, sourceLabels } from './sources'
import { dailyHealthSummary, latestHealthWeight } from './summary'
import { HealthConnectWeb } from './web'

const NOW = '2026-11-15T12:00:00.000Z'

describe('categories → permissions', () => {
  it('maps each category to read-only permissions', () => {
    expect(permissionsFor(['activity'])).toEqual([
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
      'android.permission.health.READ_DISTANCE',
    ])
    expect(permissionsFor(['sleep'])).toEqual(['android.permission.health.READ_SLEEP'])
    expect(permissionsFor(['body'])).toHaveLength(3)
  })
  it('never asks for writes, history, background or total calories', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(p).toMatch(/^android\.permission\.health\.READ_/)
      expect(p).not.toMatch(/HISTORY|BACKGROUND|TOTAL_CALORIES|WRITE/)
    }
  })
  it('deduplicates the union', () => {
    expect(permissionsFor(['activity', 'activity', 'heart'])).toHaveLength(5)
  })
  it('a category is granted only when all its permissions are', () => {
    const act = permissionsFor(['activity'])
    expect(grantedCategories(act)).toEqual(['activity'])
    expect(grantedCategories(act.slice(0, 2))).toEqual([])
    expect(grantedCategories([...ALL_PERMISSIONS])).toEqual(CATEGORIES.map((c) => c.id))
  })
  it('enabled categories that lost a permission drop out', () => {
    const granted = [...permissionsFor(['activity']), ...permissionsFor(['body']).slice(1)]
    expect(activeCategories({ activity: true, body: true, sleep: false }, granted)).toEqual(['activity'])
  })
  it('derives daily metrics and raw types per category', () => {
    expect(dailyMetricsFor(['activity', 'heart'])).toEqual(['steps', 'activeKcal', 'distanceM', 'restingHr', 'heartRateAvg'])
    expect(rawTypesFor(['exercise', 'sleep', 'body'])).toEqual(['ExerciseSession', 'SleepSession', 'Weight', 'BodyFat', 'LeanBodyMass'])
    expect(rawTypesFor(['activity'])).toEqual([])
  })
})

describe('source labels', () => {
  it('labels the phone', () => {
    expect(sourceLabel('android')).toBe(PHONE_LABEL)
    expect(sourceLabel('com.android.healthconnect.phone.jd5bdd37e1a8d3667a05d0abebfc4a89e')).toBe('Este teléfono')
    expect(isPhoneSource('androidx.foo')).toBe(false)
  })
  it('maps known packages and falls back to the package name', () => {
    expect(sourceLabel('com.sec.android.app.shealth')).toBe('Samsung Health')
    expect(sourceLabel('org.example.unknown')).toBe('org.example.unknown')
    expect(sourceLabels(['android', 'com.android.healthconnect.phone.abc', 'org.example.unknown'])).toEqual(['Este teléfono', 'org.example.unknown'])
  })
  it('builds device labels', () => {
    expect(deviceLabel('watch', 'Acme', 'W1')).toBe('Reloj · Acme W1')
    expect(deviceLabel(undefined, undefined, undefined)).toBeNull()
    expect(deviceLabel('unknown', 'Acme')).toBe('Acme')
  })
  it('labels exercises', () => {
    expect(exerciseLabel('running')).toBe('Carrera')
    expect(exerciseLabel('???')).toBe('Otro entrenamiento')
    expect(exerciseLabel('running', 'Mi trote')).toBe('Mi trote')
  })
})

describe('sync planning', () => {
  it('first sync reads the whole 30-day window', () => {
    expect(planSync('2026-11-15', null)).toEqual({ kind: 'first', dailyFrom: '2026-10-17', today: '2026-11-15', rawFrom: '2026-10-17' })
  })
  it('incremental recomputes the last 7 days', () => {
    const p = planSync('2026-11-15', '2026-11-14')
    expect(p.kind).toBe('incremental')
    expect(p.dailyFrom).toBe('2026-11-09')
    expect(p.rawFrom).toBe('2026-11-13')
  })
  it('goes back further when the last sync was long ago, never past 30 days', () => {
    expect(planSync('2026-11-15', '2026-11-01').dailyFrom).toBe('2026-10-31')
    expect(planSync('2026-11-15', '2026-11-01').rawFrom).toBe('2026-10-31')
    expect(planSync('2026-11-15', '2026-08-01').dailyFrom).toBe('2026-10-17')
    expect(planSync('2026-11-15', '2026-08-01').rawFrom).toBe('2026-10-17')
  })
})

describe('mapping native payloads → rows', () => {
  it('daily aggregates get deterministic ids and only requested metrics', () => {
    const rows = dailyToRows(
      'p1',
      [{ date: '2026-11-14', values: { steps: 8123.4, activeKcal: 312.6, restingHr: 58 }, origins: { steps: ['android', 'android'], activeKcal: ['com.example.band'] } }],
      ['steps', 'activeKcal', 'distanceM'],
      NOW,
    )
    expect(rows.map((r) => r.id)).toEqual(['p1|hc:daily:steps:2026-11-14', 'p1|hc:daily:activeKcal:2026-11-14'])
    expect(rows[0]).toMatchObject({ kind: 'daily', metric: 'steps', value: 8123, unit: 'pasos', sources: ['android'], externalId: null })
    expect(rows[1]).toMatchObject({ value: 313, unit: 'kcal', sources: ['com.example.band'] })
    expect(dailyRowId('p1', 'steps', '2026-11-14')).toBe(rows[0]!.id)
  })
  it('raw records keep the Health Connect id, origin, device and recording method', () => {
    const row = rawToRow(
      'p1',
      {
        id: 'abc-1',
        type: 'ExerciseSession',
        lastModified: '2026-11-14T10:00:00Z',
        origin: 'com.example.band',
        recordingMethod: 'automatic',
        deviceType: 'watch',
        deviceManufacturer: 'Acme',
        deviceModel: 'W1',
        start: '2026-11-14T08:00:00Z',
        end: '2026-11-14T08:45:00Z',
        date: '2026-11-14',
        value: 45,
        unit: 'min',
        exerciseKey: 'running',
        detail: { activeKcal: 380, distanceM: 6200 },
      },
      NOW,
    )
    expect(row).toMatchObject({
      id: rawRowId('p1', 'abc-1'),
      externalId: 'abc-1',
      kind: 'record',
      metric: 'exercise',
      sources: ['com.example.band'],
      device: 'Reloj · Acme W1',
      value: 45,
      lastModified: '2026-11-14T10:00:00Z',
    })
    expect(row.detail).toMatchObject({ activeKcal: 380, distanceM: 6200, recordingMethod: 'automatic', exerciseKey: 'running' })
    expect(row.id).toBe('p1|hc:abc-1')
  })
  it('implausible values are imported but excluded by default', () => {
    expect(isPlausible('weight', 700)).toBe(false)
    const row = rawToRow('p1', { id: 'w', type: 'Weight', lastModified: NOW, origin: 'x', start: NOW, date: '2026-11-14', value: 700, unit: 'kg' }, NOW)
    expect(row.excluded).toBe(true)
    const ok = rawToRow('p1', { id: 'w2', type: 'Weight', lastModified: NOW, origin: 'x', start: NOW, date: '2026-11-14', value: 70.123, unit: 'kg' }, NOW)
    expect(ok.excluded).toBeUndefined()
    expect(ok.value).toBe(70.12)
  })
})

function hr(p: Partial<HealthRecord>): HealthRecord {
  return {
    id: 'x',
    profileId: 'p1',
    createdAt: NOW,
    updatedAt: NOW,
    provider: 'health-connect',
    kind: 'daily',
    metric: 'steps',
    date: '2026-11-14',
    start: null,
    end: null,
    value: 1,
    unit: '',
    sources: [],
    externalId: null,
    lastModified: null,
    importedAt: NOW,
    ...p,
  }
}

describe('dailyHealthSummary', () => {
  const rows: HealthRecord[] = [
    hr({ id: '1', metric: 'steps', value: 9000, date: '2026-11-14' }),
    hr({ id: '2', metric: 'activeKcal', value: 400, date: '2026-11-14' }),
    hr({ id: '3', metric: 'distanceM', value: 6500, date: '2026-11-14' }),
    hr({ id: '4', metric: 'restingHr', value: 57, date: '2026-11-14' }),
    hr({ id: '5', kind: 'record', metric: 'sleep', value: 400, date: '2026-11-14', start: '2026-11-13T23:00:00Z' }),
    hr({ id: '6', kind: 'record', metric: 'sleep', value: 30, date: '2026-11-14', start: '2026-11-14T15:00:00Z' }),
    hr({ id: '7', kind: 'record', metric: 'weight', value: 70.4, date: '2026-11-14', start: '2026-11-14T06:00:00Z' }),
    hr({ id: '8', kind: 'record', metric: 'weight', value: 70.9, date: '2026-11-14', start: '2026-11-14T20:00:00Z' }),
    hr({ id: '9', metric: 'steps', value: 123, date: '2026-11-13', excluded: true }),
    // exercise kcal never feed the daily total
    hr({ id: '10', kind: 'record', metric: 'exercise', value: 45, date: '2026-11-14', detail: { activeKcal: 380 } }),
  ]
  it('returns one entry per date with per-metric values', () => {
    const s = dailyHealthSummary(rows, '2026-11-13', '2026-11-15')
    expect(s.map((d) => d.date)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15'])
    expect(s[1]).toEqual({ date: '2026-11-14', steps: 9000, activeKcal: 400, distanceM: 6500, restingHr: 57, sleepMinutes: 430, weightKg: 70.9 })
  })
  it('skips excluded rows and leaves empty days null', () => {
    const s = dailyHealthSummary(rows, '2026-11-13', '2026-11-15')
    expect(s[0]!.steps).toBeNull()
    expect(s[2]).toEqual({ date: '2026-11-15', steps: null, activeKcal: null, distanceM: null, restingHr: null, sleepMinutes: null, weightKg: null })
  })
  it('latest weight ignores excluded rows', () => {
    expect(latestHealthWeight(rows)).toEqual({ date: '2026-11-14', kg: 70.9 })
    expect(latestHealthWeight(rows.map((r) => (r.metric === 'weight' ? { ...r, excluded: true } : r)))).toBeNull()
  })
})

describe('web fallback', () => {
  it('reports unavailable and rejects everything else in Spanish', async () => {
    const w = new HealthConnectWeb()
    expect(await w.getStatus()).toEqual({ available: false, reason: 'web' })
    await expect(w.readRecords()).rejects.toThrow(/solo está disponible en la app de Android/)
    await expect(w.requestReadPermissions()).rejects.toThrow(/Android/)
  })
})
