import { describe, expect, it } from 'vitest'
import type { BodyMeasurement } from '../../db/types'
import { measurementDraft, mergeMeasurement, receiveMeasurement, reloadMeasurement } from './measurementEdit'

const row: BodyMeasurement = {
  id: 'measurement-a', profileId: 'profile-a', createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z',
  date: '2026-11-01', time: '08:00', weightKg: 70.123, circumferences: { waist: 80.12, hip: 95 },
  skinfolds: { triceps: 12, thigh: 15 }, protocol: 'sum_custom', derived: null, notes: 'Inicial', origin: 'app',
}
const profile = { sex: 'female' as const, birthDate: '1990-01-01', heightCm: 170 }
const computedAt = '2026-11-16T12:00:00Z'

describe('measurement edit during a sync pull', () => {
  it('initialises once, preserves invalid in-progress text and reloads explicitly', () => {
    const opened = reloadMeasurement(row)
    const typing = { ...opened, draft: { ...opened.draft, weight: '72,' } }
    const incoming = { ...row, weightKg: 74, notes: 'Remota', updatedAt: computedAt }
    expect(receiveMeasurement(typing, incoming)).toBe(typing)
    expect(reloadMeasurement(incoming).draft).toEqual(measurementDraft(incoming))
    expect(receiveMeasurement({ ...opened, loaded: false }, incoming).baseline).toBe(incoming)
  })

  it('saves only edited fields over the latest stored row, without rounding untouched values', () => {
    const initial = measurementDraft(row)
    const remote = { ...row, weightKg: 74.567, notes: 'Remota', updatedAt: computedAt }
    const merged = mergeMeasurement(remote, initial, { ...initial, time: '09:00' }, profile, computedAt)
    expect(merged).toEqual({ ...remote, time: '09:00' })
    expect(remote.time).toBe('08:00')
  })

  it('merges individual circumference and skinfold sites, including explicit clearing', () => {
    const initial = measurementDraft(row)
    const remote = { ...row, circumferences: { ...row.circumferences, hip: 99, neck: 35 }, skinfolds: { triceps: 13, thigh: 16, calf: 10 } }
    const merged = mergeMeasurement(remote, initial, {
      ...initial, circ: { ...initial.circ, waist: '' }, sf: { ...initial.sf, triceps: '14' },
    }, profile, computedAt)
    expect(merged.circumferences).toEqual({ hip: 99, neck: 35 })
    expect(merged.skinfolds).toEqual({ triceps: 14, thigh: 16, calf: 10 })
    expect(merged.derived).toMatchObject({ sum: 40, computedAt })
  })

  it('recalculates derived data from merged inputs rather than the stale form', () => {
    const initial = measurementDraft(row)
    const remote = { ...row, weightKg: 75, skinfolds: { triceps: 20, thigh: 20 } }
    const merged = mergeMeasurement(remote, initial, { ...initial, weight: '72' }, profile, computedAt)
    expect(merged.derived).toMatchObject({ sum: 40, inputs: { weightKg: 72 } })
    expect(merged.skinfolds).toEqual(remote.skinfolds)
  })

  it('preserves remote calculated data when only notes are edited', () => {
    const initial = measurementDraft(row)
    const remote = mergeMeasurement(row, initial, { ...initial, weight: '75' }, profile, computedAt)
    const merged = mergeMeasurement(remote, initial, { ...initial, notes: 'Local' }, profile, computedAt)
    expect(merged.notes).toBe('Local')
    expect(merged.derived).toBe(remote.derived)
    expect(merged.weightKg).toBe(75)
  })

  it('keeps provenance and remote metadata and lets an explicit local edit win the same field', () => {
    const initial = measurementDraft(row)
    const remote = { ...row, notes: 'Remota', origin: 'phase0' as const, approx: true }
    const merged = mergeMeasurement(remote, initial, { ...initial, notes: '' }, profile, computedAt)
    expect(merged).toEqual({ ...remote, notes: undefined })
  })

  it('does not treat a cleared and restored map field as an edit', () => {
    const initial = measurementDraft(row)
    const remote = { ...row, circumferences: { waist: 82, hip: 99 } }
    expect(mergeMeasurement(remote, initial, { ...initial, circ: { ...initial.circ, neck: '' } }, profile, computedAt)).toEqual(remote)
  })
})
