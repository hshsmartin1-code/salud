import { describe, expect, it } from 'vitest'
import type { Routine, RoutineExercise } from '../../db/types'
import {
  archivedRoutines,
  buildRoutine,
  copyName,
  describeExercise,
  draftFromRoutine,
  duplicateItem,
  duplicateRoutine,
  formatRest,
  habitualRoutine,
  hasManualOrder,
  insertItem,
  isDirty,
  moveItem,
  moveRoutine,
  moveRoutineTo,
  filterRoutines,
  orderAfter,
  patchExercise,
  patchFromDraft,
  removeItem,
  sortRoutines,
} from './routines'

// Synthetic data only.
const stamp = { profileId: 'p', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const ex = (key: string, extra: Partial<RoutineExercise> = {}): RoutineExercise => ({ key, exerciseId: `e-${key}`, name: `Ejercicio ${key}`, trackingType: 'weight_reps', targetSets: 3, targetReps: '8-10', restSec: 120, ...extra })
const rt = (id: string, name: string, extra: Partial<Routine> = {}): Routine => ({ ...stamp, id, name, exercises: [ex('a')], ...extra })

describe('sortRoutines', () => {
  const none = new Map<string, string>()
  it('sorts by last use (most recent first, never used last, then name) when nobody ordered the list', () => {
    const list = [rt('a', 'Pierna'), rt('b', 'Brazos'), rt('c', 'Torso'), rt('d', 'Archivada', { archived: true })]
    const used = new Map([
      ['a', '2026-11-01'],
      ['c', '2026-11-09'],
    ])
    expect(sortRoutines(list, used).map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(hasManualOrder(list)).toBe(false)
  })
  it('puts manually ordered routines first, in their order, then the rest by use', () => {
    const list = [rt('a', 'A', { order: 1 }), rt('b', 'B'), rt('c', 'C', { order: 0 }), rt('d', 'D')]
    expect(sortRoutines(list, new Map([['d', '2026-11-01']])).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b'])
    expect(hasManualOrder(list)).toBe(true)
    expect(hasManualOrder([rt('x', 'X', { order: 2, archived: true })])).toBe(false)
  })
  it('does not mutate its input and lists archived routines apart', () => {
    const list = [rt('b', 'B'), rt('a', 'A', { archived: true })]
    const copy = JSON.stringify(list)
    sortRoutines(list, none)
    expect(JSON.stringify(list)).toBe(copy)
    expect(archivedRoutines(list).map((r) => r.id)).toEqual(['a'])
  })
  it('habitualRoutine is the most recently used one even in manual order, else the first', () => {
    const list = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 })]
    expect(habitualRoutine(list, new Map([['b', '2026-11-09']]))?.id).toBe('b')
    expect(habitualRoutine(list, none)?.id).toBe('a')
    expect(habitualRoutine([], none)).toBeNull()
    expect(habitualRoutine([rt('z', 'Z', { archived: true })], new Map([['z', '2026-11-09']]))).toBeNull()
  })
})

describe('moveRoutine', () => {
  it('numbers the whole list on the first manual move and returns only rows that change', () => {
    const display = [rt('a', 'A'), rt('b', 'B'), rt('c', 'C')]
    expect(moveRoutine(display, 'b', -1)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
      { id: 'c', order: 2 },
    ])
  })
  it('on a list that is already numbered 0..n-1 only the two swapped rows are returned', () => {
    const display = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 }), rt('c', 'C', { order: 2 })]
    expect(moveRoutine(display, 'c', -1)).toEqual([
      { id: 'c', order: 1 },
      { id: 'b', order: 2 },
    ])
  })
  it('swaps the positions of two rows when all positions already exist', () => {
    const display = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 }), rt('c', 'C', { order: 5 })]
    expect(moveRoutine(display, 'b', 1)).toEqual([
      { id: 'b', order: 5 },
      { id: 'c', order: 1 },
    ])
  })
  it('does nothing at the ends or for an unknown id', () => {
    const display = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 })]
    expect(moveRoutine(display, 'a', -1)).toEqual([])
    expect(moveRoutine(display, 'b', 1)).toEqual([])
    expect(moveRoutine(display, 'zz', 1)).toEqual([])
  })
  it('renumbers duplicated positions', () => {
    const display = [rt('a', 'A', { order: 1 }), rt('b', 'B', { order: 1 })]
    expect(moveRoutine(display, 'b', -1)).toEqual([
      { id: 'b', order: 0 },

    ])
  })
})

describe('orderAfter', () => {
  it('is undefined for an automatic list and a position between neighbours otherwise', () => {
    expect(orderAfter([rt('a', 'A')], 'a')).toBeUndefined()
    const display = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 })]
    expect(orderAfter(display, 'a')).toBe(0.5)
    expect(orderAfter(display, 'b')).toBe(2)
    expect(orderAfter(display, null)).toBe(2)
  })
})

describe('duplicateRoutine', () => {
  it('copies every property (unknown ones too) with new identity, keys and a unique name', () => {
    const src = { ...rt('a', 'Pierna A', { notes: 'n', archived: true, order: 3 }), futureField: { x: 1 } } as Routine
    src.exercises = [ex('k1', { warmupSets: 2, notes: 'agarre', extra: 'keep' } as Partial<RoutineExercise>), ex('k2')]
    let i = 0
    const copy = duplicateRoutine(src, ['Pierna A', 'Pierna A (copia)'], () => `new${++i}`, 3.5) as unknown as Record<string, unknown> & { exercises: (RoutineExercise & { extra?: string })[] }
    expect(copy.name).toBe('Pierna A (copia 2)')
    expect(copy.notes).toBe('n')
    expect(copy.futureField).toEqual({ x: 1 })
    expect(copy.order).toBe(3.5)
    for (const k of ['id', 'profileId', 'createdAt', 'updatedAt', 'archived']) expect(k in copy).toBe(false)
    expect(copy.exercises.map((e) => e.key)).toEqual(['new1', 'new2'])
    expect(copy.exercises[0]).toMatchObject({ warmupSets: 2, notes: 'agarre', extra: 'keep', exerciseId: 'e-k1' })
    expect(src.exercises[0]!.key).toBe('k1') // the original is untouched
  })
  it('omits order when there is no position', () => {
    expect('order' in duplicateRoutine(rt('a', 'A', { order: 4 }), [], () => 'k')).toBe(false)
  })
  it('names copies', () => {
    expect(copyName('Torso', [])).toBe('Torso (copia)')
    expect(copyName('Torso (copia)', ['Torso', 'Torso (copia)'])).toBe('Torso (copia 2)')
    expect(copyName('Torso (copia 2)', ['Torso (copia)', 'Torso (copia 2)'])).toBe('Torso (copia 3)')
  })
})

describe('editor draft', () => {
  const stored = { ...rt('a', 'Pierna', { notes: 'x', archived: false, order: 2 }), unknownRowField: 7 } as Routine
  stored.exercises = [{ ...ex('k1'), unknownExerciseField: 'keep' } as RoutineExercise, ex('k2', { warmupSets: 0, notes: '' })]

  it('is not dirty until something changes (name and notes compared trimmed)', () => {
    const d = draftFromRoutine(stored)
    expect(isDirty(d, { ...d })).toBe(false)
    expect(isDirty(d, { ...d, name: ' Pierna ' })).toBe(false)
    expect(isDirty(d, { ...d, name: 'Pierna B' })).toBe(true)
    expect(isDirty(d, { ...d, exercises: moveItem(d.exercises, 0, 1) })).toBe(true)
  })
  it('keeps every property of the row and of each exercise it does not show', () => {
    const d = draftFromRoutine(stored)
    const out = buildRoutine(stored, { ...d, name: '  Pierna B ', exercises: d.exercises.map((e, i) => (i === 0 ? { ...e, targetSets: 5, warmupSets: 2 } : e)) }) as unknown as Record<string, unknown> & { exercises: (RoutineExercise & { unknownExerciseField?: string })[] }
    expect(out).toMatchObject({ id: 'a', profileId: 'p', createdAt: stamp.createdAt, order: 2, archived: false, unknownRowField: 7, name: 'Pierna B', notes: 'x' })
    expect(out.exercises[0]).toMatchObject({ unknownExerciseField: 'keep', targetSets: 5, warmupSets: 2 })
  })
  it('stores no empty notes, no zero warm-ups and does not invent fields on untouched exercises', () => {
    const d = draftFromRoutine(stored)
    const out = buildRoutine(stored, { ...d, notes: '  ' }) as unknown as Record<string, unknown> & { exercises: Record<string, unknown>[] }
    expect('notes' in out).toBe(false)
    expect('warmupSets' in out.exercises[1]!).toBe(false)
    expect('notes' in out.exercises[1]!).toBe(false)
    expect('warmupSets' in out.exercises[0]!).toBe(false)
    expect(Object.keys(out.exercises[0]!).sort()).toEqual(Object.keys(stored.exercises[0]!).sort())
  })
  it('builds a new routine without inventing identity', () => {
    const out = buildRoutine(undefined, { name: 'Nueva', notes: '', exercises: [] }) as unknown as Record<string, unknown>
    expect(out).toEqual({ name: 'Nueva', exercises: [] })
  })
})

describe('exercise list operations', () => {
  const items = [ex('a'), ex('b'), ex('c')]
  it('moves without mutating and ignores the ends', () => {
    expect(moveItem(items, 0, 1).map((e) => e.key)).toEqual(['b', 'a', 'c'])
    expect(moveItem(items, 2, 1).map((e) => e.key)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, 0, -1).map((e) => e.key)).toEqual(['a', 'b', 'c'])
    expect(items.map((e) => e.key)).toEqual(['a', 'b', 'c'])
  })
  it('duplicates right after with a new key and removes/reinserts at the same index (undo)', () => {
    const dup = duplicateItem(items, 1, 'z')
    expect(dup.map((e) => e.key)).toEqual(['a', 'b', 'z', 'c'])
    expect(dup[2]).toMatchObject({ exerciseId: 'e-b', targetSets: 3 })
    const { items: rest, removed } = removeItem(items, 1)
    expect(rest.map((e) => e.key)).toEqual(['a', 'c'])
    expect(insertItem(rest, 1, removed!).map((e) => e.key)).toEqual(['a', 'b', 'c'])
  })
  it('describes an exercise', () => {
    expect(describeExercise(ex('a', { targetSets: 3, targetReps: '8-10', restSec: 120 }))).toBe('3 series · 8–10 reps · descanso 2:00')
    expect(describeExercise(ex('a', { targetSets: 1, targetReps: '', restSec: 0 }))).toBe('1 serie')
    expect(describeExercise(ex('a', { targetReps: '30-60 s', trackingType: 'time', restSec: 60, warmupSets: 2 }))).toBe('3 series · 30–60 s · descanso 1:00 · 2 calentamientos')
    expect(formatRest(75)).toBe('1:15')
  })
})

describe('editor patches', () => {
  it('patchExercise drops a zero warm-up count and an empty note so the exercise returns to its stored shape', () => {
    const base = ex('a')
    const withWarm = patchExercise(base, { warmupSets: 2 })
    expect(withWarm.warmupSets).toBe(2)
    expect('warmupSets' in patchExercise(withWarm, { warmupSets: 0 })).toBe(false)
    expect(JSON.stringify(patchExercise(withWarm, { warmupSets: 0 }))).toBe(JSON.stringify(base))
    expect('notes' in patchExercise(patchExercise(base, { notes: 'x' }), { notes: '  ' })).toBe(false)
    expect(patchExercise(base, { targetSets: 5 })).toMatchObject({ targetSets: 5, restSec: 120 })
  })
  it('patchFromDraft only carries name, notes and exercises', () => {
    const d = { name: ' Torso ', notes: ' ', exercises: [ex('a', { warmupSets: 0 })] }
    const p = patchFromDraft(d)
    expect(Object.keys(p).sort()).toEqual(['exercises', 'name', 'notes'])
    expect(p.name).toBe('Torso')
    expect(p.notes).toBeUndefined()
    expect('warmupSets' in p.exercises[0]!).toBe(false)
  })
})

describe('moveRoutineTo and filterRoutines', () => {
  const list = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 1 }), rt('c', 'C', { order: 2 }), rt('d', 'D', { order: 3 })]
  it('moves a row and writes only the rows whose number changes', () => {
    expect(moveRoutineTo(list, 'd', 1)).toEqual([
      { id: 'd', order: 1 },
      { id: 'b', order: 2 },
      { id: 'c', order: 3 },
    ])
    expect(moveRoutineTo(list, 'a', 1)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ])
    expect(moveRoutineTo(list, 'b', 1)).toEqual([])
    expect(moveRoutineTo(list, 'b', 99)).toEqual([
      { id: 'c', order: 1 },
      { id: 'd', order: 2 },
      { id: 'b', order: 3 },
    ])
  })
  it('reuses the existing numbers when there are gaps', () => {
    const gaps = [rt('a', 'A', { order: 0 }), rt('b', 'B', { order: 5 }), rt('c', 'C', { order: 9 })]
    expect(moveRoutineTo(gaps, 'c', 0)).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 5 },
      { id: 'b', order: 9 },
    ])
  })
  it('numbers an automatic list on the first drag', () => {
    expect(moveRoutineTo([rt('a', 'A'), rt('b', 'B')], 'b', 0)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ])
  })
  it('filters by name, exercise and muscle group, ignoring accents and case', () => {
    const rs = [rt('a', 'Pierna A', { exercises: [ex('s', { name: 'Sentadilla' })] }), rt('b', 'Torso', { exercises: [ex('p', { name: 'Press de banca' })] })]
    const groups = (r: Routine) => (r.id === 'a' ? ['Piernas'] : ['Pecho', 'Espalda'])
    expect(filterRoutines(rs, 'sentadilla', groups).map((r) => r.id)).toEqual(['a'])
    expect(filterRoutines(rs, 'ESPALDA', groups).map((r) => r.id)).toEqual(['b'])
    expect(filterRoutines(rs, 'torso press', groups).map((r) => r.id)).toEqual(['b'])
    expect(filterRoutines(rs, '  ', groups)).toHaveLength(2)
    expect(filterRoutines(rs, 'zzz', groups)).toEqual([])
  })
})
