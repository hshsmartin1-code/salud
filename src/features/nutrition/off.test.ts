import { describe, expect, it } from 'vitest'
import { offToRefFood } from './off'

describe('offToRefFood', () => {
  it('converts units: minerals g to mg, vitamins g to µg, sodium from salt', () => {
    const r = offToRefFood({
      code: '7700000000001',
      product_name: 'Galletas de prueba',
      brands: 'Marca X, Otra',
      quantity: '300 g',
      serving_quantity: 30,
      serving_size: '30 g',
      nutriments: {
        'energy-kcal_100g': 450,
        proteins_100g: 7,
        carbohydrates_100g: 65,
        fat_100g: 18,
        salt_100g: 1,
        calcium_100g: 0.12,
        'vitamin-a_100g': 0.0003,
      },
    })
    if (!('food' in r)) throw new Error('expected food')
    const f = r.food
    expect(f.nutrients.kcal).toBe(450)
    expect(f.nutrients.sodium).toBe(400)
    expect(f.flags).toContain('sodium_from_salt')
    expect(f.nutrients.calcium).toBe(120)
    expect(f.nutrients.vitA).toBe(300)
    expect(f.nutrients.fiber).toBeUndefined()
    expect(f.brand).toBe('Marca X')
    expect(f.basis).toBe('100g')
    expect(f.portions[0]).toEqual(['1 porción (30 g)', 30])
  })
  it('derives kcal from kJ with a flag and detects liquids', () => {
    const r = offToRefFood({ code: '7700000000002', product_name: 'Bebida', quantity: '1,5 L', nutriments: { 'energy-kj_100g': 418.4 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.nutrients.kcal).toBe(100)
    expect(r.food.flags).toContain('kcal_from_kj')
    expect(r.food.basis).toBe('100ml')
  })
  it('refuses products without energy or without name', () => {
    expect('error' in offToRefFood({ code: '7700000000003', product_name: 'X', nutriments: {} })).toBe(true)
    expect('error' in offToRefFood({ code: '7700000000004', nutriments: { 'energy-kcal_100g': 10 } })).toBe(true)
  })
})
