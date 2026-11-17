import { describe, expect, it } from 'vitest'
import type { TrainingPlan } from '../../../db/types'
import { moveDay, planFor } from './plan'

describe('move target conflicts', () => {
  it.each<TrainingPlan>([
    { days: { '1': { routineId: 'routine-a' } }, overrides: { '2026-11-17': { routineId: 'routine-b' } } },
    { days: { '1': { routineId: 'routine-a' }, '2': { routineId: 'routine-b' } } },
  ])('preserves both sessions if the destination now trains', (plan) => {
    // A target offered as rest can become occupied before the settings write reads the latest plan.
    const moved = moveDay(plan, '2026-11-16', '2026-11-17')
    expect(planFor(moved, '2026-11-16')).toEqual({ kind: 'train', routineId: 'routine-a' })
    expect(planFor(moved, '2026-11-17')).toEqual({ kind: 'train', routineId: 'routine-b' })
    expect(moved).toEqual(plan)
  })
})
