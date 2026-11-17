import { describe, expect, it } from 'vitest'
import type { ExerciseSet } from '../../../db/types'
import { parseRepRange, progressionHint, progressionStep, progressionText } from './progression'

// Synthetic data only.
let n = 0
const set = (weight: number | null, reps: number | null, extra: Partial<ExerciseSet> = {}): ExerciseSet =>
  ({ id: `s${n++}`, profileId: 'p', sessionId: 'prev', date: '2026-11-10', exerciseId: 'e', exerciseName: 'E', setIndex: n, weight, reps, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, createdAt: '', updatedAt: '', ...extra }) as ExerciseSet

const base = { tracking: 'weight_reps' as const, targetReps: '8-12', equipment: 'barbell' }

describe('progression hint', () => {
  it('parses strict rep ranges only', () => {
    expect(parseRepRange('8-12')).toEqual([8, 12])
    expect(parseRepRange(' 6 – 8 ')).toEqual([6, 8])
    expect(parseRepRange('8')).toBeNull()
    expect(parseRepRange('12-8')).toBeNull()
    expect(parseRepRange('30-60 s')).toBeNull()
    expect(parseRepRange('8-12 reps')).toBeNull()
    expect(parseRepRange(undefined)).toBeNull()
  })

  it('suggests +2,5 kg when every work set reached the top of the range with the same weight', () => {
    const h = progressionHint({ ...base, previous: [set(40, 10, { isWarmup: true, kind: 'warmup' }), set(60, 12), set(60, 12), set(60, 13), set(60, 12)] })
    expect(h).toEqual({ sets: 4, reps: 12, weight: 60, step: 2.5, suggested: 62.5 })
    expect(progressionText(h!)).toBe('La vez anterior completaste 4 × 12: prueba +2,5 kg')
  })

  it('uses 2 kg steps for dumbbells and kettlebells', () => {
    expect(progressionStep('dumbbell')).toBe(2)
    expect(progressionStep('kettlebells')).toBe(2)
    expect(progressionStep('machine')).toBe(2.5)
    expect(progressionStep(null)).toBe(2.5)
    expect(progressionHint({ ...base, equipment: 'dumbbell', previous: [set(20, 12), set(20, 12)] })?.suggested).toBe(22)
  })

  it('no hint: no previous session, mixed reps, mixed weights, undone sets only', () => {
    expect(progressionHint({ ...base, previous: undefined })).toBeNull()
    expect(progressionHint({ ...base, previous: [] })).toBeNull()
    expect(progressionHint({ ...base, previous: [set(60, 12), set(60, 11)] })).toBeNull()
    expect(progressionHint({ ...base, previous: [set(60, 12), set(62.5, 12)] })).toBeNull()
    expect(progressionHint({ ...base, previous: [set(60, 12, { done: false })] })).toBeNull()
  })

  it('no hint without a range, or for bodyweight, time and distance exercises', () => {
    const prev = [set(60, 12), set(60, 12)]
    expect(progressionHint({ ...base, targetReps: '12', previous: prev })).toBeNull()
    expect(progressionHint({ ...base, targetReps: undefined, previous: prev })).toBeNull()
    expect(progressionHint({ ...base, tracking: 'bodyweight_reps', previous: prev })).toBeNull()
    expect(progressionHint({ ...base, tracking: 'time', previous: prev })).toBeNull()
    expect(progressionHint({ ...base, tracking: 'distance', previous: prev })).toBeNull()
    expect(progressionHint({ ...base, previous: [set(null, 12), set(null, 12)] })).toBeNull()
  })
})
