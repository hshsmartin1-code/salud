import { describe, expect, it } from 'vitest'
import { keepRecord, mapPhase0, parsePhase0, type P0File, type P0Record } from './phase0'

let k = 0
function rec(p: Partial<P0Record>): P0Record {
  return {
    record_id: `T-${k++}`,
    profile_id: 'A',
    measurement_date: '2026-03-01',
    date_precision: 'exact',
    record_kind: 'raw_measurement',
    metric: 'body_weight',
    value: 70,
    unit: 'kg',
    value_text: null,
    value_type: 'measured',
    measurement_method: null,
    data_quality: 'ok',
    exclude_from_stats: false,
    duplicate_of: null,
    flags: [],
    ...p,
  } as P0Record
}

function file(parts: Partial<P0File>): P0File {
  return parsePhase0(
    JSON.stringify({
      schema_version: 'phase0-1.0',
      generated_at: '2026-01-01T00:00:00',
      profiles: [{ profile_id: 'A', display_name: 'Sintético', sex: 'male', height_cm: 175, birth_date: null }],
      ...parts,
    }),
  )
}

const target = { id: 'prof-1', sex: 'male' as const, birthDate: '1995-06-15', heightCm: 175 }
const TODAY = '2026-11-15'

describe('phase0 filter', () => {
  it('drops duplicates, invalid, planned/placeholder/prefilled, imprecise and future records', () => {
    expect(keepRecord(rec({}), TODAY)).toBe(true)
    expect(keepRecord(rec({ duplicate_of: 'X' }), TODAY)).toBe(false)
    expect(keepRecord(rec({ data_quality: 'invalid' }), TODAY)).toBe(false)
    for (const t of ['planned', 'placeholder', 'prefilled']) expect(keepRecord(rec({ value_type: t }), TODAY)).toBe(false)
    expect(keepRecord(rec({ date_precision: 'month' }), TODAY)).toBe(false)
    expect(keepRecord(rec({ date_precision: 'unknown' }), TODAY)).toBe(false)
    expect(keepRecord(rec({ measurement_date: null }), TODAY)).toBe(false)
    expect(keepRecord(rec({ measurement_date: '2026-12-01' }), TODAY)).toBe(false)
  })
})

describe('phase0 mapping', () => {
  it('groups body records per date, prefers fasting weight and keeps derived apart', () => {
    const f = file({
      body_measurements: [
        rec({ metric: 'body_weight', value: 71, record_kind: 'body_weight_daily', measurement_method: 'daily scale' }),
        rec({ metric: 'body_weight', value: 70.4, measurement_method: "fasting scale weight ('Peso ayunas kg')" }),
        rec({ metric: 'waist_circumference', value: 80, unit: 'cm' }),
        ...['triceps', 'subscapular', 'biceps', 'suprailiac', 'supraspinale', 'abdominal', 'calf'].map((s) => rec({ metric: `skinfold_${s}`, value: 10, unit: 'mm' })),
        rec({ metric: 'body_weight', value: 99, value_type: 'planned' }),
      ],
    })
    const out = mapPhase0(f, 'A', target, TODAY)
    expect(out.bodyMeasurements).toHaveLength(1)
    const m = out.bodyMeasurements[0]!
    expect(m.id).toBe('phase0:prof-1:body:2026-03-01')
    expect(m.weightKg).toBe(70.4)
    expect(m.circumferences.waist).toBe(80)
    expect(m.protocol).toBe('isak7_calf')
    expect(m.derived?.estimated).toBe(true)
    expect(m.derived?.sum).toBe(70)
    expect(m.derived?.bodyFatPct).toBeUndefined() // ISAK: sum only, no invented % fat
  })

  it('imports daily kcal as imported totals and sessions without rest days', () => {
    const f = file({
      food_entries: [
        rec({ metric: 'energy_intake', value: 2100, unit: 'kcal', value_type: 'self_reported' }),
        rec({ metric: 'energy_intake', value: 1900, unit: 'kcal', value_type: 'placeholder' }),
      ],
      training_sessions: [
        rec({ metric: 'session_type_done', value: null, value_text: 'UPPER A', value_type: 'self_reported', measurement_date: '2026-03-02' }),
        rec({ metric: 'session_type_done', value: null, value_text: 'Descanso', value_type: 'self_reported', measurement_date: '2026-03-03' }),
      ],
    })
    const out = mapPhase0(f, 'A', target, TODAY)
    expect(out.importedDaily.filter((d) => d.metric === 'kcal_intake').map((d) => d.value)).toEqual([2100])
    expect(out.trainingSessions.map((s) => s.name)).toEqual(['UPPER A'])
    expect(out.importedDaily.filter((d) => d.metric === 'training_done')).toHaveLength(2)
  })

  it('prefers exact wearable kcal over chart readings and marks chart data as approximate', () => {
    const f = file({
      activity_records: [
        rec({ metric: 'active_energy_band', value: 450, data_quality: 'chart_read_approx', exclude_from_stats: true, value_type: 'device_estimate' }),
        rec({ metric: 'active_energy_band', value: 500, value_type: 'device_estimate' }),
        rec({ metric: 'steps', value: 8000, value_type: 'device_estimate' }),
        rec({ metric: 'active_energy_band', value: 300, data_quality: 'chart_read_approx', exclude_from_stats: true, value_type: 'device_estimate', measurement_date: '2026-03-05' }),
      ],
      sleep_records: [rec({ metric: 'sleep_onset_time', value: -30, data_quality: 'chart_read_approx', value_type: 'device_estimate' })],
    })
    const out = mapPhase0(f, 'A', target, TODAY)
    const day1 = out.activityLogs.find((a) => a.date === '2026-03-01')!
    expect(day1.activeKcal).toBe(500)
    expect(day1.steps).toBe(8000)
    expect(day1.approx).toBe(false)
    const day2 = out.activityLogs.find((a) => a.date === '2026-03-05')!
    expect(day2.approx).toBe(true)
    expect(day2.excludeFromStats).toBe(true)
    expect(out.sleepLogs[0]!.bedtime).toBe('23:30')
    expect(out.sleepLogs[0]!.excludeFromStats).toBe(true)
  })

  it('only maps the requested profile letter and is deterministic', () => {
    const f = file({ body_measurements: [rec({ profile_id: 'B', value: 60 }), rec({ value: 70 })] })
    const a1 = mapPhase0(f, 'A', target, TODAY)
    const a2 = mapPhase0(f, 'A', target, TODAY)
    expect(a1.bodyMeasurements.map((m) => m.weightKg)).toEqual([70])
    expect(a1.bodyMeasurements.map((m) => m.id)).toEqual(a2.bodyMeasurements.map((m) => m.id))
  })

  it('rejects other files', () => {
    expect(() => parsePhase0('{"format":"pho-backup"}')).toThrow(/fase 0/)
  })
})
