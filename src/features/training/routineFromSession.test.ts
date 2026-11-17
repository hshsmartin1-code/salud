import { describe, expect, it } from 'vitest'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { routineFromSession, targetRepsFromSets, uniqueRoutineName } from './routineFromSession'

// Synthetic data only.
let seq = 0
function set(exerciseId: string, setIndex: number, p: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: `set-${seq++}`,
    profileId: 'p',
    createdAt: '2026-11-10T18:00:00.000Z',
    updatedAt: '2026-11-10T18:00:00.000Z',
    sessionId: 's1',
    date: '2026-11-10',
    exerciseId,
    exerciseName: exerciseId,
    setIndex,
    weight: 60,
    reps: 8,
    durationSec: null,
    distanceM: null,
    rpe: null,
    isWarmup: false,
    done: true,
    ...p,
  }
}

const session: Pick<TrainingSession, 'id' | 'name' | 'exerciseOrder'> = {
  id: 's1',
  name: 'Pierna sintética',
  exerciseOrder: [
    { exerciseId: 'squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 150, notes: 'Barra a la altura del pecho' },
    { exerciseId: 'curl', name: 'Curl femoral', trackingType: 'weight_reps', restSec: 75 },
    { exerciseId: 'plank', name: 'Plancha', trackingType: 'time', restSec: 60 },
    { exerciseId: 'skipped', name: 'Sin hacer', trackingType: 'weight_reps', restSec: 90 },
    { exerciseId: 'run', name: 'Carrera', trackingType: 'distance', restSec: 0 },
  ],
}

describe('routineFromSession', () => {
  it('keeps the order, counts completed work sets and turns reps into a number or a range', () => {
    const sets = [
      set('squat', 0, { isWarmup: true, kind: 'warmup', reps: 12 }), // warm-up: never counted
      set('squat', 1, { reps: 8 }),
      set('squat', 2, { reps: 8 }),
      set('squat', 3, { reps: 7, kind: 'failure' }), // failure sets are work sets
      set('squat', 4, { reps: 20, done: false }), // not done: ignored
      set('curl', 0, { reps: 10 }),
      set('curl', 1, { reps: 12 }),
      set('plank', 0, { weight: null, reps: null, durationSec: 45 }),
      set('plank', 1, { weight: null, reps: null, durationSec: 60 }),
      set('skipped', 0, { done: false }),
      set('run', 0, { weight: null, reps: null, distanceM: 2500, durationSec: 900 }),
      set('squat', 9, { sessionId: 'other' }), // another session
    ]
    const r = routineFromSession(session, sets, { makeKey: (i) => `k${i}` })
    expect(r).toEqual({
      name: 'Pierna sintética',
      exercises: [
        { key: 'k0', exerciseId: 'squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 3, targetReps: '7-8', restSec: 150, warmupSets: 1, notes: 'Barra a la altura del pecho' },
        { key: 'k1', exerciseId: 'curl', name: 'Curl femoral', trackingType: 'weight_reps', targetSets: 2, targetReps: '10-12', restSec: 75 },
        { key: 'k2', exerciseId: 'plank', name: 'Plancha', trackingType: 'time', targetSets: 2, targetReps: '45-60 s', restSec: 60 },
        { key: 'k3', exerciseId: 'run', name: 'Carrera', trackingType: 'distance', targetSets: 1, targetReps: '2,5 km', restSec: 0 },
      ],
    })
  })

  it('turns completed warm-up rows into warmupSets (undone warm-ups are ignored)', () => {
    const r = routineFromSession(session, [set('curl', 0, { isWarmup: true, kind: 'warmup' }), set('curl', 1, { isWarmup: true, kind: 'warmup', done: false }), set('curl', 2, { reps: 10 })], { makeKey: () => 'x' })
    expect(r.exercises[0]).toMatchObject({ targetSets: 1, warmupSets: 1 })
  })

  it('uses a single number when every set had the same reps, and the given name', () => {
    const r = routineFromSession(session, [set('curl', 0, { reps: 10 }), set('curl', 1, { reps: 10 })], { name: '  Curl  ', makeKey: () => 'x' })
    expect(r.name).toBe('Curl')
    expect(r.exercises).toHaveLength(1)
    expect(r.exercises[0]).toMatchObject({ targetSets: 2, targetReps: '10' })
    expect('notes' in r.exercises[0]!).toBe(false)
  })

  it('an empty session gives a routine without exercises', () => {
    expect(routineFromSession(session, []).exercises).toEqual([])
  })

  it('targetRepsFromSets: empty when nothing was recorded', () => {
    expect(targetRepsFromSets([{ reps: null, durationSec: null, distanceM: null }], 'weight_reps')).toBe('')
    expect(targetRepsFromSets([{ reps: 5, durationSec: null, distanceM: null }], 'bodyweight_reps')).toBe('5')
  })

  it('uniqueRoutineName avoids clashes, ignoring case', () => {
    expect(uniqueRoutineName('Pierna A', ['Torso A'])).toBe('Pierna A')
    expect(uniqueRoutineName('Pierna A', ['pierna a'])).toBe('Pierna A (copia)')
    expect(uniqueRoutineName('Pierna A', ['pierna a', 'Pierna A (copia)'])).toBe('Pierna A (copia 2)')
  })
})
