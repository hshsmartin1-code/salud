import { describe, expect, it } from 'vitest'
import type { FoodSnapshot } from '../../db/types'
import { buildSnapshot, describeQty, shortQty, unitOptions, type Food } from './food'
import { habitualFor } from './habitual'

const food = (over: Partial<Food> = {}): Food => ({
  ref: 'usda_sr:1', source: 'usda_sr', name: 'Arroz blanco cocido', nameOrig: 'Rice', brand: null, barcode: null, category: null, kind: 'cooked', basis: '100g',
  nutrients: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, portions: [], flags: [], synonyms: '', datasetVersion: 'x', curated: false, englishOnly: false, servingGrams: null, ...over,
})

const snap = (f: Food, qty: number, key: string): FoodSnapshot => {
  const o = unitOptions(f).find((x) => x.key === key)!
  const s = buildSnapshot(f, qty, o)
  if ('error' in s) throw new Error(s.error)
  return s
}

describe('unitOptions through the normaliser', () => {
  const off = food({ ref: 'off:1', source: 'off', name: 'Galletas', brand: 'Marca', kind: 'packaged', portions: [['1 porción (1 portion (150 g))', 150], ['1 porción (150 g)', 150], ['1 unidad (individual school container)', 150], ['Cantidad no especificada', 150]], flags: ['portion_units_checked'] })
  it('shows "porción (150 g)" exactly once and no English', () => {
    const labels = unitOptions(off).map((o) => o.label)
    expect(labels.filter((l) => l === 'porción (150 g)')).toHaveLength(1)
    expect(labels).toContain('unidad (150 g)')
    expect(labels.join(' ')).not.toMatch(/portion|container|school|individual/i)
  })
  it('stores the clean label in a new snapshot', () => {
    const s = snap(off, 2, 'portion:0')
    expect(s.portionLabel).toBe('1 porción (1 portion (150 g))')
    expect(s.grams).toBe(300)
    expect(s.nutrients.kcal).toBeCloseTo(390, 6) // 130 kcal/100 g x 300 g
  })
  it('a 100 g food never offers ml and a 100 ml food never offers g', () => {
    expect(unitOptions(food()).filter((o) => o.unit === 'ml' || o.unit === 'l')).toHaveLength(0)
    const drink = food({ basis: '100ml', portions: [['1 taza', 240]] })
    expect(unitOptions(drink).filter((o) => ['g', 'kg', 'oz', 'lb'].includes(o.unit))).toHaveLength(0)
    expect(unitOptions(drink).map((o) => o.label)).toContain('taza (240 ml)')
  })
})

describe('describeQty and shortQty', () => {
  const f = food({ portions: [['2 tajadas (25 g cada una)', 50], ['1 tajada', 25]] })
  it('a single measure reads "name (each)"; several read "n × name (each)"', () => {
    const one = snap(f, 1, 'portion:1')
    expect(describeQty(one)).toBe('tajada (25 g)')
    expect(shortQty(one)).toBe('tajada')
    const two = snap(f, 2, 'portion:1')
    expect(describeQty(two)).toBe('2 × tajada (25 g)')
    expect(shortQty(two)).toBe('2 × tajada')
  })
  it('old logs keep their label and display through the normaliser', () => {
    const old = { qty: 2, unit: 'portion' as const, portionLabel: '1 porción (1 portion (150 g))', grams: 300, ml: null }
    expect(describeQty(old)).toBe('2 × porción (150 g)')
    expect(shortQty(old)).toBe('2 × porción')
    expect(describeQty({ ...old, qty: 1, grams: 150 })).toBe('porción (150 g)')
  })
  it("a person's own measure keeps its words", () => {
    const mine = { qty: 2, unit: 'portion' as const, portionLabel: 'Mi taza pequeña', portionVerification: 'custom' as const, portionEquivalentAmount: 80, grams: 160, ml: null }
    expect(describeQty(mine)).toBe('2 × Mi taza pequeña (80 g)')
  })
  it('grams, litres and servings are unchanged', () => {
    expect(describeQty({ qty: 150, unit: 'g', portionLabel: null, grams: 150, ml: null })).toBe('150 g')
    expect(describeQty({ qty: 1.5, unit: 'l', portionLabel: null, grams: null, ml: 1500 })).toBe('1,5 L')
    expect(shortQty({ qty: 1, unit: 'serving', portionLabel: null, grams: 30, ml: null })).toBe('1 porción')
  })
})

describe('habitualFor', () => {
  it('uses the last logged quantity with its stored energy', () => {
    const f = food()
    const last = snap(f, 150, 'g')
    const h = habitualFor(f, last)!
    expect([h.from, h.qty, h.kcal]).toEqual(['last', '150 g', '195'])
  })
  it('else the first proper portion, skipping reference quantities', () => {
    const f = food({ portions: [['Cantidad no especificada', 244], ['1 taza', 244]] })
    const h = habitualFor(f)!
    expect([h.from, h.qty]).toEqual(['portion', 'taza'])
    expect(h.kcal).toBe('317')
  })
  it('else 100 g, or 100 ml for a drink, or one serving for a label food', () => {
    expect(habitualFor(food())).toMatchObject({ from: 'basis', qty: '100 g', kcal: '130' })
    expect(habitualFor(food({ basis: '100ml' }))).toMatchObject({ from: 'basis', qty: '100 ml' })
    expect(habitualFor(food({ basis: 'serving', nutrients: { kcal: 90 } }))).toMatchObject({ from: 'basis', qty: '1 porción', kcal: '90' })
  })
  it('a food without energy has no kcal and no invented zero', () => {
    expect(habitualFor(food({ nutrients: { protein: 3 } }))!.kcal).toBeNull()
  })
})
