import { describe, expect, it } from 'vitest'
import { PRESET_WINDOW_DAYS, comparisonLabel, loadFrom, normalizePeriod, periodTitle, resolvePeriod, withPeriod, withQuery } from './period'

const TODAY = '2026-11-15'

describe('period in the URL', () => {
  it('defaults to 30 days and rejects garbage', () => {
    expect(normalizePeriod(null, TODAY)).toBe('30')
    expect(normalizePeriod('45', TODAY)).toBe('30')
    expect(normalizePeriod('custom:2026-11-10..2026-11-01', TODAY)).toBe('30')
  })
  it('resolves presets and the previous period of the same length', () => {
    const p = resolvePeriod('7', TODAY)
    expect(p.range).toEqual({ from: '2026-11-09', to: TODAY })
    expect(p.previous).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(p.days).toBe(7)
    expect(periodTitle(p)).toBe('Últimos 7 días')
    expect(comparisonLabel(p)).toBe('vs. 7 d anteriores')
  })
  it('clamps a custom range to today and caps its length', () => {
    expect(normalizePeriod('custom:2026-11-01..2027-01-01', TODAY)).toBe('custom:2026-11-01..2026-11-15')
    const long = resolvePeriod('custom:2024-01-01..2026-11-15', TODAY)
    expect(long.days).toBe(366)
    expect(long.custom).toBe(true)
    expect(comparisonLabel(long)).toBe('vs. periodo anterior')
  })
  it('builds links that keep the period and other parameters', () => {
    expect(withPeriod('/cuerpo', '90', { m: 'waist' })).toBe('/cuerpo?p=90&m=waist')
    expect(withQuery('/sueno?m=schedule', { p: '7' })).toBe('/sueno?m=schedule&p=7')
    expect(withQuery('/sueno?m=schedule', { m: null })).toBe('/sueno')
    const c = withPeriod('/agua', 'custom:2026-11-01..2026-11-10')
    expect(new URLSearchParams(c.split('?')[1]).get('p')).toBe('custom:2026-11-01..2026-11-10')
  })
  it('loads enough history so presets never reload', () => {
    expect(loadFrom(resolvePeriod('90', TODAY), TODAY) <= '2026-05-19').toBe(true)
    expect(PRESET_WINDOW_DAYS).toBeGreaterThanOrEqual(180)
    expect(loadFrom(resolvePeriod('custom:2025-01-01..2025-02-01', TODAY), TODAY) < '2025-01-01').toBe(true)
  })
})
