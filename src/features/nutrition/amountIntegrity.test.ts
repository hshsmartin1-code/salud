import { expect, it } from 'vitest'
import { parseDecimal } from '../../domain/units'
import { amountError } from './amountRange'
import { parseAmount } from './amountParse'
import { buildSnapshot, type Food } from './food'

const food: Food = {
  ref: 'synthetic:food', source: 'user', name: 'Alimento sintetico', nameOrig: '', brand: null, barcode: null,
  category: null, kind: 'generic', basis: '100g', nutrients: { kcal: 100 }, portions: [], flags: [], synonyms: '',
  datasetVersion: null, curated: false, englishOnly: false, servingGrams: null,
}
it.each([['1/2', 0.5], ['1 1/2', 1.5], ['1,5', 1.5], ['1.200', 1200]] as const)('%s reaches food storage as %s grams', (input, expected) => {
  const qty = parseAmount(input)!
  expect(amountError(qty, 'g')).toBeNull()
  const snapshot = buildSnapshot(food, qty, { key: 'g', unit: 'g', label: 'g', defaultQty: 100 })
  expect(snapshot).toMatchObject({ qty: expected, grams: expected, nutrients: { kcal: expected } })
  if (!input.includes('/')) expect(qty).toBe(parseDecimal(input))
})

it('rejects a thousands amount in portions and never builds non-finite quantities', () => {
  expect(amountError(parseAmount('1.200'), 'portion')).not.toBeNull()
  for (const input of ['1/0', '-1/2', '1/2/3']) expect(parseAmount(input)).toBeNull()
  const hugeFraction = `${'9'.repeat(400)}/${'9'.repeat(400)}`
  expect(buildSnapshot(food, parseAmount(hugeFraction)!, { key: 'g', unit: 'g', label: 'g', defaultQty: 100 })).toHaveProperty('error')
})
