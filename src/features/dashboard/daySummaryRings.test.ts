import { describe, expect, it } from 'vitest'
import { dayLabel, dayRings } from './daySummaryRings'

describe('day rings', () => {
  const day = { kcal: 1785, kcalTarget: 2035, protein: 110, proteinTarget: 144, steps: 329, stepGoal: null as number | null }
  it('without a step goal there are two rings and the label announces no goal', () => {
    for (const stepGoal of [null, 0]) {
      const i = { ...day, stepGoal }
      expect(dayRings(i).map((r) => r.key)).toEqual(['kcal', 'prot'])
      expect(dayLabel(i)).not.toMatch(/pasos/)
      expect(dayLabel(i)).toMatch(/^Energía .+ de .+ kcal; proteína .+ de .+ g$/)
    }
  })
  it('with a goal the third ring and its target come back', () => {
    const i = { ...day, stepGoal: 8000 }
    expect(dayRings(i).map((r) => r.key)).toEqual(['kcal', 'prot', 'move'])
    expect(dayRings(i)[2]).toMatchObject({ value: 329, max: 8000 })
    expect(dayLabel(i)).toMatch(/pasos 329 de .*8.*000$/)
  })
  it('a missing figure or target is never announced as a number', () => {
    expect(dayLabel({ ...day, kcal: null, kcalTarget: null })).toMatch(/^Energía sin datos kcal; proteína 110 de 144 g$/)
  })
})
