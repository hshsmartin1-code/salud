import { describe, expect, it } from 'vitest'
import type { NutrientMap } from '../../db/catalogTypes'
import { getDri } from '../../domain/dri'
import { buildReport } from '../../domain/nutrientReport'
import { buildSections, coverageHint } from './nutrientRows'

const D = '2026-11-24'
function sections(nutrients: NutrientMap[], sex: 'male' | 'female' | null = 'female', goalKcal: number | null = 2000) {
  const logs = nutrients.map((n) => ({ date: D, meal: 'almuerzo' as const, nutrients: n }))
  const report = buildReport(logs, [], D, D, { excludeIncomplete: false })
  const dri = getDri({ sex, birthDate: '1995-01-01', on: D, energyKcal: goalKcal })
  const rows = Object.fromEntries(buildSections(report, dri, goalKcal).flatMap((s) => s.rows.map((r) => [r.code, r])))
  return rows
}

describe('nutrient rows', () => {
  it('shows "Sin dato" and no bar for a nutrient nobody carries', () => {
    const r = sections([{ kcal: 500, protein: 20 }])
    expect(r.vitD!.amountText).toBe('—')
    expect(r.vitD!.status.text).toBe('Sin dato')
    expect(r.vitD!.bar).toBeNull()
  })

  it('RDA row: percentage, reference and bar mark', () => {
    const r = sections([{ kcal: 500, iron: 9 }])
    expect(r.iron!.status.text).toBe('50 %')
    expect(r.iron!.refText).toContain('RDA 18 mg')
    expect(r.iron!.bar!.mark).toBeGreaterThan(0)
    expect(r.iron!.bar!.fill).toBeLessThan(r.iron!.bar!.mark!)
  })

  it('coverage hint appears below 80 % of the energy only', () => {
    expect(coverageHint(0.79, true)).toBe('datos en 79 % de la energía')
    expect(coverageHint(0.8, true)).toBeNull()
    expect(coverageHint(0.3, false)).toBeNull()
    const r = sections([{ kcal: 300, iron: 3 }, { kcal: 700 }])
    expect(r.iron!.coverageHint).toBe('datos en 30 % de la energía')
  })

  it('magnesium above the supplement UL is not an excess and shows the note', () => {
    const r = sections([{ kcal: 500, magnesium: 600 }])
    expect(r.magnesium!.status.tone).not.toBe('bad')
    expect(r.magnesium!.notes.join(' ')).toMatch(/solo a suplementos/)
  })

  it('zinc above its UL is flagged', () => {
    expect(sections([{ kcal: 500, zinc: 50 }]).zinc!.status.text).toBe('Por encima del UL')
  })

  it('sodium above the CDRR and saturated fat above 10 % of energy are flagged', () => {
    const r = sections([{ kcal: 1000, sodium: 3000, satFat: 15 }])
    expect(r.sodium!.status.text).toBe('Por encima del CDRR')
    expect(r.sodium!.refText).toContain('OMS < 2.000 mg')
    expect(r.satFat!.status.text).toBe('Por encima del límite') // 135 kcal / 1000 = 13.5 %
    expect(r.satFat!.refText).toContain('13,5 %')
  })

  it('macros against AMDR show the share of energy and the RDA of protein', () => {
    const r = sections([{ kcal: 1000, protein: 50, carbs: 125, fat: 33 }])
    expect(r.protein!.status.text).toContain('20 %')
    expect(r.protein!.status.text).toContain('dentro del rango')
    expect(r.protein!.notes[0]).toContain('RDA 46 g: 109 %')
    expect(r.protein!.bar!.band).not.toBeNull()
  })

  it('fiber target derives from the energy goal', () => {
    const r = sections([{ kcal: 1000, fiber: 14 }], 'female', 2000)
    expect(r.fiber!.refText).toContain('28 g')
    expect(r.fiber!.status.text).toBe('50 %')
  })

  it('unknown sex shows ranges and does not evaluate', () => {
    const r = sections([{ kcal: 1000, iron: 9 }], null)
    expect(r.iron!.refText).toContain('8–18 mg')
    expect(r.iron!.status.text).toBe('Falta el sexo en el perfil')
    expect(r.iron!.bar).toBeNull()
  })

  it('folate and vitamin A are labelled with their real form', () => {
    const r = sections([{ kcal: 500, folate: 100, vitA: 100 }])
    expect(r.folate!.qualifier).toMatch(/no DFE/)
    expect(r.vitA!.qualifier).toBe('µg RAE')
  })

  it('food water is informational', () => {
    const r = sections([{ kcal: 500, water: 800 }])
    expect(r.water!.status.text).toBe('Informativo')
    expect(r.water!.refText).toContain('agua total')
  })
})
