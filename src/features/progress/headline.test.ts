import { describe, expect, it } from 'vitest'
import { headlineOf, headlinePeriod } from './headline'

const d = (date: string, value: number | null, span?: number) => ({ date, value, span })

describe('Progreso headline', () => {
  it('sum metrics: mean of complete days, today (partial) excluded', () => {
    const h = headlineOf([d('2026-11-13', 2000), d('2026-11-14', 2200), d('2026-11-16', 1289)], 'sum', '2026-11-16')
    expect(h.value).toBe(2100)
    expect(h.n).toBe(2)
    expect(h.label).toBe('Media diaria')
    expect(h.partialExcluded).toBe(true)
  })
  it('sum metrics: only today logged gives no mean instead of the partial value', () => {
    const h = headlineOf([d('2026-11-16', 1289)], 'sum', '2026-11-16')
    expect(h.value).toBeNull()
    expect(headlinePeriod(h, 'Últimos 90 días', '2026-11-16', (x) => x)).toBe('Media diaria · sin periodos completos')
  })
  it('weekly volume: the current week (span < 7) is left out', () => {
    const h = headlineOf([d('2026-11-02', 20000, 7), d('2026-11-09', 24000, 7), d('2026-11-16', 3000, 1)], 'sum', '2026-11-16', true)
    expect(h.value).toBe(22000)
    expect(h.label).toBe('Media semanal')
  })
  it('level metrics: latest value with its date, even if it is today', () => {
    const h = headlineOf([d('2026-11-10', 82), d('2026-11-14', 81.2), d('2026-11-12', null)], 'level', '2026-11-16')
    expect(h.value).toBe(81.2)
    expect(headlinePeriod(h, 'Últimos 90 días', '2026-11-16', (x) => `fecha ${x}`)).toBe('Último valor (fecha 2026-11-14) · Últimos 90 días')
    const t = headlineOf([d('2026-11-16', 80)], 'level', '2026-11-16')
    expect(headlinePeriod(t, 'P', '2026-11-16', (x) => x)).toBe('Último valor (hoy) · P')
  })
})
