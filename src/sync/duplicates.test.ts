import { describe, expect, it } from 'vitest'
import { findProbableDuplicates, SKIPPABLE_DUPLICATE_TABLES } from './duplicates'

const meal = (id: string, over: Record<string, unknown> = {}) => ({ id, date: '2026-11-10', meal: 'almuerzo', foodRef: 'usda:1', name: 'Arroz', qty: 100, unit: 'g', grams: 100, ml: null, ...over })

describe('probable duplicates between this device and the account', () => {
  it('food logs: same date, meal, food and grams; anything else differs is not a duplicate', () => {
    const local = [meal('l1'), meal('l2', { grams: 150, qty: 150 }), meal('l3', { meal: 'cena' }), meal('l4', { date: '2026-11-11' }), meal('l5', { foodRef: 'usda:2' })]
    const remote = [meal('r1', { name: 'Arroz blanco', nutrients: { kcal: 1 } }), meal('r2', { grams: 151 }), meal('r3', { meal: 'almuerzo' })]
    expect(findProbableDuplicates('foodLogs', local, remote)).toEqual([{ localId: 'l1', remoteId: 'r1' }])
  })

  it('pairs one to one: two copies on one side and one on the other give one pair', () => {
    const out = findProbableDuplicates('foodLogs', [meal('a'), meal('b')], [meal('x')])
    expect(out).toEqual([{ localId: 'a', remoteId: 'x' }])
    expect(findProbableDuplicates('foodLogs', [meal('a'), meal('b')], [meal('x'), meal('y')])).toHaveLength(2)
  })

  it('a row with the same id on both sides is the same row, not a duplicate', () => {
    expect(findProbableDuplicates('foodLogs', [meal('same')], [meal('same')])).toEqual([])
  })

  it('liquids compare ml; entries without grams or ml compare quantity and unit', () => {
    const drink = (id: string, ml: number) => meal(id, { grams: null, ml, unit: 'ml', qty: ml })
    expect(findProbableDuplicates('foodLogs', [drink('l', 250)], [drink('r', 250)])).toHaveLength(1)
    expect(findProbableDuplicates('foodLogs', [drink('l', 250)], [drink('r', 300)])).toHaveLength(0)
    const unit = (id: string, qty: number) => meal(id, { grams: null, ml: null, unit: 'unidad', qty })
    expect(findProbableDuplicates('foodLogs', [unit('l', 2)], [unit('r', 2)])).toHaveLength(1)
    expect(findProbableDuplicates('foodLogs', [unit('l', 2)], [unit('r', 1)])).toHaveLength(0)
  })

  it('body weight: same date and weight; other measurements must match too', () => {
    const w = (id: string, over: Record<string, unknown> = {}) => ({ id, date: '2026-11-10', weightKg: 70.4, circumferences: {}, skinfolds: {}, ...over })
    expect(findProbableDuplicates('bodyMeasurements', [w('l')], [w('r', { time: '09:00' })])).toHaveLength(1)
    expect(findProbableDuplicates('bodyMeasurements', [w('l')], [w('r', { weightKg: 70.5 })])).toHaveLength(0)
    expect(findProbableDuplicates('bodyMeasurements', [w('l')], [w('r', { date: '2026-11-09' })])).toHaveLength(0)
    expect(findProbableDuplicates('bodyMeasurements', [w('l')], [w('r', { circumferences: { waist: 80 } })])).toHaveLength(0)
    expect(findProbableDuplicates('bodyMeasurements', [w('l', { weightKg: null })], [w('r', { weightKg: null })])).toHaveLength(0)
  })

  it('training sessions: start times at most 2 minutes apart, closest first; no start time, no match', () => {
    const s = (id: string, startedAt: string | null) => ({ id, date: '2026-11-10', name: 'Pierna', startedAt })
    const local = [s('l1', '2026-11-10T12:00:00.000Z'), s('l2', '2026-11-10T18:00:00.000Z'), s('l3', null)]
    const remote = [s('r1', '2026-11-10T12:01:30.000Z'), s('r0', '2026-11-10T11:59:50.000Z'), s('r2', '2026-11-10T18:02:01.000Z'), s('r3', null)]
    expect(findProbableDuplicates('trainingSessions', local, remote)).toEqual([{ localId: 'l1', remoteId: 'r0' }])
    // Time zone offsets in the stored start times are compared as instants.
    expect(findProbableDuplicates('trainingSessions', [s('l', '2026-11-10T07:00:00-05:00')], [s('r', '2026-11-10T12:01:00.000Z')])).toHaveLength(1)
  })

  it('water: same date, time and amount', () => {
    const h = (id: string, over: Record<string, unknown> = {}) => ({ id, date: '2026-11-10', time: '08:00', ml: 250, ...over })
    expect(findProbableDuplicates('hydrationLogs', [h('l')], [h('r')])).toHaveLength(1)
    expect(findProbableDuplicates('hydrationLogs', [h('l')], [h('r', { time: '08:05' })])).toHaveLength(0)
    expect(findProbableDuplicates('hydrationLogs', [h('l')], [h('r', { ml: 500 })])).toHaveLength(0)
  })

  it('only standalone records can be left out of the merge; sessions carry their sets', () => {
    expect([...SKIPPABLE_DUPLICATE_TABLES].sort()).toEqual(['bodyMeasurements', 'foodLogs', 'hydrationLogs'])
  })
})
