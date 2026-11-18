import { describe, expect, it } from 'vitest'
import type { CatalogFoodFile } from '../../db/catalogTypes'
import { buildSearchIndex, searchIndex } from '../../domain/search'
import { foodRank, fromCatalogRow, type Food } from './food'
import { findFoods, foodBarcode, foodQuery, indexFoods } from './foodSearchIndex'
import { orderQueryResults } from './foodList'
import { reviewedUsdaName } from './usdaNames'

const { readFileSync } = await import('node:fs' as string) as { readFileSync(path: string, encoding: string): string }

const files = ['foods-usda', 'foods-off-co'].map((name) => JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8')) as CatalogFoodFile)
const catalog = (reviewed: boolean) => files.flatMap((f) => f.foods.map((row) => {
  const food = fromCatalogRow(row, f.nutrientOrder, f.datasetVersion)
  if (reviewed) return food
  return { ...food, name: row[2] || row[1], synonyms: row[10] ?? '', curated: food.flags.includes('curated_es'), englishOnly: food.source.startsWith('usda_') && !row[2] }
}))
const local = catalog(true)
const search = (query: string, index = bundled) => findFoods([index], query).map((m) => m.food)
const bundled = indexFoods(local)

describe('ranking over the shipped catalogs', () => {
  const cases = [
    ['chocorramo', /chocoramo/i], ['choco ramo', /chocoramo/i], ['ramo', /ramo/i], ['mani', /maní/i],
    ['cacahuate', /maní/i], ['coca cola cero', /coca.cola zero/i], ['pechuga', /pechuga de pollo/i],
    ['pechgua de pollo', /pechuga de pollo/i], ['agaucate', /aguacate/i], ['aroz blanco cocido', /arroz blanco cocido/i],
    ['atun claro en agua sin sal', /atún claro en agua sin sal/i], ['pan integral', /pan integral/i],
  ] as const

  it.each(cases)('puts a relevant hit in the top 3 for %s', (q, expected) => {
    expect(search(q).slice(0, 3).map((f) => `${f.name} ${f.brand ?? ''}`).some((s) => expected.test(s))).toBe(true)
  })

  it('compares top-1/top-3 and warm latency against the previous ranking', () => {
    const before = buildSearchIndex(catalog(false), { name: (f) => f.name, rank: foodRank,
      text: (f) => `${f.name} ${f.nameOrig} ${f.brand ?? ''} ${f.synonyms} ${f.barcode ?? ''}` })
    const times: number[] = []
    const beforeTimes: number[] = []
    const relevance = { before: [0, 0], after: [0, 0] }
    for (const [q, expected] of cases) {
      const oldSearch = () => orderQueryResults(searchIndex(before, q, { limit: 60 }), q, new Map()).main
      const old = oldSearch()
      const next = search(q)
      for (const [results, key] of [[old, 'before'], [next, 'after']] as const) {
        const position = results.findIndex((f) => expected.test(`${f.name} ${f.brand ?? ''}`))
        if (position === 0) relevance[key][0]++
        if (position >= 0 && position < 3) relevance[key][1]++
      }
      for (let i = 0; i < 8; i++) {
        let started = performance.now()
        oldSearch()
        beforeTimes.push(performance.now() - started)
        started = performance.now()
        search(q)
        times.push(performance.now() - started)
      }
    }
    const percentile = (data: number[], p: number) => Number(data.sort((a, b) => a - b)[Math.floor(data.length * p)]!.toFixed(2))
    console.log('FOOD_SEARCH_BENCH', JSON.stringify({ rows: local.length, queries: cases.length, relevance, previousMs: [percentile(beforeTimes, .5), percentile(beforeTimes, .95)], currentMs: [percentile(times, .5), percentile(times, .95)] }))
    expect(relevance.after[1]).toBe(cases.length)
    expect(relevance.after[0]).toBeGreaterThan(relevance.before[0])
    expect(percentile(times, .95)).toBeLessThan(40)
  })

  it('does not index purple passion fruit as Colombian granadilla and handles calorie intent', () => {
    expect(foodQuery('Granadilla calorías').local).toBe('granadilla')
    expect(search('granadilla calorias').some((f) => f.ref === 'usda_sr:169108')).toBe(false)
    expect(search('zzvvqqqxxy')).toEqual([])
  })

  it('keeps a familiar relevant rice ahead of a one-word commercial entry with almost no nutrition', () => {
    const result = findFoods([bundled], 'arroz', { usage: new Map([['usda_sr:168878', { count: 1, lastUsedAt: '2026-11-17' }]]) })
    expect(result[0]?.food.name).toBe('Arroz blanco cocido')
  })

  it('retains validated USDA identity and distinct preparation and nutrient values', () => {
    const raw = local.find((f) => f.ref === 'usda_foundation:2646170')!
    expect(raw.name).toBe('Pechuga de pollo cruda, sin piel ni hueso')
    expect(raw.nameOrig).toBe('Chicken, breast, boneless, skinless, raw')
    expect(raw.kind).toBe('raw')
    expect(reviewedUsdaName(raw.ref, 'Chicken, breast, cooked')).toBeNull()
    expect(search(raw.nameOrig)[0]?.ref).toBe(raw.ref)
    expect(search('pechuga de pollo cocida').find((f) => f.kind === 'cooked')?.nutrients).not.toEqual(raw.nutrients)
  })
})

describe('foods on the device', () => {
  const row = (ref: string, name: string, extra: Partial<Food> = {}): Food => ({
    ref, name, nameOrig: name, source: 'icbf_tcac2015', brand: null, barcode: null, category: null, kind: 'raw',
    basis: '100g', nutrients: {}, portions: [], flags: [], synonyms: '', datasetVersion: null,
    curated: false, englishOnly: false, servingGrams: null, ...extra,
  })

  it('handles different names and keeps the exact food ahead of favorites and recents', () => {
    const items = [row('a', 'Queso costeño'), row('b', 'Queso costero'), row('c', 'Granadilla'), row('d', 'Arepa de maíz blanco', { synonyms: 'arepa blanca' })]
    const index = indexFoods(items)
    const hits = findFoods([index], 'queso costeno', { favorites: new Set(['b']), usage: new Map([['b', { count: 500, lastUsedAt: '2026-11-16' }]]) })
    expect(hits[0]?.food.ref).toBe('a')
    expect(search('granadilla kcal', index)[0]?.ref).toBe('c')
    expect(search('arepa blanca', index)[0]?.ref).toBe('d')
  })

  it('retains different presentations and matches real GTINs despite padding and spaces', () => {
    const ref = '7702914596787'
    expect(foodBarcode('770-291 4596787')).toBe(ref)
    expect(foodBarcode(`abc${ref}`)).toBeNull()
    expect(search(`0${ref}`).map((f) => f.ref)).toEqual([`off:${ref}`])
    expect(new Set(search('chocoramo').filter((f) => f.name.match(/tajada|x5und/i)).map((f) => f.barcode)).size).toBeGreaterThanOrEqual(2)
  })

  it('uses Ramo as a brand association without substituting one product for another', () => {
    const index = indexFoods([row('ramito', 'Ponqué Ramito', { source: 'off' }), row('choco', 'Chocoramo', { source: 'off' })])
    expect(search('ramo', index).map((f) => f.ref).sort()).toEqual(['choco', 'ramito'])
    expect(search('ramito', index).map((f) => f.ref)).toEqual(['ramito'])
  })

  it('only collapses a cross-source barcode when its presentation and nutrition agree', () => {
    const core: Partial<Food> = { barcode: '7702914596787', brand: 'Ramo', kind: 'packaged', nutrients: { kcal: 448 }, portions: [['Tajada', 65]] }
    const index = indexFoods([
      row('a', 'Chocoramo', { ...core, source: 'label' }),
      row('b', 'Chocoramo', { ...core, source: 'off' }),
      row('c', 'Chocoramo', { ...core, source: 'user', nutrients: { kcal: 425 } }),
    ])
    expect(search('chocoramo', index).map((f) => f.ref)).toEqual(['a', 'c'])
  })
})
