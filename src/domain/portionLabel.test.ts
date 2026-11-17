import offRaw from '../../public/data/foods-off-co.json?raw'
import usdaRaw from '../../public/data/foods-usda.json?raw'
import { describe, expect, it } from 'vitest'
import { dedupeByPortionText, formatEach, normalizePortion, portionText } from './portionLabel'

/** Real labels from public/data/foods-off-co.json and foods-usda.json: raw label, amount of ONE measure, unit → name, each. */
const TABLE: [string, number, 'g' | 'ml', string, string][] = [
  ['1 porción (1 portion (150 g))', 150, 'g', 'porción', '150 g'],
  ['1 tajada (25 g)', 25, 'g', 'tajada', '25 g'],
  ['1 unidad (individual school container)', 244, 'g', 'unidad', '244 g'],
  ['14 crisps/crujientes (1 oz / 28 g)', 28, 'g', '14 crujientes', '28 g'],
  ['1 porción (14 crisps/crujientes (1 oz / 28 g))', 28, 'g', '14 crujientes', '28 g'],
  ['1 porción (19 crisps/unidades (1.3 oz / 37 g))', 37, 'g', '19 unidades', '37 g'],
  ['Envase completo', 71, 'g', 'envase completo', '71 g'],
  ['1 taza', 244, 'g', 'taza', '244 g'],
  ['1 taza (8 fl oz)', 240, 'g', 'taza', '240 g'],
  ['1 taza, cocido, en cubos', 140, 'g', 'taza, cocido', '140 g'],
  ['1 taza, NE', 150, 'g', 'taza', '150 g'],
  ['1 taza, picado', 130, 'g', 'taza, picado', '130 g'],
  ['1 taza, en rodajas', 110, 'g', 'taza, en rodajas', '110 g'],
  ['1/2 taza', 120, 'g', '1/2 taza', '120 g'],
  ['1 1/2 taza', 180, 'g', '1 1/2 tazas', '180 g'],
  ['3 oz', 85, 'g', '3 oz', '85 g'],
  ['1 oz', 28.35, 'g', 'oz', '28,4 g'],
  ['1 oz, rinde', 28, 'g', 'oz', '28 g'],
  ['1 onza líquida', 30.5, 'ml', 'onza líquida', '30,5 ml'],
  ['1 onza líquida (no ice)', 30, 'ml', 'onza líquida', '30 ml'],
  ['8 onzas líquidas', 240, 'ml', '8 onzas líquidas', '240 ml'],
  ['1 cucharada', 15, 'g', 'cucharada', '15 g'],
  ['2 cucharadas', 28, 'g', '2 cucharadas', '28 g'],
  ['1 cucharadita', 5, 'g', 'cucharadita', '5 g'],
  ['1 grande', 50, 'g', 'grande', '50 g'],
  ['1 pequeño (single serving bag)', 28, 'g', 'pequeño', '28 g'],
  ['1 mediano, o regular tajada', 30, 'g', 'mediano', '30 g'],
  ['1 unidad', 100, 'g', 'unidad', '100 g'],
  ['1 unidad (cooked, excluding refuse (yield from 1 lb raw meat with refuse))', 85, 'g', 'unidad', '85 g'],
  ['1 unidad (personal size pizza (5-7" diameter))', 160, 'g', 'unidad', '160 g'],
  ['1 unidad (100 calorie package)', 28, 'g', 'unidad', '28 g'],
  ['10 unidades (chips)', 28, 'g', '10 unidades', '28 g'],
  ['1 tajada, snack-tamaño', 20, 'g', 'tajada', '20 g'],
  ['1 tajada (crust not eaten)', 25, 'g', 'tajada', '25 g'],
  ['2 tajadas (25 g cada una)', 50, 'g', '2 tajadas', '50 g'],
  ['10 tira', 30, 'g', '10 tiras', '30 g'],
  ['1 pieza para asar', 120, 'g', 'pieza para asar', '120 g'],
  ['1 barra', 40, 'g', 'barra', '40 g'],
  ['1 lata (12 fl oz)', 368, 'g', 'lata', '368 g'],
  ['1 botella (16.9 fl oz or 500 ml)', 500, 'ml', 'botella', '500 ml'],
  ['1 paquete (10 oz)', 284, 'g', 'paquete', '284 g'],
  ['1 porción de referencia (RACC)', 30, 'g', 'porción de referencia', '30 g'],
  ['Cantidad de referencia (per fl oz of beverage)', 2.5, 'g', 'cantidad de referencia', '2,5 g'],
  ['Cantidad no especificada', 244, 'g', 'cantidad no especificada', '244 g'],
  ['1 porción (30g)', 30, 'g', 'porción', '30 g'],
  ['1 porción', 150, 'g', 'porción', '150 g'],
  ['1 serving (50 g)', 50, 'g', 'porción', '50 g'],
  ['1 cup (240 ml)', 240, 'ml', 'taza', '240 ml'],
  ['1 tbsp', 15, 'ml', 'cucharada', '15 ml'],
  ['2 tbsp', 30, 'g', '2 cucharadas', '30 g'],
  ['1 scoop (30 g)', 30, 'g', 'medida', '30 g'],
  ['1 slice', 25, 'g', 'tajada', '25 g'],
  ['2 slices (50 g)', 50, 'g', '2 tajadas', '50 g'],
  ['1 piece (20 g)', 20, 'g', 'pieza', '20 g'],
  ['1 bar (45 g)', 45, 'g', 'barra', '45 g'],
  ['1 container (170 g)', 170, 'g', 'envase', '170 g'],
  ['1 can (330 ml)', 330, 'ml', 'lata', '330 ml'],
  ['1 trozo/tajada, cualquier tamaño', 40, 'g', 'trozo', '40 g'],
  ['1 pequeño/regular', 60, 'g', 'pequeño', '60 g'],
  ['1 porción individual', 30, 'g', 'porción individual', '30 g'],
  ['1 huevo', 50, 'g', 'huevo', '50 g'],
  ['1 sándwich (1 slice bread)', 120, 'g', 'sándwich', '120 g'],
  ['', 90, 'g', 'porción', '90 g'],
]

describe('normalizePortion: real catalog labels', () => {
  it('has at least 40 rows', () => expect(TABLE.length).toBeGreaterThanOrEqual(40))
  it.each(TABLE)('%s (%d %s) → %s (%s)', (raw, amount, unit, name, each) => {
    expect(normalizePortion(raw, amount, unit)).toEqual({ name, each })
  })
})

describe('normalizePortion: rules', () => {
  it('shows one equivalence: name (each)', () => {
    expect(portionText('1 porción (1 portion (150 g))', 150)).toBe('porción (150 g)')
    expect(portionText('14 crisps/crujientes (1 oz / 28 g)', 28)).toBe('14 crujientes (28 g)')
  })
  it('never nests parentheses nor leaves a bracket', () => {
    for (const [raw, amount, unit] of TABLE) {
      const t = portionText(raw, amount, unit)
      expect(t.match(/\(/g)?.length).toBe(1)
      expect(t.match(/\)/g)?.length).toBe(1)
    }
  })
  it('strips the leading 1 and keeps other counts, pluralising by quantity', () => {
    expect(normalizePortion('1 taza', 240).name).toBe('taza')
    expect(normalizePortion('2 taza', 480).name).toBe('2 tazas')
    expect(normalizePortion('2 tajadas', 50).name).toBe('2 tajadas')
    expect(normalizePortion('1 tajadas', 25).name).toBe('tajada')
  })
  it('formats the equivalence with a decimal comma, no grouping, one decimal at most', () => {
    expect(formatEach(1250)).toBe('1250 g')
    expect(formatEach(2.5, 'ml')).toBe('2,5 ml')
    expect(formatEach(28.349)).toBe('28,3 g')
    expect(formatEach(100)).toBe('100 g')
  })
  it('collapses duplicates of the same name and amount', () => {
    const opts = [
      { l: '1 porción (1 portion (150 g))', a: 150 },
      { l: '1 porción (150 g)', a: 150 },
      { l: '1 unidad (individual school container)', a: 150 },
      { l: '1 porción', a: 200 },
    ]
    const out = dedupeByPortionText(opts, (o) => portionText(o.l, o.a))
    expect(out.map((o) => portionText(o.l, o.a))).toEqual(['porción (150 g)', 'unidad (150 g)', 'porción (200 g)'])
  })
})

describe('normalizePortion: every label of the bundled catalogs', () => {
  const ENGLISH = /\b(the|of|with|serving|portion|slice|cup|tbsp|tsp|piece|unit|container|package|can|bottle|bar|scoop|stick|large|medium|small|fl|ice|raw|cooked|and|size|any)\b/i
  for (const [file, raw] of [['foods-off-co.json', offRaw], ['foods-usda.json', usdaRaw]] as const) {
    it(`${file}: no parentheses inside the name, no English, never empty`, () => {
      const json = JSON.parse(raw) as { foods: unknown[][] }
      const labels = new Set<string>()
      for (const row of json.foods) for (const p of (row[9] as [string, number][] | null) ?? []) labels.add(p[0])
      expect(labels.size).toBeGreaterThan(100)
      const bad: string[] = []
      for (const l of labels) {
        const { name, each } = normalizePortion(l, 100)
        if (!name || /[()]/.test(name) || ENGLISH.test(name) || each !== '100 g') bad.push(`${l} → ${name}`)
      }
      expect(bad).toEqual([])
    })
  }
})
