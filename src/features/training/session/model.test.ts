import { describe, expect, it } from 'vitest'
import type { ExerciseSet } from '../../../db/types'
import { currentExerciseId, exerciseProgress, forgetToggles, formatPrevious, isExerciseOpen, lastTimeLine, sessionE1rm, sessionStats, setSignature, shortDate, spokenPrevious, targetLabel, workOrdinals } from './model'

// Synthetic data only.
let seq = 0
function set(p: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: `s${seq++}`,
    profileId: 'p',
    createdAt: '2026-11-10T18:00:00.000Z',
    updatedAt: '2026-11-10T18:00:00.000Z',
    sessionId: 'x',
    date: '2026-11-12',
    exerciseId: 'squat',
    exerciseName: 'Sentadilla',
    setIndex: 0,
    weight: 70,
    reps: 12,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    done: false,
    ...p,
  }
}

describe('session model', () => {
  it('stats: warm-ups never count in sets or volume; pending rows are what finishing discards', () => {
    const sets = [set({ isWarmup: true, kind: 'warmup', weight: 40, reps: 10, done: true }), set({ done: true, weight: 50, reps: 10 }), set({ kind: 'drop', done: true, weight: 50, reps: 10 }), set(), set({ isWarmup: true, kind: 'warmup' })]
    expect(sessionStats(sets)).toEqual({ workDone: 2, workTotal: 3, volume: 1000, pending: 2 })
    expect(exerciseProgress(sets)).toEqual({ done: 2, total: 3 })
  })

  it('the exercise in progress is the first with a pending row or without rows; manual toggles win', () => {
    const order = [{ exerciseId: 'a' }, { exerciseId: 'b' }, { exerciseId: 'c' }]
    const by = new Map([
      ['a', [set({ done: true })]],
      ['b', [set({ done: true }), set()]],
      ['c', [set()]],
    ])
    expect(currentExerciseId(order, by)).toBe('b')
    by.set('b', [set({ done: true })])
    expect(currentExerciseId(order, by)).toBe('c')
    by.set('c', [set({ done: true })])
    expect(currentExerciseId(order, by)).toBeNull()
    expect(currentExerciseId([...order, { exerciseId: 'd' }], by)).toBe('d') // just added, no rows yet
    expect(isExerciseOpen('a', 'b', {})).toBe(false)
    expect(isExerciseOpen('b', 'b', {})).toBe(true)
    expect(isExerciseOpen('a', 'b', { a: true })).toBe(true)
    expect(isExerciseOpen('b', 'b', { b: false })).toBe(false)
    // Moving on: the finished and the next exercise lose their manual toggles, others keep theirs.
    const manual = { a: true, b: false, c: true }
    expect(forgetToggles(manual, ['b', 'a'])).toEqual({ c: true })
    expect(forgetToggles(manual, ['x', null])).toBe(manual)
  })

  it('ordinals count work sets only', () => {
    expect(workOrdinals([set({ isWarmup: true }), set(), set({ kind: 'failure' }), set({ isWarmup: true }), set()])).toEqual([0, 1, 2, 0, 3])
  })

  it('formats the previous value per tracking type', () => {
    expect(formatPrevious(set({ weight: 72.5, reps: 12 }), 'weight_reps')).toBe('72,5 × 12')
    expect(formatPrevious(null, 'weight_reps')).toBe('—')
    expect(formatPrevious(set({ weight: null, reps: 12 }), 'bodyweight_reps')).toBe('12')
    expect(formatPrevious(set({ weight: 5, reps: 12 }), 'bodyweight_reps')).toBe('+5 × 12')
    expect(formatPrevious(set({ durationSec: 84 }), 'time')).toBe('1:24')
    expect(formatPrevious(set({ distanceM: 2500, durationSec: 870 }), 'distance')).toBe('2,5 · 14:30')
    expect(spokenPrevious(set({ weight: 70, reps: 12 }), 'weight_reps')).toBe('70 kilos por 12 repeticiones')
  })

  it('target and context lines', () => {
    expect(targetLabel({ targetSets: 3, targetReps: '8-10' })).toBe('3 × 8–10')
    expect(targetLabel({ targetSets: 3 })).toBe('3 series')
    expect(targetLabel({})).toBeNull()
    expect(shortDate('2026-11-12')).toBe('12 nov')
    expect(lastTimeLine([set({ weight: 80, reps: 9 }), set({ weight: 85, reps: 9 })], 'weight_reps')).toBe('Última vez 12 nov · mejor 85 kg × 9')
    expect(lastTimeLine([], 'weight_reps')).toBeNull()
  })

  it('row signature changes with anything the row shows', () => {
    const a = set()
    expect(setSignature(a)).toBe(setSignature({ ...a, updatedAt: 'later' }))
    expect(setSignature(a)).not.toBe(setSignature({ ...a, reps: 11 }))
    expect(setSignature(a)).not.toBe(setSignature({ ...a, done: true }))
    expect(setSignature(a)).not.toBe(setSignature({ ...a, notes: 'n' }))
  })
})

describe('sessionE1rm', () => {
  it('uses done work sets of 1 to 10 reps only (linear equations, Reynolds 2006); warm-ups, pending rows and longer sets give none', () => {
    expect(sessionE1rm([set({ done: true, weight: 100, reps: 5 })])).toBeCloseTo(100 * (1 + 5 / 30), 6)
    expect(sessionE1rm([set({ done: true, weight: 100, reps: 5 }), set({ done: true, weight: 95, reps: 10 })])).toBeCloseTo(95 * (1 + 10 / 30), 6)
    // 12 reps used to give an estimate (90 × 1,4 = 126 > 116,7); beyond 10 reps there is none, so the 5-rep set wins.
    expect(sessionE1rm([set({ done: true, weight: 100, reps: 5 }), set({ done: true, weight: 90, reps: 12 })])).toBeCloseTo(100 * (1 + 5 / 30), 6)
    expect(sessionE1rm([set({ done: true, weight: 100, reps: 11 })])).toBeNull()
    expect(sessionE1rm([set({ done: true, weight: 200, reps: 3, isWarmup: true, kind: 'warmup' })])).toBeNull()
    expect(sessionE1rm([set({ done: false, weight: 100, reps: 5 })])).toBeNull()
    expect(sessionE1rm([set({ done: true, weight: null, reps: 5 })])).toBeNull()
  })
})
