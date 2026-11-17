import { describe, expect, it } from 'vitest'
import type { HealthRecord } from '../../db/types'
import { formatMinutes, formatValue, rowSubtitle, rowTitle } from './format'

const base: HealthRecord = {
  id: 'p|hc:1',
  profileId: 'p',
  createdAt: '',
  updatedAt: '',
  provider: 'health-connect',
  kind: 'record',
  metric: 'weight',
  date: '2026-11-14',
  start: null,
  end: null,
  value: 70.46,
  unit: 'kg',
  sources: ['com.android.healthconnect.phone.abc'],
  externalId: '1',
  lastModified: null,
  importedAt: '',
}

describe('formatting imported rows', () => {
  it('formats values with units', () => {
    expect(formatValue({ metric: 'distanceM', value: 6500 })).toBe('6,5 km')
    expect(formatValue({ metric: 'weight', value: 70.46 })).toBe('70,5 kg')
    expect(formatValue({ metric: 'sleep', value: 430 })).toBe('7 h 10 min')
    expect(formatValue({ metric: 'steps', value: null })).toBe('—')
    expect(formatMinutes(45)).toBe('45 min')
  })
  it('titles and subtitles show the source and keep session kcal informative', () => {
    expect(rowTitle(base)).toBe('Peso · 70,5 kg')
    const s = rowSubtitle({ ...base, device: 'Báscula', detail: { recordingMethod: 'manual' } }, (d) => d)
    expect(s).toBe('2026-11-14 · Este teléfono · Báscula · manual')
    const ex: HealthRecord = { ...base, metric: 'exercise', value: 45, title: null, detail: { exerciseKey: 'running', activeKcal: 380, distanceM: 6200 }, sources: ['x.y'] }
    expect(rowTitle(ex)).toBe('Carrera · 45 min')
    expect(rowSubtitle(ex, (d) => d)).toContain('380 kcal · 6,2 km (solo informativo)')
    expect(rowSubtitle({ ...base, kind: 'daily', metric: 'steps', value: 5 }, (d) => d)).toContain('total del día')
  })
})
