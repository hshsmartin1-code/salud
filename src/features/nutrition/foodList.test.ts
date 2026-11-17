import { describe, expect, it } from 'vitest'
import type { Food } from './food'
import { dedupeByRef, orderQueryResults, type FoodUsage } from './foodList'

const food = (ref: string, name: string): Food => ({
  ref, source: 'off', name, nameOrig: name, brand: null, barcode: null, category: null, kind: 'packaged', basis: '100g', nutrients: { kcal: 1 },
  portions: [], flags: [], synonyms: '', datasetVersion: null, curated: false, englishOnly: false, servingGrams: null,
})

it('keeps one row per id and the copy that resolve returns', () => {
  const catalog = food('off:1', 'Yogur catálogo')
  const device = food('off:1', 'Yogur dispositivo')
  const other = food('off:2', 'Otro')
  const resolve = (ref: string) => (ref === 'off:1' ? device : undefined)
  const out = dedupeByRef([catalog, other, device, other], resolve)
  expect(out.map((f) => f.ref)).toEqual(['off:1', 'off:2'])
  expect(out[0]).toBe(device)
  expect(out[1]).toBe(other)
  expect(new Set(out.map((f) => f.ref)).size).toBe(out.length)
})

describe('orderQueryResults', () => {
  const en = (ref: string, name: string): Food => ({ ...food(ref, name), englishOnly: true })
  const search = [
    food('a', 'Arroz con pollo'),
    en('e1', 'Flour, rice, brown'),
    food('b', 'Harina de arroz'),
    food('c', 'Arroz blanco cocido'),
    en('e2', 'Babyfood, rice cereal'),
    food('d', 'Arroz'),
    food('f', 'Arroz integral cocido'),
  ]
  const none = new Map<string, FoodUsage>()

  it('neither adds nor drops a result', () => {
    const used = new Map<string, FoodUsage>([['e2', { count: 1, lastUsedAt: '2026-11-01T00:00:00Z' }]])
    for (const u of [none, used]) {
      const r = orderQueryResults(search, 'arroz', u)
      expect([...r.main, ...r.english].map((f) => f.ref).sort()).toEqual(search.map((f) => f.ref).sort())
    }
  })
  it('puts Spanish exact, then prefix, then other matches; English-only apart, in search order', () => {
    const r = orderQueryResults(search, 'Arróz', none)
    expect(r.main.map((f) => f.ref)).toEqual(['d', 'a', 'c', 'f', 'b'])
    expect(r.english.map((f) => f.ref)).toEqual(['e1', 'e2'])
  })
  it('puts foods the person logged first, by use count then recency, even English-only ones', () => {
    const usage = new Map<string, FoodUsage>([
      ['c', { count: 3, lastUsedAt: '2026-11-10T00:00:00Z' }],
      ['b', { count: 5, lastUsedAt: '2026-10-01T00:00:00Z' }],
      ['f', { count: 3, lastUsedAt: '2026-11-12T00:00:00Z' }],
      ['e1', { count: 1, lastUsedAt: '2026-11-13T00:00:00Z' }],
      ['zz', { count: 9, lastUsedAt: '2026-11-13T00:00:00Z' }], // not a match: never added
    ])
    const r = orderQueryResults(search, 'arroz', usage)
    expect(r.main.map((f) => f.ref)).toEqual(['b', 'f', 'c', 'e1', 'd', 'a'])
    expect(r.english.map((f) => f.ref)).toEqual(['e2'])
  })
})
