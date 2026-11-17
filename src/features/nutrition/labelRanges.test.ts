import { expect, it } from 'vitest'
import { labelBaseAmount, labelValueError } from './labelRanges'

it('label values cannot exceed what the base can hold', () => {
  expect(labelBaseAmount('100g', null, null)).toBe(100)
  expect(labelBaseAmount('serving', 30, null)).toBe(30)
  expect(labelBaseAmount('serving', null, null)).toBe(1000)
  expect(labelBaseAmount('package', null, 500)).toBe(500)
  expect(labelValueError('1.200', 'g', 100)).toMatch(/^Escribe un valor entre 0 y/)
  expect(labelValueError('12,5', 'g', 100)).toBeNull()
  expect(labelValueError('1.200', 'mg', 100)).toBeNull()
  expect(labelValueError('1.200', 'kcal', 100)).toMatch(/^Escribe/)
  expect(labelValueError('520', 'kcal', 100)).toBeNull()
  expect(labelValueError('abc', 'g', 100)).toBe('Número no válido')
  expect(labelValueError('', 'g', 100)).toBeNull()
})

it('a volume basis does not assume that one ml weighs one gram', () => {
  // A dense syrup can contain 115 g of carbohydrate per 100 ml.
  expect(labelValueError('115', 'g', 100, 'ml')).toBeNull()
  expect(labelValueError('115', 'g', 100, 'g')).toMatch(/^Escribe/)
  expect(labelValueError('abc', 'g', 100, 'ml')).toBe('Número no válido')
  expect(labelValueError('-1', 'mg', 100, 'ml')).not.toBeNull()
})

it('does not impose an invented mass when a serving or package has no declared size', () => {
  expect(labelValueError('6000', 'g', 5000, null)).toBeNull()
  expect(labelValueError('6000', 'g', 5000, 'g')).not.toBeNull()
  expect(labelValueError('abc', 'g', 5000, null)).toBe('Número no válido')
})
