import { describe, expect, it } from 'vitest'
import type { FoodLog, MealKey } from '../../db/types'
import { resizeSnapshot } from '../../domain/foodSnapshot'
import { datesWithSlot, initialDraft, planCopy, rowsOf, unitText } from './copyPrevious'

let n = 0
function row(over: Partial<FoodLog> & { date: string; meal: MealKey }): FoodLog {
  n++
  return {
    id: `r${n}`, profileId: 'p', createdAt: `2026-11-10T10:00:${String(n % 60).padStart(2, '0')}.000Z`, updatedAt: '2026-11-10T10:00:00.000Z',
    time: '08:00', name: `Alimento ${n}`, foodRef: `f${n}`, source: 'user', kind: 'generic', qty: 100, unit: 'g', grams: 100, ml: null,
    nutrients: { kcal: 200, protein: 10 }, missing: ['fiber'], origin: 'app', ...over,
  } as FoodLog
}

describe('which date and which foods', () => {
  const logs = [
    row({ date: '2026-11-17', meal: 'almuerzo' }),
    row({ date: '2026-11-17', meal: 'cena' }),
    row({ date: '2026-11-14', meal: 'almuerzo' }),
    row({ date: '2026-11-18', meal: 'almuerzo' }),
    row({ date: '2026-11-19', meal: 'almuerzo' }),
    row({ date: '2026-11-10', meal: 'desayuno' }),
  ]
  it('lists earlier dates with entries in that slot, newest first, never the target day or later', () => {
    expect(datesWithSlot(logs, 'almuerzo', '2026-11-18')).toEqual(['2026-11-17', '2026-11-14'])
    expect(datesWithSlot(logs, 'desayuno', '2026-11-18')).toEqual(['2026-11-10'])
    expect(datesWithSlot(logs, 'onces', '2026-11-18')).toEqual([])
  })
  it('takes only that slot on that date, in the order eaten', () => {
    const a = row({ date: '2026-11-17', meal: 'almuerzo', time: '13:30', name: 'B' })
    const b = row({ date: '2026-11-17', meal: 'almuerzo', time: '12:10', name: 'A' })
    const c = row({ date: '2026-11-17', meal: 'cena', time: '12:00', name: 'C' })
    expect(rowsOf([a, b, c], 'almuerzo', '2026-11-17').map((r) => r.name)).toEqual(['A', 'B'])
    expect(rowsOf([a, b, c], 'almuerzo', '2026-11-16')).toEqual([])
  })
})

describe('planCopy', () => {
  const a = row({ date: '2026-11-17', meal: 'almuerzo', qty: 150, grams: 150, nutrients: { kcal: 195, protein: 4 }, name: 'Arroz' })
  const b = row({ date: '2026-11-17', meal: 'almuerzo', qty: 2, unit: 'portion', portionLabel: 'tajada', grams: 50, nutrients: { kcal: 120 }, name: 'Pan', note: 'tostado', approx: true })
  const c = row({ date: '2026-11-17', meal: 'almuerzo', qty: 200, unit: 'ml', grams: null, ml: 200, nutrients: { kcal: 90, fiber: 1 }, name: 'Jugo' })
  const rows = [a, b, c]

  it('starts with everything ticked and the quantities as eaten', () => {
    const d = initialDraft(rows)
    expect(Object.values(d.checked)).toEqual([true, true, true])
    expect(d.qty[a.id]).toBe('150')
    const plan = planCopy(rows, d)
    expect(plan.ok).toBe(true)
    expect(plan.count).toBe(3)
    expect(plan.entries.map((e) => e.snapshot)).toEqual(rows) // frozen snapshots, untouched
    expect(plan.entries[1]).toMatchObject({ time: '08:00', note: 'tostado' })
  })
  it('copies only the ticked rows', () => {
    const d = initialDraft(rows)
    d.checked[b.id] = false
    const plan = planCopy(rows, d)
    expect(plan.entries.map((e) => e.snapshot.name)).toEqual(['Arroz', 'Jugo'])
    expect(plan.count).toBe(2)
  })
  it('a changed quantity goes through resizeSnapshot, in its own unit; unknown nutrients stay unknown', () => {
    const d = initialDraft(rows)
    d.qty[a.id] = '225'
    d.qty[b.id] = '1,5'
    const plan = planCopy(rows, d)
    expect(plan.ok).toBe(true)
    expect(plan.entries[0]!.snapshot).toEqual(resizeSnapshot(a, 225))
    expect(plan.entries[0]!.snapshot.nutrients.kcal).toBeCloseTo(292.5)
    expect(plan.entries[0]!.snapshot.nutrients.fiber).toBeUndefined()
    expect(plan.entries[1]!.snapshot).toMatchObject({ qty: 1.5, unit: 'portion', portionLabel: 'tajada', grams: 37.5, approx: true })
    expect(plan.entries[1]!.snapshot.nutrients.kcal).toBeCloseTo(90)
    expect(plan.kcal[a.id]).toBeCloseTo(292.5)
    expect(plan.entries[2]!.snapshot).toBe(c) // untouched
  })
  it('uses the app decimal rule: a comma is the decimal mark and a dot groups thousands', () => {
    const d = initialDraft([a])
    d.qty[a.id] = '150,5'
    expect(planCopy([a], d).entries[0]!.snapshot.qty).toBe(150.5)
    d.qty[a.id] = '1.200'
    expect(planCopy([a], d).entries[0]!.snapshot.qty).toBe(1200) // never silently 1,2
    d.qty[a.id] = '6.000'
    const plan = planCopy([a], d)
    expect(plan.ok).toBe(false) // 6000 g of one food is out of range
    expect(plan.errors[a.id]).toBeTruthy()
  })
  it('rejects empty, unreadable, zero and out-of-range quantities for ticked rows only', () => {
    for (const bad of ['', 'abc', '0', '-3', '6000']) {
      const d = initialDraft([a, c])
      d.qty[a.id] = bad
      const plan = planCopy([a, c], d)
      expect(plan.ok, bad).toBe(false)
      expect(plan.errors[a.id], bad).toBeTruthy()
      expect(plan.entries).toHaveLength(1)
    }
    const d = initialDraft([a, c])
    d.qty[a.id] = '6000'
    d.checked[a.id] = false
    expect(planCopy([a, c], d)).toMatchObject({ ok: true, count: 1, errors: {} })
  })
  it('nothing ticked is not a copy', () => {
    const d = initialDraft(rows)
    for (const r of rows) d.checked[r.id] = false
    expect(planCopy(rows, d)).toMatchObject({ ok: false, count: 0 })
  })
  it('names the unit each amount is counted in', () => {
    expect(unitText(a)).toBe('g')
    expect(unitText(c)).toBe('ml')
    expect(unitText(b)).toBe('tajada')
    expect(unitText(row({ date: 'x', meal: 'cena', unit: 'serving' }))).toBe('porción')
    expect(unitText(row({ date: 'x', meal: 'cena', unit: 'l' }))).toBe('L')
  })
})
