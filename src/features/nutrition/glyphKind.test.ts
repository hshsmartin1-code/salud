import { describe, expect, it } from 'vitest'
import { GLYPH_KINDS, foodGlyph, type GlyphInput } from './glyphKind'

const f = (name: string, over: Partial<GlyphInput> = {}): GlyphInput => ({ name, category: null, kind: 'generic', source: 'usda_sr', brand: null, ...over })

describe('foodGlyph', () => {
  it.each<[GlyphInput, string]>([
    [f('Arroz blanco cocido', { category: 'Cereales, granos y pastas', kind: 'cooked' }), 'grain'],
    [f('Pan integral tostado'), 'grain'],
    [f('Pasta cocida'), 'grain'],
    [f('Papa cocida sin cáscara'), 'grain'],
    [f('Carne de res molida', { category: 'Carne de res' }), 'meat'],
    [f('Lomo de cerdo'), 'meat'],
    [f('Pechuga de pollo asada, sin piel', { category: 'Aves de corral' }), 'poultry'],
    [f('Muslo de pavo'), 'poultry'],
    [f('Salmón asado (de cultivo)'), 'fish'],
    [f('Atún en agua (lata, escurrido)'), 'fish'],
    [f('Huevos revueltos'), 'egg'],
    [f('Leche entera'), 'dairy'],
    [f('Yogur griego natural descremado'), 'dairy'],
    [f('Queso doble crema'), 'dairy'],
    [f('Banano', { category: 'Frutas y jugos de frutas' }), 'fruit'],
    [f('Manzana con cáscara'), 'fruit'],
    [f('Aguacate', { category: 'Frutas y jugos de frutas' }), 'fruit'],
    [f('Brócoli cocido'), 'vegetable'],
    [f('Zanahoria cruda'), 'vegetable'],
    [f('Lenteja cocida'), 'legume'],
    [f('Fríjoles negros'), 'legume'],
    [f('Almendras'), 'nut'],
    [f('Mantequilla de maní'), 'nut'],
    [f('Aceite de oliva'), 'fat'],
    [f('Galletas de chocolate'), 'sweet'],
    [f('Helado de vainilla'), 'dairy'],
    [f('Brownie'), 'sweet'],
    [f('Jugo de naranja'), 'drink'],
    [f('Café con leche'), 'drink'],
    [f('Pizza de queso'), 'dish'],
    [f('Sopa de verduras'), 'dish'],
    [f('Mi receta de lentejas', { kind: 'recipe', source: 'recipe' }), 'recipe'],
    [f('Cheddar Cheese', { source: 'off', kind: 'packaged', brand: 'Pringles', category: 'Plant based foods and beverages' }), 'dairy'],
    [f('Producto X', { source: 'label', kind: 'user' }), 'packaged'],
    [f('Cosa rara', { kind: 'prepared' }), 'dish'],
    [f('Cosa rara'), 'generic'],
  ])('%j → %s', (food, kind) => expect(foodGlyph(food)).toBe(kind))

  it('uses the category when the name says nothing', () => {
    expect(foodGlyph(f('Producto 123', { category: 'Dairies' }))).toBe('dairy')
    expect(foodGlyph(f('Producto 123', { category: 'Snacks' }))).toBe('sweet')
    expect(foodGlyph(f('Producto 123', { category: 'Panes' }))).toBe('grain')
  })
  it('a branded product with no recognisable word is a packaged product', () => {
    expect(foodGlyph(f('Producto 123', { source: 'off', kind: 'packaged', brand: 'Marca' }))).toBe('packaged')
  })
  it('a recipe is a recipe whatever its name says', () => {
    expect(foodGlyph(f('Pollo con arroz', { kind: 'recipe', source: 'recipe' }))).toBe('recipe')
  })
  it('is deterministic and always returns a known kind', () => {
    for (const n of ['', '   ', 'x', 'ÁÉÍ']) expect(GLYPH_KINDS).toContain(foodGlyph(f(n)))
  })
  it('covers every kind', () => {
    const seen = new Set([
      foodGlyph(f('arroz')), foodGlyph(f('lomo')), foodGlyph(f('pollo')), foodGlyph(f('salmón')), foodGlyph(f('huevo')), foodGlyph(f('leche')), foodGlyph(f('banano')), foodGlyph(f('brócoli')),
      foodGlyph(f('lenteja')), foodGlyph(f('almendras')), foodGlyph(f('aceite')), foodGlyph(f('galletas')), foodGlyph(f('jugo')), foodGlyph(f('pizza')),
      foodGlyph(f('x', { source: 'off', kind: 'packaged' })), foodGlyph(f('x', { kind: 'recipe' })), foodGlyph(f('x')),
    ])
    expect([...seen].sort()).toEqual([...GLYPH_KINDS].sort())
  })
})
