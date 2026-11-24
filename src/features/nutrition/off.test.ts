import { describe, expect, it } from 'vitest'
import { offToRefFood } from './off'
import { buildSnapshot, fromRefFood, unitOptions } from './food'

describe('offToRefFood', () => {
  it('converts units: minerals g to mg, vitamins g to µg, sodium from salt', () => {
    const r = offToRefFood({
      code: '7700000000001',
      product_name: 'Galletas de prueba',
      brands: 'Marca X, Otra',
      quantity: '300 g',
      serving_quantity: 30,
      serving_quantity_unit: 'g',
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
  it('energy check: high-fibre foods pass; beer passes only through its stated alcohol', () => {
    const bran = offToRefFood({ code: '7700000000101', product_name: 'Salvado de trigo', nutriments: { 'energy-kcal_100g': 216, proteins_100g: 15.55, carbohydrates_100g: 64.51, fat_100g: 4.25, fiber_100g: 42.8 } })
    if (!('food' in bran)) throw new Error('expected food')
    expect(bran.food.flags).not.toContain('atwater_mismatch')
    const beer = { code: '7700000000102', product_name: 'Cerveza', quantity: '330 ml', nutriments: { 'energy-kcal_100g': 43, proteins_100g: 0.46, carbohydrates_100g: 3.55, fat_100g: 0 } }
    const noAlcohol = offToRefFood(beer)
    if (!('food' in noAlcohol)) throw new Error('expected food')
    expect(noAlcohol.food.flags).toContain('atwater_mismatch')
    // Open Food Facts gives alcohol in % vol: 4,9 % vol → 3,87 g/100 ml → 27 kcal.
    const withAlcohol = offToRefFood({ ...beer, nutriments: { ...beer.nutriments, alcohol_100g: 4.9 } })
    if (!('food' in withAlcohol)) throw new Error('expected food')
    expect(withAlcohol.food.basis).toBe('100ml')
    expect(withAlcohol.food.flags).not.toContain('atwater_mismatch')
    expect('alcohol' in withAlcohol.food.nutrients).toBe(false) // used for the check only, never stored
  })
  it('refuses products without energy or without name', () => {
    expect('error' in offToRefFood({ code: '7700000000003', product_name: 'X', nutriments: {} })).toBe(true)
    expect('error' in offToRefFood({ code: '7700000000004', nutriments: { 'energy-kcal_100g': 10 } })).toBe(true)
  })
  it('rejects a gram serving and package for a milliliter basis', () => {
    const r = offToRefFood({ code: '7700000000005', product_name: 'Bebida',
      product_quantity: 500, product_quantity_unit: 'ml', serving_quantity: 30,
      serving_quantity_unit: 'g', serving_size: '30 g', nutriments: { 'energy-kcal_100g': 20 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.basis).toBe('100ml')
    expect(r.food.portions).toEqual([['Envase completo', 500]])
  })
  it('does not add a portion when the normalized unit is unknown', () => {
    const r = offToRefFood({ code: '7700000000006', product_name: 'Producto',
      serving_quantity: 30, product_quantity: 200, nutriments: { 'energy-kcal_100g': 100 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.portions).toEqual([])
  })
  it('uses a single explicit package volume but never a partial multipack size', () => {
    const base = { code: '7700000000007', product_name: 'Bebida', nutriments: { 'energy-kcal_100g': 30 } }
    const single = offToRefFood({ ...base, quantity: '1,5 L' })
    const multi = offToRefFood({ ...base, quantity: '2 x 250 ml' })
    if (!('food' in single) || !('food' in multi)) throw new Error('expected food')
    expect(single.food.portions).toEqual([['Envase completo', 1500]])
    expect(multi.food.portions).toEqual([])
  })
  it('uses an explicit serving measure when normalized quantity is absent', () => {
    const r = offToRefFood({ code: '7700000000008', product_name: 'Cereal', serving_size: '2 cucharadas (0,03 kg)',
      quantity: '300 g', nutriments: { 'energy-kcal_100g': 100 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.portions).toEqual([['1 porción (2 cucharadas (0,03 kg))', 30], ['Envase completo', 300]])
  })
  it('rejects contradictory normalized and printed serving measurements', () => {
    const r = offToRefFood({ code: '7700000000009', product_name: 'Cereal', serving_quantity: 30,
      serving_quantity_unit: 'g', serving_size: '20 g', product_quantity: 200,
      product_quantity_unit: 'g', quantity: '200 g', nutriments: { 'energy-kcal_100g': 100 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.portions).toEqual([['Envase completo', 200]])
  })
  it('rejects serving larger than a known package', () => {
    const r = offToRefFood({ code: '7700000000010', product_name: 'Cereal', serving_size: '250 g',
      product_quantity: 200, product_quantity_unit: 'g', nutriments: { 'energy-kcal_100g': 100 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.portions).toEqual([['Envase completo', 200]])
  })
  it('rejects contradictory package measurements and ambiguous serving text', () => {
    const r = offToRefFood({ code: '7700000000011', product_name: 'Cereal', serving_size: '2 x 30 g',
      serving_quantity: 30, serving_quantity_unit: 'g',
      quantity: '200 g', product_quantity: 100, product_quantity_unit: 'g',
      nutriments: { 'energy-kcal_100g': 100 } })
    if (!('food' in r)) throw new Error('expected food')
    expect(r.food.portions).toEqual([])
  })

  it('normalizes a declared serving in ml and preserves its conversion for fractional logging', () => {
    const result = offToRefFood({ code: '7700000000012', product_name: 'Bebida de prueba', quantity: '500 ml',
      serving_size: '1 vaso (200 ml)', nutrition_data_per: 'serving', rev: 12,
      image_front_small_url: 'https://images.openfoodfacts.org/images/products/770/000/000/0012/front_es.9.200.jpg',
      nutriments: { 'energy-kcal_serving': 110, 'energy-kcal_100g': 30, proteins_serving: 6, sodium_serving: 0.25, salt_serving: 0.1 } })
    if (!('food' in result)) throw new Error(result.error)
    expect(result.food).toMatchObject({ basis: '100ml', nutrients: { kcal: 55, protein: 3, sodium: 125 }, packageLabel: '500 ml', imageUrl: expect.any(String) })
    expect(result.food.flags).toEqual(expect.arrayContaining(['off_basis_conflict', 'off_salt_conflict']))
    expect(result.food.datasetVersion).toContain('rev. 12')
    const food = fromRefFood(result.food)
    const unit = unitOptions(food).find((o) => o.portionGrams === 200)!
    expect(buildSnapshot(food, 0.5, unit)).toMatchObject({ foodRef: result.food.id, ml: 100, grams: null, nutrients: { kcal: 55 }, missing: expect.arrayContaining(['carbs', 'fat']) })
    expect(buildSnapshot(food, 2, unit)).toMatchObject({ ml: 400, nutrients: { kcal: 220 } })
  })

  it('keeps directly declared values per serving when the serving has no reliable measure', () => {
    const result = offToRefFood({ code: '7700000000013', product_name: 'Galletas de prueba', nutrition_data_per: 'serving',
      serving_size: '2 galletas', nutriments: { 'energy-kcal_serving': 50, 'energy-kj_serving': 9 } })
    if (!('food' in result)) throw new Error(result.error)
    expect(result.food).toMatchObject({ basis: 'serving', nutrients: { kcal: 50 }, portions: [] })
    expect(result.food.nutrients.kj).toBeUndefined()
    expect(result.food.flags).toContain('kj_inconsistent_nulled')
  })
})
