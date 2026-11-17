import { describe, expect, it } from 'vitest'
import type { FoodLog } from '../../db/types'
import { lastLogByFood, lastMealBefore, suggestForMeal } from './suggestions'

let n = 0
function log(over: Partial<FoodLog> & Pick<FoodLog, 'foodRef' | 'date' | 'meal'>): FoodLog {
  n++
  return {
    id: `l${n}`, profileId: 'p', createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, updatedAt: '', name: over.foodRef, source: 'usda_sr',
    qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal: 100 }, missing: [], time: null, ...over,
  } as FoodLog
}

describe('suggestForMeal', () => {
  const D = '2026-11-15'
  it('ranks by frequency in that meal, ties by recency, and carries the most recent snapshot', () => {
    const logs = [
      log({ foodRef: 'a', date: '2026-11-10', meal: 'desayuno', qty: 100 }),
      log({ foodRef: 'a', date: '2026-11-12', meal: 'desayuno', qty: 150 }),
      log({ foodRef: 'b', date: '2026-11-13', meal: 'desayuno' }),
      log({ foodRef: 'c', date: '2026-11-11', meal: 'desayuno' }),
      log({ foodRef: 'z', date: '2026-11-11', meal: 'cena' }),
      log({ foodRef: 'z', date: '2026-11-12', meal: 'cena' }),
      log({ foodRef: 'z', date: '2026-11-13', meal: 'cena' }),
    ]
    const s = suggestForMeal(logs, 'desayuno', D)
    expect(s.map((x) => x.foodRef)).toEqual(['a', 'b', 'c'])
    expect(s[0]!.count).toBe(2)
    expect(s[0]!.snapshot.qty).toBe(150)
    expect(s[0]!.lastDate).toBe('2026-11-12')
  })
  it('excludes foods already logged in that meal on that date, but not in another meal', () => {
    const logs = [
      log({ foodRef: 'a', date: '2026-11-12', meal: 'desayuno' }),
      log({ foodRef: 'b', date: '2026-11-12', meal: 'desayuno' }),
      log({ foodRef: 'a', date: D, meal: 'desayuno' }),
      log({ foodRef: 'b', date: D, meal: 'cena' }),
    ]
    expect(suggestForMeal(logs, 'desayuno', D).map((x) => x.foodRef)).toEqual(['b'])
    expect(suggestForMeal(logs, 'desayuno', D, { excludeLogged: false }).map((x) => x.foodRef).sort()).toEqual(['a', 'b'])
  })
  it('only looks at the last 60 days before the viewed date, and never at later days', () => {
    const logs = [
      log({ foodRef: 'old', date: '2026-09-15', meal: 'desayuno' }), // 61 days before
      log({ foodRef: 'edge', date: '2026-09-16', meal: 'desayuno' }), // 60 days before
      log({ foodRef: 'later', date: '2026-11-16', meal: 'desayuno' }),
    ]
    expect(suggestForMeal(logs, 'desayuno', D).map((x) => x.foodRef)).toEqual(['edge'])
  })
  it('caps the list at 6', () => {
    const logs = Array.from({ length: 9 }, (_, i) => log({ foodRef: `f${i}`, date: '2026-11-12', meal: 'almuerzo' }))
    expect(suggestForMeal(logs, 'almuerzo', D)).toHaveLength(6)
    expect(suggestForMeal(logs, 'almuerzo', D, { cap: 4 })).toHaveLength(4)
  })
})

describe('lastMealBefore', () => {
  it('finds the most recent earlier day with that meal, with count and kcal', () => {
    const logs = [
      log({ foodRef: 'a', date: '2026-11-13', meal: 'desayuno', nutrients: { kcal: 200 } }),
      log({ foodRef: 'a', date: '2026-11-14', meal: 'almuerzo', nutrients: { kcal: 900 } }),
      log({ foodRef: 'b', date: '2026-11-12', meal: 'desayuno', nutrients: { kcal: 50 } }),
      log({ foodRef: 'c', date: '2026-11-13', meal: 'desayuno', nutrients: { kcal: 73 } }),
      log({ foodRef: 'd', date: '2026-11-15', meal: 'desayuno', nutrients: { kcal: 5 } }),
    ]
    const m = lastMealBefore(logs, 'desayuno', '2026-11-15')!
    expect(m.date).toBe('2026-11-13')
    expect(m.count).toBe(2)
    expect(m.kcal).toBe(273)
    expect(m.kcalPartial).toBe(false)
    expect(lastMealBefore(logs, 'cena', '2026-11-15')).toBeNull()
    expect(lastMealBefore(logs, 'desayuno', '2026-11-12')).toBeNull()
  })
  it('flags a partial energy total', () => {
    const logs = [log({ foodRef: 'a', date: '2026-11-13', meal: 'cena', nutrients: { kcal: 10 } }), log({ foodRef: 'b', date: '2026-11-13', meal: 'cena', nutrients: {}, missing: ['kcal'] })]
    expect(lastMealBefore(logs, 'cena', '2026-11-15')!.kcalPartial).toBe(true)
  })
})

describe('lastLogByFood', () => {
  it('prefers the newest log in the meal, else the newest anywhere, and has no entry for unseen foods', () => {
    const logs = [
      log({ foodRef: 'a', date: '2026-11-10', meal: 'cena', qty: 1 }),
      log({ foodRef: 'a', date: '2026-11-05', meal: 'desayuno', qty: 2 }),
      log({ foodRef: 'b', date: '2026-11-05', meal: 'onces', qty: 3 }),
      log({ foodRef: 'b', date: '2026-11-11', meal: 'onces', qty: 4 }),
    ]
    const m = lastLogByFood(logs, 'desayuno')
    expect(m.get('a')!.qty).toBe(2)
    expect(m.get('b')!.qty).toBe(4)
    expect(m.has('zzz')).toBe(false)
  })
})
