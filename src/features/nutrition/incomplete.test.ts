import { describe, expect, it } from 'vitest'
import { sumNutrients } from '../../domain/nutrients'
import { foodsLacking, incompleteFoods, incompleteHeadline, nutrientList, nutrientName, partialSentence } from './incomplete'

describe('incomplete data', () => {
  it('keeps only the logs with unknown nutrients, in order', () => {
    const logs = [
      { id: 'a', name: 'Arroz', missing: [] },
      { id: 'b', name: 'Galletas', missing: ['fiber', 'sodium'] as never },
      { id: 'c', name: 'Pan', missing: ['fiber'] as never },
    ]
    expect(incompleteFoods(logs).map((x) => [x.id, x.missing])).toEqual([['b', ['fiber', 'sodium']], ['c', ['fiber']]])
  })
  it('words the headline by count', () => {
    expect(incompleteHeadline(1)).toBe('1 alimento con datos incompletos')
    expect(incompleteHeadline(3)).toBe('3 alimentos con datos incompletos')
  })
  it('lists nutrients in Spanish', () => {
    expect(nutrientName('protein')).toBe('proteína')
    expect(nutrientList(['protein'])).toBe('proteína')
    expect(nutrientList(['protein', 'fiber', 'sodium'])).toBe('proteína, fibra dietaria y sodio')
    expect(nutrientList([])).toBe('')
  })
  it('lists the foods that give no value for a nutrient, once each, in the order of the day', () => {
    const logs = [
      { name: 'Arroz', nutrients: { kcal: 130, fiber: 0.4 } },
      { name: 'Galletas', nutrients: { kcal: 180 } },
      { name: 'Pan', nutrients: { kcal: 250 } },
      { name: 'Galletas', nutrients: { kcal: 90 } },
    ]
    expect(foodsLacking(logs, 'fiber')).toEqual(['Galletas', 'Pan'])
    expect(foodsLacking(logs, 'kcal')).toEqual([])
    expect(foodsLacking(logs, 'sodium')).toEqual(['Arroz', 'Galletas', 'Pan'])
  })
  it('names exactly the foods that make a total partial, without changing the total', () => {
    const logs = [
      { name: 'Arroz', nutrients: { kcal: 130, fiber: 0.4 } },
      { name: 'Galletas', nutrients: { kcal: 180 } },
    ]
    const { totals, partial } = sumNutrients(logs)
    expect(partial).toEqual(['fiber'])
    expect(totals.fiber).toBe(0.4) // the unknown fibre of the biscuits is not counted as 0 nor estimated
    expect(foodsLacking(logs, 'fiber')).toEqual(['Galletas'])
  })
  it('explains a partial total in one sentence', () => {
    expect(partialSentence('fiber')).toBe('Algunos alimentos no informan fibra dietaria, así que este total puede ser mayor.')
  })
})
