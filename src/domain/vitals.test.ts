import { describe, expect, it } from 'vitest'
import type { VitalSign } from '../db/types'
import { BP_SINGLE_NOTE, bpAverage, bpAverageCategory, bpCategory, classifyVital, dailySeries, glucoseCategory, latestByKind, spo2Note, validateBloodPressure, validateSingle } from './vitals'

const mk = (o: Partial<VitalSign>): VitalSign => ({
  id: Math.random().toString(36),
  profileId: 'p',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  time: '08:00',
  kind: 'restingHr',
  value: 60,
  unit: 'lpm',
  ...o,
})

describe('bpCategory (ACC/AHA 2017)', () => {
  it.each([
    [110, 70, 'normal'],
    [119, 79, 'normal'],
    [120, 79, 'elevated'],
    [129, 79, 'elevated'],
    [125, 80, 'stage1'],
    [130, 70, 'stage1'],
    [139, 89, 'stage1'],
    [140, 70, 'stage2'],
    [125, 90, 'stage2'],
    [180, 120, 'stage2'],
    [181, 90, 'severe'],
    [150, 121, 'severe'],
  ])('%i/%i -> %s', (s, d, key) => {
    expect(bpCategory(s, d).key).toBe(key)
  })
  it('names the source; > 180/> 120 is the «hipertensión severa» range (AHA/ACC 2025) with urgent-care advice', () => {
    const c = bpCategory(190, 100)
    expect(c.source).toContain('ACC/AHA 2017')
    expect(c.label).toMatch(/hipertensión severa/)
    expect(c.note).toMatch(/atención médica de inmediato/)
  })
  it('a single reading is always labelled «lectura aislada», never a diagnosis', () => {
    for (const [s, d] of [[110, 70], [125, 70], [135, 85], [141, 85], [190, 100]] as const) {
      const c = bpCategory(s, d)
      expect(c.label).toMatch(/lectura aislada/)
      expect(c.label).not.toMatch(/^Hipertensión/)
      expect(c.note).toContain(BP_SINGLE_NOTE)
    }
  })
})

describe('home blood-pressure average (ESH 2023 protocol, ACC/AHA home equivalents)', () => {
  const bp = (date: string, systolic: number, diastolic: number, time = '07:00') => mk({ kind: 'bloodPressure', date, time, systolic, diastolic, value: null, unit: 'mmHg' })
  it('averages every reading of the last 7 days and classifies with home thresholds', () => {
    // 28 Feb is outside the window 1–7 March (inclusive).
    const rows = [bp('2026-02-28', 190, 110), bp('2026-03-05', 134, 84), bp('2026-03-06', 132, 82, '07:00'), bp('2026-03-06', 136, 86, '21:00'), bp('2026-03-07', 138, 88)]
    const a = bpAverage(rows, '2026-03-07')!
    expect(a).toMatchObject({ readings: 4, days: 3, from: '2026-03-01', to: '2026-03-07' })
    expect(a.systolic).toBeCloseTo((134 + 132 + 136 + 138) / 4, 6) // 135
    expect(a.diastolic).toBeCloseTo((84 + 82 + 86 + 88) / 4, 6) // 85
    expect(a.classification.key).toBe('stage2')
    expect(a.classification.source).toMatch(/ESH 2023/)
  })
  it('needs readings on at least 3 days', () => {
    expect(bpAverage([bp('2026-03-06', 120, 80), bp('2026-03-07', 120, 80)], '2026-03-07')).toBeNull()
  })
  it('home equivalents: 135/85 at home is the stage 2 range', () => {
    expect(bpAverageCategory(134, 84).key).toBe('stage1')
    expect(bpAverageCategory(135, 80).key).toBe('stage2')
    expect(bpAverageCategory(128, 85).key).toBe('stage2')
    expect(bpAverageCategory(118, 76).key).toBe('normal')
    expect(bpAverageCategory(124, 76).key).toBe('elevated')
  })
})

describe('glucose / spo2', () => {
  it('only classifies fasting glucose', () => {
    expect(glucoseCategory(110, 'posprandial')).toBeNull()
    expect(glucoseCategory(110, null)).toBeNull()
    expect(glucoseCategory(99, 'ayunas')?.key).toBe('normal')
    expect(glucoseCategory(100, 'ayunas')?.key).toBe('prediabetes-range')
    expect(glucoseCategory(125, 'ayunas')?.key).toBe('prediabetes-range')
    expect(glucoseCategory(126, 'ayunas')?.key).toBe('diabetes-range')
  })
  it('SpO2 without altitude context: < 90 warns, 90–93 is an informative altitude note, ≥ 94 nothing', () => {
    expect(spo2Note(89)).toMatchObject({ key: 'low', tone: 'warn' })
    expect(spo2Note(90)).toMatchObject({ key: 'altitude-range', tone: 'muted' })
    expect(spo2Note(92)?.note).toMatch(/Bogotá/)
    expect(spo2Note(93)?.tone).toBe('muted')
    expect(spo2Note(94)).toBeNull()
  })
  it('classifyVital dispatches by kind', () => {
    expect(classifyVital({ kind: 'bloodPressure', systolic: 118, diastolic: 76, value: null })?.key).toBe('normal')
    expect(classifyVital({ kind: 'temperature', value: 37 })).toBeNull()
    expect(classifyVital({ kind: 'glucose', value: 130, context: 'ayunas' })?.key).toBe('diabetes-range')
  })
})

describe('validation', () => {
  it('blood pressure ranges and ordering', () => {
    expect(validateBloodPressure(120, 80)).toBeNull()
    expect(validateBloodPressure(null, 80)).toMatch(/Ingresa/)
    expect(validateBloodPressure(59, 40)).toMatch(/sistólica/)
    expect(validateBloodPressure(261, 40)).toMatch(/sistólica/)
    expect(validateBloodPressure(120, 29)).toMatch(/diastólica/)
    expect(validateBloodPressure(120, 161)).toMatch(/diastólica/)
    expect(validateBloodPressure(80, 80)).toMatch(/mayor/)
    expect(validateBloodPressure(70, 90)).toMatch(/mayor/)
  })
  it('single values', () => {
    expect(validateSingle('restingHr', 24)).not.toBeNull()
    expect(validateSingle('restingHr', 25)).toBeNull()
    expect(validateSingle('restingHr', 231)).not.toBeNull()
    expect(validateSingle('spo2', 49)).not.toBeNull()
    expect(validateSingle('spo2', 100)).toBeNull()
    expect(validateSingle('spo2', 101)).not.toBeNull()
    expect(validateSingle('glucose', 19)).not.toBeNull()
    expect(validateSingle('glucose', 600)).toBeNull()
    expect(validateSingle('temperature', 32.9)).not.toBeNull()
    expect(validateSingle('temperature', 43)).toBeNull()
    expect(validateSingle('temperature', null)).toMatch(/Ingresa/)
  })
})

describe('latestByKind / dailySeries', () => {
  const rows = [
    mk({ date: '2026-02-01', time: '08:00', value: 60 }),
    mk({ date: '2026-02-03', time: '07:00', value: 58 }),
    mk({ date: '2026-02-03', time: '21:00', value: 64 }),
    mk({ kind: 'spo2', date: '2026-01-20', value: 97, unit: '%' }),
    mk({ kind: 'bloodPressure', date: '2026-02-02', value: null, systolic: 120, diastolic: 80, unit: 'mmHg' }),
  ]
  it('picks the newest reading of each kind (date then time)', () => {
    const l = latestByKind(rows)
    expect(l.restingHr?.value).toBe(64)
    expect(l.spo2?.value).toBe(97)
    expect(l.bloodPressure?.systolic).toBe(120)
    expect(l.glucose).toBeUndefined()
  })
  it('daily series: mean per day, gaps are null not zero', () => {
    expect(dailySeries(rows, 'restingHr', ['2026-02-01', '2026-02-02', '2026-02-03'])).toEqual([60, null, 61])
    expect(dailySeries(rows, 'bloodPressure', ['2026-02-02'])).toEqual([120])
  })
  it('empty input', () => {
    expect(latestByKind([])).toEqual({})
  })
})
