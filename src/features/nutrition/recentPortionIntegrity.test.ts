import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Food } from './food'

const fake = vi.hoisted(() => ({ effects: [] as (() => void)[], changes: [] as unknown[] }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual,
    useEffect: (effect: () => void) => { fake.effects.push(effect) },
    useState: <T,>(initial: T | (() => T)) => {
      const [value] = actual.useState(initial)
      return [value, (next: T) => { fake.changes.push(next) }]
    },
  }
})
vi.mock('../../app/profile', () => ({ useRepo: () => ({
  profileId: 'synthetic-profile',
  get: (table: string) => table === 'recents' ? { lastUnit: 'portion', lastPortionLabel: '1 taza', lastQty: 2 } : undefined,
  byProfileIndex: () => [],
}) }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }))
vi.mock('../../ui/kit', () => ({ Sheet: () => null }))
vi.mock('./Chooser', () => ({ Chooser: () => null }))
vi.mock('./useMealSlots', () => ({ useMealSlots: () => ({ now: { key: 'almuerzo', label: 'Almuerzo' }, label: () => 'Almuerzo', choices: () => [] }) }))
import { QuantitySheet } from './QuantitySheet'

it('reopens a legacy recent with its own portion and quantity instead of the first portion', () => {
  const food: Food = {
    ref: 'synthetic:food', source: 'usda_sr', name: 'Alimento sintetico', nameOrig: '', brand: null,
    barcode: null, category: null, kind: 'generic', basis: '100g', nutrients: { kcal: 100 },
    portions: [['1 cucharada', 15], ['1 taza', 240]], flags: [], synonyms: '', datasetVersion: null,
    curated: false, englishOnly: false, servingGrams: null,
  }
  renderToStaticMarkup(createElement(QuantitySheet, { food, open: true, onClose: vi.fn() }))
  fake.effects.forEach((effect) => effect())
  expect(fake.changes).toContain('portion:1')
  expect(fake.changes).toContain('2')
})
