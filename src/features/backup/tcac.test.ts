import { describe, expect, it } from 'vitest'
import { NUTRIENTS } from '../../db/catalogTypes'
import { parseTcac, tcacToRefFoods } from './tcac'

const order = NUTRIENTS.map((n) => n.code)
const values = order.map((c) => (c === 'kcal' ? 100 : c === 'protein' ? 3.5 : null))
const synthetic = {
  format: 'pho-catalog-foods',
  version: 1,
  source: 'icbf_tcac2015',
  datasetVersion: 'TCAC 2015',
  generatedAt: '2026-01-01T00:00:00Z',
  license: 'private-personal-use',
  attribution: 'x',
  nutrientOrder: order,
  counts: { icbf_tcac2015: 1 },
  foods: [['icbf_tcac2015:1', 'Alimento sintético, crudo', 'Alimento sintético, crudo', null, null, 'Grupo', 'raw', '100g', values, null, 'alimento sintetico', 'flag_a;flag_b']],
}

describe('tcac import', () => {
  it('converts rows to reference foods keeping unknown nutrients absent', () => {
    const [f] = tcacToRefFoods(parseTcac(JSON.stringify(synthetic)))
    expect(f!.source).toBe('icbf_tcac2015')
    expect(f!.nutrients).toEqual({ kcal: 100, protein: 3.5 })
    expect(f!.flags).toEqual(['flag_a', 'flag_b'])
    expect(f!.portions).toEqual([])
  })
  it('rejects other catalogs', () => {
    expect(() => parseTcac(JSON.stringify({ ...synthetic, source: 'usda' }))).toThrow(/ICBF/)
  })
})
