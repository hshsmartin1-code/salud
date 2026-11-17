import { describe, expect, it } from 'vitest'
import type { FoodLog } from '../../db/types'
import { initialDraft, planCopy } from './copyPrevious'

describe('copying a fraction without editing its quantity', () => {
  it.each([1 / 3, 2 / 3, 0.0004, 0.0000001, 1e-21, 12.123456])('preserves the full frozen snapshot for quantity %s', (qty) => {
    const source: FoodLog = {
      id: 'source', profileId: 'profile-a', createdAt: '2026-11-15T12:00:00Z', updatedAt: '2026-11-15T12:00:00Z',
      date: '2026-11-15', time: '07:00', meal: 'desayuno', foodRef: 'food-a', name: 'Alimento sintético',
      source: 'user', kind: 'generic', qty, unit: 'portion', grams: 100 * qty, ml: null,
      nutrients: { kcal: 123.456, protein: 7 }, missing: ['fiber'], origin: 'app',
    }
    Object.freeze(source.nutrients)
    Object.freeze(source.missing)
    Object.freeze(source)
    const copy = planCopy([source], initialDraft([source]))
    expect(copy.ok).toBe(true)
    expect(copy.entries[0]!.snapshot).toEqual(source)
    expect(copy.kcal.source).toBe(123.456)
  })
})
