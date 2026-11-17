import { describe, expect, it } from 'vitest'
import type { FoodLog, MealKey } from '../../db/types'
import { habitsForSlot } from './slotHabits'

const TODAY = '2026-11-18'
let n = 0
function log(foodRef: string, date: string, meal: MealKey, extra: Partial<FoodLog> = {}): FoodLog {
  return {
    id: `l${n++}`, profileId: 'p', createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`,
    date, time: '08:00', meal, name: `Alimento ${foodRef}`, foodRef, source: 'user', datasetVersion: undefined, kind: 'generic',
    qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal: 100 }, missing: [], origin: 'app', ...extra,
  } as FoodLog
}
const days = (ref: string, meal: MealKey, dates: string[], extra: Partial<FoodLog> = {}) => dates.map((d) => log(ref, d, meal, extra))
const run = (logs: FoodLog[], over: Partial<{ slot: MealKey; viewed: string }> = {}) => habitsForSlot(logs, { slot: 'desayuno', today: TODAY, viewed: TODAY, ...over })

describe('habitsForSlot', () => {
  it('needs three distinct days: two days give nothing', () => {
    expect(run(days('a', 'desayuno', ['2026-11-17', '2026-11-16']))).toEqual([])
    expect(run(days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-11-15'])).map((h) => h.foodRef)).toEqual(['a'])
  })
  it('counts days, not rows: three rows on one day are one day', () => {
    expect(run([...days('a', 'desayuno', ['2026-11-17', '2026-11-17', '2026-11-17']), log('a', '2026-11-16', 'desayuno')])).toEqual([])
  })
  it("never brings another slot's foods", () => {
    const logs = [...days('a', 'almuerzo', ['2026-11-17', '2026-11-16', '2026-11-15']), ...days('b', 'cena', ['2026-11-17', '2026-11-16', '2026-11-15'])]
    expect(run(logs)).toEqual([])
    expect(run(logs, { slot: 'almuerzo' }).map((h) => h.foodRef)).toEqual(['a'])
  })
  it('a profile with no history gets nothing', () => {
    expect(run([])).toEqual([])
  })
  it('is only for today: another viewed day gives nothing', () => {
    const logs = days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-11-15'])
    expect(run(logs, { viewed: '2026-11-17' })).toEqual([])
    expect(run(logs, { viewed: '2026-11-19' })).toEqual([])
  })
  it('leaves out what is already logged today in that slot, and ignores today for the count', () => {
    const logs = [...days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-11-15']), log('a', TODAY, 'desayuno')]
    expect(run(logs)).toEqual([])
    // logged today in another slot does not hide it from this one
    expect(run([...days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-11-15']), log('a', TODAY, 'cena')]).map((h) => h.foodRef)).toEqual(['a'])
    // today alone never makes a habit
    expect(run(days('a', 'desayuno', [TODAY, '2026-11-17', '2026-11-16']))).toEqual([])
  })
  it('only looks at the last 30 days', () => {
    expect(run(days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-10-01']))).toEqual([])
    expect(run(days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-10-19'])).map((h) => h.foodRef)).toEqual(['a'])
    expect(run(days('a', 'desayuno', ['2026-11-17', '2026-11-16', '2026-10-18']))).toEqual([])
  })
  it('orders by distinct days, then recency, and caps at two', () => {
    const logs = [
      ...days('x', 'desayuno', ['2026-11-10', '2026-11-09', '2026-11-08']),
      ...days('y', 'desayuno', ['2026-11-17', '2026-11-16', '2026-11-15', '2026-11-14']),
      ...days('z', 'desayuno', ['2026-11-12', '2026-11-11', '2026-11-07']),
      ...days('w', 'desayuno', ['2026-11-17', '2026-11-13', '2026-11-12']),
    ]
    expect(run(logs).map((h) => h.foodRef)).toEqual(['y', 'w'])
    expect(run(logs.filter((l) => l.foodRef !== 'y')).map((h) => h.foodRef)).toEqual(['w', 'z'])
  })
  it('carries the amount last used in that slot', () => {
    const logs = [
      log('a', '2026-11-12', 'desayuno', { qty: 50, grams: 50 }),
      log('a', '2026-11-16', 'desayuno', { qty: 80, grams: 80 }),
      log('a', '2026-11-14', 'desayuno', { qty: 60, grams: 60 }),
      log('a', '2026-11-17', 'almuerzo', { qty: 300, grams: 300 }),
    ]
    const [h] = run(logs)
    expect(h?.snapshot.qty).toBe(80)
    expect(h?.days).toBe(3)
    expect(h?.lastDate).toBe('2026-11-16')
  })
})
