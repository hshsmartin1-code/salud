/** Which rings «Tu día» draws, and how it is described to a screen reader (pure). */
import { formatNumber } from '../../domain/units'
import type { RingSpec } from '../../ui/charts'

interface Day {
  kcal: number | null
  kcalTarget: number | null
  protein: number | null
  proteinTarget: number | null
  steps: number | null
  stepGoal: number | null
}

const fmt = (n: number | null) => (n === null ? 'sin datos' : formatNumber(n, 0))
const has = (n: number | null): n is number => typeof n === 'number' && n > 0

/** Energy and protein always; steps only when there is a goal to measure them against (no goal, no ring, no track). */
export function dayRings(i: Day): RingSpec[] {
  const rings: RingSpec[] = [
    { key: 'kcal', value: i.kcal, max: i.kcalTarget, colorVar: 'energy', label: 'Energía' },
    { key: 'prot', value: i.protein, max: i.proteinTarget, colorVar: 'protein', label: 'Proteína' },
  ]
  if (has(i.stepGoal)) rings.push({ key: 'move', value: i.steps, max: i.stepGoal, colorVar: 'move', label: 'Pasos' })
  return rings
}

/** A goal is announced only when it exists. */
export function dayLabel(i: Day): string {
  const part = (name: string, v: number | null, t: number | null, unit: string) => `${name} ${fmt(v)}${has(t) ? ` de ${formatNumber(t, 0)}` : ''}${unit ? ` ${unit}` : ''}`
  const parts = [part('Energía', i.kcal, i.kcalTarget, 'kcal'), part('proteína', i.protein, i.proteinTarget, 'g')]
  if (has(i.stepGoal)) parts.push(part('pasos', i.steps, i.stepGoal, ''))
  return parts.join('; ')
}
