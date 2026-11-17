import { describe, expect, it } from 'vitest'
import type { SessionExercise, TrainingSession } from '../db/types'
import { encodeRow } from './codec'
import { describeFromSets, mergeNotes, mergeSessionRows } from './sessionMerge'

type S = TrainingSession & Record<string, unknown>
const bytes = (s: object) => encodeRow('trainingSessions', s as never, 'p').d

const ex = (exerciseId: string, extra: Partial<SessionExercise> = {}): SessionExercise => ({ exerciseId, name: exerciseId.toUpperCase(), trackingType: 'weight_reps', restSec: 90, ...extra })
const base = (over: Partial<S> = {}): S =>
  ({
    id: 'ses-1',
    profileId: 'p',
    date: '2026-11-10',
    name: 'Empuje',
    routineId: 'r1',
    status: 'active',
    startedAt: '2026-11-10T10:00:00.000Z',
    endedAt: null,
    restEndsAt: null,
    exerciseOrder: [ex('a'), ex('b')],
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...over,
  }) as S

/** Small deterministic PRNG (mulberry32) for generated cases. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function generate(r: () => number): S {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const done = r() < 0.5
  const ids = ['a', 'b', 'c', 'd', 'e'].filter(() => r() < 0.6)
  const order = ids.sort(() => r() - 0.5).map((id) => ex(id, { restSec: pick([60, 90, 120]), ...(r() < 0.4 ? { targetReps: pick(['8-10', '5', '12']) } : {}), ...(r() < 0.4 ? { notes: pick(['agarre ancho', 'banco 30°', 'agarre ancho\nlento']) } : {}) }))
  const minute = (m: number) => `2026-11-10T10:${String(m).padStart(2, '0')}:00.000Z`
  const notes = pick([undefined, 'buena sesión', 'buena sesión\nhombro molesto', 'hombro molesto', '  buena sesión  '])
  return base({
    name: pick(['Empuje', 'Empuje A', 'Pecho']),
    status: done ? 'done' : 'active',
    startedAt: pick([minute(0), minute(2), null]),
    endedAt: done ? pick([minute(40), minute(45), null]) : null,
    exerciseOrder: order,
    updatedAt: pick([minute(10), minute(20), minute(30)]),
    createdAt: pick([minute(0), minute(1)]),
    ...(notes !== undefined ? { notes } : {}),
  })
}

describe('mergeSessionRows: properties', () => {
  const r = rng(20261115)
  const cases = Array.from({ length: 400 }, () => {
    const a = generate(r)
    const b = generate(r)
    const sets = ['a', 'b', 'c', 'd', 'e', 'f'].filter(() => r() < 0.4)
    return { a, b, sets }
  })

  it('keeps the id, is idempotent and commutative byte for byte (generated cases)', () => {
    for (const { a, b, sets } of cases) {
      const m = mergeSessionRows(a, b, sets)
      expect(m.id).toBe(a.id)
      expect(bytes(mergeSessionRows(b, a, sets))).toBe(bytes(m)) // two devices, same result
      expect(bytes(mergeSessionRows(m, b, sets))).toBe(bytes(m))
      expect(bytes(mergeSessionRows(m, a, sets))).toBe(bytes(m))
      expect(bytes(mergeSessionRows(b, m, sets))).toBe(bytes(m))
      expect(bytes(mergeSessionRows(m, m, sets))).toBe(bytes(m))
      expect(bytes(mergeSessionRows(a, a, sets.filter((s) => a.exerciseOrder.some((e) => e.exerciseId === s))))).toBe(bytes(a))
      expect(m.restEndsAt).toBeNull()
    }
  })

  it('never invents or drops an exercise that has sets, and lists each exercise once', () => {
    for (const { a, b, sets } of cases) {
      const ids = mergeSessionRows(a, b, sets).exerciseOrder.map((e) => e.exerciseId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const s of sets) expect(ids).toContain(s)
      const both = a.exerciseOrder.filter((e) => b.exerciseOrder.some((x) => x.exerciseId === e.exerciseId)).map((e) => e.exerciseId)
      for (const id of both) expect(ids).toContain(id)
      for (const id of ids) expect([...both, ...sets]).toContain(id)
    }
  })
})

describe('mergeSessionRows: field rules', () => {
  it('done wins, earliest start, latest end, rest timer cleared, newer edits for plain fields', () => {
    const a = base({ name: 'Empuje A', status: 'done', endedAt: '2026-11-10T10:50:00.000Z', updatedAt: '2026-11-10T10:50:00.000Z', restEndsAt: 1_794_000_000_000 })
    const b = base({ name: 'Empuje B', startedAt: '2026-11-10T09:58:00.000Z', updatedAt: '2026-11-10T11:00:00.000Z' })
    const m = mergeSessionRows(a, b, [])
    expect(m).toMatchObject({ status: 'done', startedAt: '2026-11-10T09:58:00.000Z', endedAt: '2026-11-10T10:50:00.000Z', restEndsAt: null, name: 'Empuje B', updatedAt: '2026-11-10T11:00:00.000Z' })
  })

  it('notes: the lines of both in canonical order, without repeating', () => {
    const a = base({ notes: 'hombro bien\ndormí poco', updatedAt: '2026-11-10T10:10:00.000Z' })
    const b = base({ notes: 'dormí poco\nsubir peso', updatedAt: '2026-11-10T10:20:00.000Z' })
    expect(mergeSessionRows(a, b, []).notes).toBe('dormí poco\nhombro bien\nsubir peso')
    expect(mergeNotes('a', 'a\nb', true)).toBe('a\nb') // contained, already canonical
    expect(mergeNotes(undefined, undefined, null)).toBeUndefined()
  })

  it('note unions converge for every grouping, including subsets, spacing, duplicates and empty notes', () => {
    const samples = [undefined, '', ' ', 'a', 'b', 'c', 'a\nb', 'b\na', ' b \r\na\nb ', 'a\nc', 'z\nñ\nΩ']
    for (const a of samples) for (const b of samples) {
      const ab = mergeNotes(a, b, true)
      expect(mergeNotes(b, a, false)).toBe(ab)
      expect(mergeNotes(ab, a, null)).toBe(ab)
      expect(mergeNotes(ab, b, true)).toBe(ab)
      expect(mergeNotes(ab, ab, false)).toBe(ab)
      for (const c of samples) {
        const merged = mergeNotes(ab, c, true)
        expect(mergeNotes(mergeNotes(a, c, false), b, null)).toBe(merged)
        expect(mergeNotes(a, mergeNotes(b, c, null), false)).toBe(merged)
        expect(mergeNotes(merged, c, true)).toBe(merged)
      }
    }
  })

  it('session and exercise notes are byte-identical across three edit times and repeated merges', () => {
    const row = (notes: string, minute: string) => base({ notes, exerciseOrder: [ex('a', { notes })], updatedAt: `2026-11-10T10:${minute}:00.000Z` })
    const a = row('z\nb', '10'), b = row('b\na', '20'), c = row('c\nz', '30')
    const abc = mergeSessionRows(mergeSessionRows(a, b, ['a']), c, ['a'])
    const acb = mergeSessionRows(mergeSessionRows(a, c, ['a']), b, ['a'])
    expect(bytes(abc)).toBe(bytes(acb))
    expect(abc.notes).toBe('a\nb\nc\nz')
    expect(abc.exerciseOrder[0]!.notes).toBe(abc.notes)
    for (const version of [a, b, c, abc]) expect(bytes(mergeSessionRows(abc, version, ['a']))).toBe(bytes(abc))
  })

  it('exercise order: removed on one side without sets is dropped; added on one side is kept; sets keep an exercise', () => {
    const a = base({ exerciseOrder: [ex('a'), ex('b'), ex('c', { notes: 'agarre ancho' })], updatedAt: '2026-11-10T10:20:00.000Z' })
    const b = base({ exerciseOrder: [ex('b', { restSec: 120 }), ex('a'), ex('d'), ex('c', { notes: 'banco 30°' })], updatedAt: '2026-11-10T10:10:00.000Z' })
    // c: per-exercise notes are joined. d: listed by B only, kept because it has sets here. x: has sets
    // but neither lists it → appended. Without sets, an exercise listed by one side only is dropped.
    const m = mergeSessionRows(a, b, ['d', 'x'], describeFromSets([{ exerciseId: 'x', exerciseName: 'Remo', setIndex: 0, weight: 40, reps: 10 }]))
    expect(m.exerciseOrder.map((e) => e.exerciseId)).toEqual(['a', 'b', 'c', 'd', 'x'])
    expect(m.exerciseOrder.find((e) => e.exerciseId === 'b')!.restSec).toBe(90) // newer row's value
    expect(m.exerciseOrder.find((e) => e.exerciseId === 'c')!.notes).toBe('agarre ancho\nbanco 30°')
    expect(m.exerciseOrder.find((e) => e.exerciseId === 'x')).toEqual({ exerciseId: 'x', name: 'Remo', trackingType: 'weight_reps', restSec: 0 })
    expect(mergeSessionRows(a, b, []).exerciseOrder.map((e) => e.exerciseId)).toEqual(['a', 'b', 'c'])
  })

  it('exact tie: deterministic per-field choice, same on both devices', () => {
    const a = base({ name: 'Pecho', exerciseOrder: [ex('a'), ex('b')] })
    const b = base({ name: 'Empuje', exerciseOrder: [ex('b'), ex('a')] })
    expect(bytes(mergeSessionRows(a, b, []))).toBe(bytes(mergeSessionRows(b, a, [])))
    expect(mergeSessionRows(a, b, []).name).toBe('Pecho')
  })

  it('does not touch the input rows', () => {
    const a = base({ notes: 'x' })
    const b = base({ notes: 'y', updatedAt: '2026-11-11T00:00:00.000Z' })
    const before = JSON.stringify([a, b])
    mergeSessionRows(a, b, ['a'])
    expect(JSON.stringify([a, b])).toBe(before)
  })
})
