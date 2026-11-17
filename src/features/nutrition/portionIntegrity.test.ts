import { expect, it } from 'vitest'
import { normalizePortion } from '../../domain/portionLabel'
import { buildSnapshot, describeQty, unitOptions, type Food } from './food'

const food = (portions: [string, number][], source: Food['source'] = 'usda_sr'): Food => ({
  ref: 'synthetic:food', source, name: 'Alimento sintetico', nameOrig: '', brand: null,
  barcode: null, category: null, kind: 'generic', basis: '100g', nutrients: { kcal: 100 },
  portions, flags: [], synonyms: '', datasetVersion: null, curated: false, englishOnly: false, servingGrams: null,
})

it('keeps the count inside a generic serving wrapper through selection and logging', () => {
  const label = '1 porción (14 crisps/crujientes (1 oz / 28 g))'
  const f = food([[label, 28]])
  const option = unitOptions(f).find((o) => o.unit === 'portion')!
  expect(option.label).toBe('14 crujientes (28 g)')
  const snap = buildSnapshot(f, 2, option)
  if ('error' in snap) throw new Error(snap.error)
  expect(snap.grams).toBe(56)
  expect(describeQty(snap)).toBe('2 × 14 crujientes (28 g)')
  expect(normalizePortion(option.name!, 28).name).toBe(option.name)
})

it('preserves the words of a legacy user measure in options and snapshots', () => {
  const f = food([['Mi taza (marca 2)', 175]], 'user')
  const option = unitOptions(f).find((o) => o.unit === 'portion')!
  expect(option.name).toBe('Mi taza (marca 2)')
  const snap = buildSnapshot(f, 1, option)
  if ('error' in snap) throw new Error(snap.error)
  expect(snap.portionLabel).toBe('Mi taza (marca 2)')
  expect(describeQty(snap)).toBe('Mi taza (marca 2) (175 g)')
})

it('keeps legacy user log labels verbatim without changing the stored amount', () => {
  const snapshot = { qty: 2, unit: 'portion' as const, portionLabel: 'Mi taza (marca 2)', grams: 350, ml: null, source: 'user' as const }
  expect(describeQty(snapshot)).toBe('2 × Mi taza (marca 2) (175 g)')
  expect(snapshot.grams).toBe(350)
})
