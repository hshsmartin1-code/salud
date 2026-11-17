import { describe, expect, it } from 'vitest'
import catalogRaw from '../../../public/data/exercises.json?raw'
import type { ProgressSet } from './exerciseProgress'
import { glyphFor, groupOfMuscle, inGroup, MUSCLE_GROUPS, MUSCLE_IDS, MUSCLE_TO_GROUP, setsPerGroup, setsPerMuscle } from './muscles'

// Synthetic data only; the catalog file is the app's own public dataset.
const catalog = JSON.parse(catalogRaw) as {
  labelsEs: { muscles: Record<string, string> }
  exercises: { primaryMuscles: string[]; secondaryMuscles: string[]; equipment: string | null; category: string }[]
}

describe('muscle groups', () => {
  it('maps exactly the 17 catalog muscle ids', () => {
    expect([...MUSCLE_IDS].sort()).toEqual(Object.keys(catalog.labelsEs.muscles).sort())
    expect(MUSCLE_IDS).toHaveLength(17)
  })
  it('every muscle used by any exercise has a declared group', () => {
    const ids = new Set(MUSCLE_GROUPS.map((g) => g.id))
    for (const e of catalog.exercises) for (const m of [...e.primaryMuscles, ...e.secondaryMuscles]) expect(ids.has(MUSCLE_TO_GROUP[m]!), m).toBe(true)
  })
  it('inGroup looks at primary muscles only', () => {
    expect(inGroup({ primaryMuscles: ['quadriceps'] }, 'legs')).toBe(true)
    expect(inGroup({ primaryMuscles: ['quadriceps'] }, 'glutes')).toBe(false)
    expect(groupOfMuscle('lats')).toBe('back')
    expect(groupOfMuscle('nope')).toBeNull()
  })
})

let n = 0
const s = (exerciseId: string, p: Partial<ProgressSet> = {}): ProgressSet & { exerciseId: string } => ({
  id: `s${++n}`,
  sessionId: 'x',
  date: '2026-11-01',
  setIndex: n,
  weight: 50,
  reps: 8,
  durationSec: null,
  distanceM: null,
  isWarmup: false,
  done: true,
  exerciseId,
  ...p,
})
const cat = new Map([
  ['squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings'] }],
  ['row', { primaryMuscles: ['middle back', 'lats'], secondaryMuscles: ['biceps'] }],
])

describe('setsPerMuscle', () => {
  const out = setsPerMuscle(
    [s('squat'), s('squat'), s('squat', { isWarmup: true }), s('squat', { done: false }), s('squat', { excludeFromStats: true }), s('row'), s('ghost')],
    cat,
  )
  const get = (m: string) => out.find((x) => x.muscle === m)
  it('counts work sets per primary muscle only', () => {
    expect(get('quadriceps')).toMatchObject({ sets: 2, secondarySets: 0, group: 'legs' })
    expect(get('lats')!.sets).toBe(1)
    expect(get('middle back')!.sets).toBe(1)
  })
  it('keeps secondary involvement apart, never merged into `sets`', () => {
    expect(get('glutes')).toMatchObject({ sets: 0, secondarySets: 2 })
    expect(get('biceps')).toMatchObject({ sets: 0, secondarySets: 1 })
  })
  it('is sorted by sets descending and ignores unknown exercises', () => {
    expect(out[0]!.muscle).toBe('quadriceps')
    expect(out.some((x) => x.muscle === 'ghost')).toBe(false)
  })
  it('rolls up to groups (primary only)', () => {
    const groups = setsPerGroup(out)
    expect(groups.find((g) => g.group === 'legs')!.sets).toBe(2)
    expect(groups.find((g) => g.group === 'back')!.sets).toBe(2)
    expect(groups.find((g) => g.group === 'glutes')!.sets).toBe(0)
  })
})

describe('glyphFor', () => {
  it('uses the category for stretching and cardio, otherwise the equipment', () => {
    expect(glyphFor({ equipment: 'barbell', category: 'strength' })).toBe('barbell')
    expect(glyphFor({ equipment: 'barbell', category: 'stretching' })).toBe('stretch')
    expect(glyphFor({ equipment: null, category: 'strength' })).toBe('bodyweight')
    expect(glyphFor({ equipment: 'body only', category: 'cardio' })).toBe('cardio')
    expect(glyphFor({ equipment: 'e-z curl bar', category: 'strength' })).toBe('barbell')
    expect(glyphFor({ equipment: 'other', category: 'strength' })).toBe('other')
  })
  it('every catalog exercise gets a glyph', () => {
    for (const e of catalog.exercises) expect(glyphFor(e)).toBeTruthy()
  })
})
