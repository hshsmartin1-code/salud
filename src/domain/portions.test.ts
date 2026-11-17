import { describe, expect, it } from 'vitest'
import { legacyPortion, portionEquivalent, portionForFood, validHouseholdPortion, type HouseholdPortion } from './portions'
import { buildSnapshot, unitOptions, type Food } from '../features/nutrition/food'

const food = { ref: 'usda_sr:1', basis: '100g' as const, brand: null, kind: 'raw' as const, source: 'usda_sr' as const }
const portion: HouseholdPortion = {
  id: 'p1', foodRef: food.ref, label: '2 unidades', quantity: 2, unit: 'unidades',
  equivalentAmount: 30.25, equivalentUnit: 'g', kind: 'household', source: 'usda_sr',
  verification: 'standard', foodKind: 'raw',
}

describe('household portions', () => {
  it('scales fractions and multiples of the displayed measure without early rounding', () => {
    expect(portionEquivalent(portion, 0.5)).toBe(15.125)
    expect(portionEquivalent(portion, 2)).toBe(60.5)
    expect(portionEquivalent({ ...portion, equivalentAmount: 1e308 }, 2)).toBeNull()
  })
  it('rejects invalid and incomplete records safely', () => {
    expect(validHouseholdPortion({ ...portion, id: null })).toBe(false)
    expect(validHouseholdPortion({ ...portion, equivalentUnit: 'cups' })).toBe(false)
    expect(validHouseholdPortion({ ...portion, equivalentAmount: Infinity })).toBe(false)
    expect(validHouseholdPortion({ ...portion, source: 'unknown' })).toBe(false)
    expect(portionEquivalent(portion, 0)).toBeNull()
  })
  it('confines a source measure to its exact food, state, brand and basis', () => {
    expect(portionForFood(portion, food)).toBe(true)
    expect(portionForFood(portion, { ...food, ref: 'usda_sr:2', kind: 'cooked' })).toBe(false)
    expect(portionForFood(portion, { ...food, kind: 'cooked' })).toBe(false)
    expect(portionForFood(portion, { ...food, basis: '100ml' })).toBe(false)
    expect(portionForFood({ ...portion, brand: 'Marca A' }, food)).toBe(false)
  })
  it('keeps package measures food specific', () => {
    expect(legacyPortion({ ...food, source: 'off', basis: '100g', flags: ['portion_units_checked'] }, 'Envase completo', 250, 0)).toMatchObject({
      kind: 'package', equivalentAmount: 250, equivalentUnit: 'g', verification: 'derived',
    })
    expect(legacyPortion({ ...food, source: 'off' }, 'Envase completo', 250, 0)).toBeNull()
    expect(legacyPortion({ ...food, source: 'off' }, '1 porción (10 ml)', 10, 0)).toBeNull()
  })
  it('offers validated measures ahead of legacy options and freezes the selected equivalent', () => {
    const f: Food = { ...food, source: 'usda_sr', name: 'Prueba', nameOrig: 'Prueba', barcode: null,
      category: null, nutrients: { kcal: 100 }, portions: [['1 taza', 40]], householdPortions: [portion],
      flags: [], synonyms: '', datasetVersion: 'test', curated: false, englishOnly: false, servingGrams: null }
    const opts = unitOptions(f)
    expect(opts.findIndex((o) => o.portionId === 'p1')).toBeLessThan(opts.findIndex((o) => o.key === 'portion:0'))
    const selected = opts.find((o) => o.portionId === 'p1')!
    const snap = buildSnapshot(f, 0.5, selected)
    expect(snap).toMatchObject({ grams: 15.125, portionId: 'p1', portionEquivalentAmount: 30.25,
      portionEquivalentUnit: 'g', nutrients: { kcal: 15.125 } })
    expect(buildSnapshot(f, 1, { ...selected, portionEquivalentUnit: 'ml' })).toHaveProperty('error')
    expect(buildSnapshot(f, 1e308, { ...selected, portionGrams: 1e308 })).toHaveProperty('error')
  })
})
