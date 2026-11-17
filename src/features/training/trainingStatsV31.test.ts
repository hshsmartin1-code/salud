import { describe, expect, it } from 'vitest'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { bestLifts, prepareStats, sessionExerciseLines, sessionMuscleSplit, trainingTotals, weeklySeries, weeklyVolumeMean, workSetsPerGroupRange, type CatalogMuscles } from './trainingStats'

// Synthetic data only. Today is Wednesday 2026-11-18: the week of 2026-11-16 is in progress.
const TODAY = '2026-11-18'
let n = 0
const base = { profileId: 'p', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
function session(date: string, extra: Partial<TrainingSession> = {}): TrainingSession {
  return { ...base, id: extra.id ?? `s${++n}`, date, name: 'Sesión', routineId: null, status: 'done', startedAt: `${date}T18:00:00.000Z`, endedAt: null, restEndsAt: null, exerciseOrder: [], durationMin: 60, ...extra }
}
function set(sessionId: string, date: string, extra: Partial<ExerciseSet> = {}): ExerciseSet {
  return { ...base, id: `x${++n}`, sessionId, date, exerciseId: 'squat', exerciseName: 'Sentadilla', setIndex: 0, weight: 100, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, ...extra }
}
const catalog: CatalogMuscles = new Map([
  ['squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: [] }],
  ['bench', { primaryMuscles: ['chest'], secondaryMuscles: [] }],
  ['row', { primaryMuscles: ['lats', 'middle back'], secondaryMuscles: [] }],
  ['mixed', { primaryMuscles: ['chest', 'quadriceps'], secondaryMuscles: [] }],
])

describe('sessionMuscleSplit', () => {
  it('shares the completed work sets between groups, largest first, adding up to 1', () => {
    const s = session('2026-11-17')
    const sets = [
      ...Array.from({ length: 3 }, () => set(s.id, s.date)),
      set(s.id, s.date, { exerciseId: 'bench' }),
      set(s.id, s.date, { exerciseId: 'row' }), // lats + middle back are one group
    ]
    const split = sessionMuscleSplit(sets, catalog)
    expect(split.map((x) => [x.group, x.sets])).toEqual([['legs', 3], ['back', 1], ['chest', 1]])
    expect(split[0]!.share).toBeCloseTo(3 / 5)
    expect(split.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1)
  })
  it('ignores warm-ups, undone and excluded sets and exercises missing from the catalog', () => {
    const s = session('2026-11-17')
    const sets = [
      set(s.id, s.date, { exerciseId: 'bench' }),
      set(s.id, s.date, { exerciseId: 'bench', isWarmup: true, kind: 'warmup' }),
      set(s.id, s.date, { exerciseId: 'bench', done: false }),
      set(s.id, s.date, { exerciseId: 'bench', excludeFromStats: true }),
      set(s.id, s.date, { exerciseId: 'unknown' }),
    ]
    expect(sessionMuscleSplit(sets, catalog)).toEqual([{ group: 'chest', sets: 1, share: 1 }])
  })
  it('splits a set with primary muscles in two groups equally and is empty without work', () => {
    const s = session('2026-11-17')
    const split = sessionMuscleSplit([set(s.id, s.date, { exerciseId: 'mixed' }), set(s.id, s.date, { exerciseId: 'bench' })], catalog)
    expect(split.find((x) => x.group === 'chest')).toMatchObject({ sets: 2, share: 0.75 })
    expect(split.find((x) => x.group === 'legs')).toMatchObject({ sets: 1, share: 0.25 })
    expect(sessionMuscleSplit([], catalog)).toEqual([])
  })
})

function history() {
  const old = session('2025-12-20', { durationMin: 50 })
  const early = session('2026-01-05', { durationMin: 40 })
  const prev = session('2026-11-10', { durationMin: 60 })
  const now = session('2026-11-17', { durationMin: 45 }) // the week in progress
  const untimed = session('2026-11-18', { durationMin: undefined })
  const sets = [
    set(old.id, old.date, { weight: 90, reps: 5 }),
    set(early.id, early.date, { weight: 80, reps: 10, exerciseId: 'bench', exerciseName: 'Press banca' }),
    set(prev.id, prev.date, { weight: 100, reps: 5 }),
    set(prev.id, prev.date, { weight: 110, reps: 3 }),
    set(now.id, now.date, { weight: 60, reps: 10, exerciseId: 'bench', exerciseName: 'Press banca' }),
    set(untimed.id, untimed.date, { weight: 100, reps: 4 }),
    set(untimed.id, untimed.date, { weight: 40, reps: 10, isWarmup: true }),
  ]
  return prepareStats([old, early, prev, now, untimed], sets)
}

describe('trainingTotals', () => {
  it('sums sessions, work sets, minutes and kg lifted over a range', () => {
    const p = history()
    expect(trainingTotals(p)).toEqual({ sessions: 5, workSets: 6, durationMin: 50 + 40 + 60 + 45, volume: 450 + 800 + 500 + 330 + 600 + 400 })
    expect(trainingTotals(p, '2026-01-01', TODAY)).toEqual({ sessions: 4, workSets: 5, durationMin: 40 + 60 + 45, volume: 800 + 500 + 330 + 600 + 400 })
  })
  it('is all zeros for an empty profile', () => {
    expect(trainingTotals(prepareStats([], []))).toEqual({ sessions: 0, workSets: 0, durationMin: 0, volume: 0 })
  })
})

describe('weekly chart data with a week in progress', () => {
  it('keeps the week in progress out of the mean and marks it', () => {
    const p = history()
    const weeks = weeklySeries(p, TODAY, 3)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    const { complete, inProgress, mean } = weeklyVolumeMean(weeks, TODAY)
    expect(complete.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09'])
    expect(inProgress?.weekStart).toBe('2026-11-16')
    expect(inProgress?.sessions).toBe(2)
    expect(mean).toBe((0 + 830) / 2)
  })
  it('has no weeks for an empty profile', () => {
    expect(weeklySeries(prepareStats([], []), TODAY, 10)).toEqual([])
  })
})

describe('bestLifts', () => {
  it('lists the heaviest work set per exercise, heaviest first, never warm-ups', () => {
    const lifts = bestLifts(history(), 5)
    expect(lifts.map((l) => [l.exerciseId, l.weight, l.reps, l.date])).toEqual([
      ['squat', 110, 3, '2026-11-10'],
      ['bench', 80, 10, '2026-01-05'],
    ])
    expect(bestLifts(history(), 1)).toHaveLength(1)
    expect(bestLifts(prepareStats([], []))).toEqual([])
  })
})

describe('workSetsPerGroupRange', () => {
  it('counts the window inclusively', () => {
    const p = history()
    expect(workSetsPerGroupRange(p, '2026-10-22', TODAY, catalog)).toEqual([
      { group: 'legs', sets: 3 },
      { group: 'chest', sets: 1 },
    ])
    expect(workSetsPerGroupRange(p, '2026-11-11', TODAY, catalog).map((g) => g.group)).toEqual(['chest', 'legs'])
  })
})

describe('sessionExerciseLines', () => {
  it('lists what was done, in session order, skipping exercises without completed work sets', () => {
    const s = session('2026-11-17', {
      exerciseOrder: [
        { exerciseId: 'squat', name: 'Sentadilla con barra', trackingType: 'weight_reps', restSec: 120 },
        { exerciseId: 'row', name: 'Remo', trackingType: 'weight_reps', restSec: 90 },
        { exerciseId: 'bench', name: 'Press banca', trackingType: 'weight_reps', restSec: 90 },
      ],
    })
    const p = prepareStats([s], [set(s.id, s.date), set(s.id, s.date), set(s.id, s.date, { exerciseId: 'bench' }), set(s.id, s.date, { exerciseId: 'row', done: false })])
    expect(sessionExerciseLines(p, p.sessions[0]!)).toEqual([
      { exerciseId: 'squat', name: 'Sentadilla con barra', sets: 2 },
      { exerciseId: 'bench', name: 'Press banca', sets: 1 },
    ])
  })
})
