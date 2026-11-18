import { describe, expect, it } from 'vitest'
import { readFoodText, readPastedLabel } from './foodText'
import { previewTextFood } from './textFoodDraft'

describe('food text and review', () => {
  it('understands a fraction of a known unit and several nutrients in a sentence', () => {
    const t = readFoodText('Comí media arepa casera de 80 g. Por cada 100 g tiene 210 kcal, 5 g de proteína y 42 g de carbohidratos.')
    expect(t).toMatchObject({ name: 'Arepa casera', qty: .5, unit: 'serving', portion: { qty: 80, unit: 'g' }, groups: [{ basis: '100g', nutrients: { kcal: 210, protein: 5, carbs: 42 } }] })
    expect(previewTextFood({ ...t, basis: '100g', nutrients: t.groups[0]!.nutrients, sourceText: '', package: null })).toMatchObject({
      snapshot: { grams: 40, qty: .5, nutrients: { kcal: 84, protein: 2, carbs: 16.8 }, missing: expect.arrayContaining(['fat']) },
    })
  })

  it('asks which amount energy refers to, then uses only the confirmed basis', () => {
    const t = readFoodText('yogur 150 g, 120 calorías')
    expect(t).toMatchObject({ name: 'Yogur', qty: 150, unit: 'g', groups: [{ basis: '', nutrients: { kcal: 120 } }] })
    const input = { ...t, basis: '' as const, nutrients: t.groups[0]!.nutrients, sourceText: '', package: null }
    expect(previewTextFood(input)).toHaveProperty('error')
    expect(previewTextFood({ ...input, basis: 'consumed' })).toMatchObject({ snapshot: { nutrients: { kcal: 120 } } })
    expect(previewTextFood({ ...input, basis: '100g' })).toMatchObject({ snapshot: { nutrients: { kcal: 180 } } })
  })

  it('keeps pending nutrition absent and does not guess the mass of a portion', () => {
    const t = readFoodText('me comí media arepa')
    expect(t).toMatchObject({ name: 'Arepa', qty: .5, unit: 'serving', portion: null, groups: [] })
    expect(previewTextFood({ ...t, basis: '', nutrients: {}, sourceText: '', package: null })).toMatchObject({
      snapshot: { qty: .5, grams: null, ml: null, nutrients: {}, missing: expect.arrayContaining(['kcal']) },
    })
  })

  it('preserves separate columns and accepts decimal commas and milliliters', () => {
    const t = readFoodText('Bebida de avena, 0,25 L\nInformación nutricional\nPor 100 ml    Por porción\nEnergía (kcal) 42 84\nGrasa total (g) 1,2 2,4')
    expect(t).toMatchObject({ name: 'Bebida de avena', qty: 250, unit: 'ml', groups: [
      { basis: '100ml', nutrients: { kcal: 42, fat: 1.2 } }, { basis: 'serving', nutrients: { kcal: 84, fat: 2.4 } },
    ] })
  })

  it('does not use daily percentages or uncoupled weights as nutrition', () => {
    expect(readFoodText('Yogur de fresa 150 g\nContenido neto: 600 g\nProteína: 30 %').groups).toEqual([])
  })

  it('accepts named food labels in prose and recognizes an explicitly consumed total', () => {
    expect(readPastedLabel('Yogur natural. Por 100 g tiene 120 kcal, 8 g de proteína y 5,5 g de grasa.')).toMatchObject({
      name: 'Yogur natural', parsed: { byBasis: { '100g': { kcal: 120, protein: 8, fat: 5.5 } } },
    })
    expect(readFoodText('Por lo que comí: 84 kcal, proteína 2 g.').groups).toMatchObject([
      { basis: 'consumed', nutrients: { kcal: 84, protein: 2 } },
    ])
  })
})
