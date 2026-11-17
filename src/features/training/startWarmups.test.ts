import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { Routine } from '../../db/types'
import { isWarmupSet, isWorkSet, setKind } from '../../domain/setKind'
import { sessionVolume } from '../../domain/training'
import { finishSession, mergePlanned, startSession } from './session'

// Synthetic data only.
let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`warmups-${Date.now()}-${n++}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil', sex: 'male', birthDate: '1990-01-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const routine = (extra: Partial<Routine['exercises'][number]> = {}, more: Routine['exercises'] = []): Routine =>
  ({
    id: 'rt1',
    profileId: 'x',
    createdAt: '',
    updatedAt: '',
    name: 'Pierna A',
    exercises: [{ key: 'k1', exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 3, targetReps: '8', restSec: 120, ...extra }, ...more],
  }) as Routine

describe('warm-up sets from a routine', () => {
  it('creates the warm-up rows first, as warm-ups, and then the work sets', async () => {
    const s = await startSession(r, { routine: routine({ warmupSets: 2 }) })
    const rows = (await r.byIndex('exerciseSets', 'sessionId', s.id)).sort((a, b) => a.setIndex - b.setIndex)
    expect(rows.map((x) => setKind(x))).toEqual(['warmup', 'warmup', 'normal', 'normal', 'normal'])
    expect(rows.map((x) => x.setIndex)).toEqual([0, 1, 2, 3, 4])
    expect(rows.slice(0, 2).every((x) => x.isWarmup === true && x.kind === 'warmup' && !x.done)).toBe(true)
    // work rows are byte-identical to 2.2.1 rows: no `kind`
    expect(rows.slice(2).every((x) => x.isWarmup === false && !('kind' in x))).toBe(true)
  })

  it('creates none without warmupSets (or with 0) and leaves the session unchanged', async () => {
    const s = await startSession(r, { routine: routine() })
    const rows = await r.byIndex('exerciseSets', 'sessionId', s.id)
    expect(rows).toHaveLength(3)
    expect(rows.some((x) => isWarmupSet(x))).toBe(false)
    await finishSession(r, s)
    const s2 = await startSession(r, { routine: routine({ warmupSets: 0 }) })
    expect(await r.byIndex('exerciseSets', 'sessionId', s2.id)).toHaveLength(3)
  })

  it('never counts warm-ups as work: not in work-set totals, volume or previous-work matching', async () => {
    const s = await startSession(r, { routine: routine({ warmupSets: 2 }) })
    const rows = (await r.byIndex('exerciseSets', 'sessionId', s.id)).sort((a, b) => a.setIndex - b.setIndex)
    for (const row of rows) await r.update('exerciseSets', row.id, { weight: 50, reps: 10, done: true })
    const done = await r.byIndex('exerciseSets', 'sessionId', s.id)
    expect(done.filter(isWorkSet)).toHaveLength(3)
    expect(sessionVolume(done)).toBe(3 * 500)
  })

  it('prefills warm-ups from the previous session and does not use them to prefill work sets', async () => {
    const first = await startSession(r, { routine: routine({ warmupSets: 1 }) })
    const rows = (await r.byIndex('exerciseSets', 'sessionId', first.id)).sort((a, b) => a.setIndex - b.setIndex)
    await r.update('exerciseSets', rows[0]!.id, { weight: 40, reps: 8, done: true })
    for (const w of rows.slice(1)) await r.update('exerciseSets', w.id, { weight: 100, reps: 5, done: true })
    await finishSession(r, first)
    const second = await startSession(r, { routine: routine({ warmupSets: 1 }) })
    const again = (await r.byIndex('exerciseSets', 'sessionId', second.id)).sort((a, b) => a.setIndex - b.setIndex)
    expect(again.map((x) => [setKind(x), x.weight, x.reps])).toEqual([
      ['warmup', 40, 8],
      ['normal', 100, 5],
      ['normal', 100, 5],
      ['normal', 100, 5],
    ])
  })

  it('folds a repeated exercise into one block with the summed sets', async () => {
    const twice = routine({ warmupSets: 1 }, [{ key: 'k2', exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 2, targetReps: '5', restSec: 90, warmupSets: 1 }])
    expect(mergePlanned(twice.exercises)).toHaveLength(1)
    const s = await startSession(r, { routine: twice })
    expect(s.exerciseOrder).toHaveLength(1)
    const rows = await r.byIndex('exerciseSets', 'sessionId', s.id)
    expect(rows.filter(isWarmupSet)).toHaveLength(2)
    expect(rows.filter(isWorkSet)).toHaveLength(5)
  })
})

describe('work sets are never prefilled from warm-ups', () => {
  it('without history the work rows are blank even though warm-ups come first', async () => {
    const s = await startSession(r, { routine: routine({ warmupSets: 2 }) })
    const rows = await r.byIndex('exerciseSets', 'sessionId', s.id)
    const work = rows.filter(isWorkSet)
    expect(work).toHaveLength(3)
    expect(work.every((x) => x.weight === null && x.reps === null)).toBe(true)
  })

  it('with history only previous WORK sets prefill work rows (warm-up values never leak)', async () => {
    const first = await startSession(r, { routine: routine({ warmupSets: 2 }) })
    const rows = (await r.byIndex('exerciseSets', 'sessionId', first.id)).sort((a, b) => a.setIndex - b.setIndex)
    for (const w of rows.filter(isWarmupSet)) await r.update('exerciseSets', w.id, { weight: 20, reps: 12, done: true })
    const w1 = rows.filter(isWorkSet)
    await r.update('exerciseSets', w1[0]!.id, { weight: 100, reps: 5, done: true })
    await finishSession(r, first)
    const second = await startSession(r, { routine: routine({ warmupSets: 2 }) })
    const again = (await r.byIndex('exerciseSets', 'sessionId', second.id)).filter(isWorkSet)
    expect(again).toHaveLength(3)
    expect(again.every((x) => x.weight === 100 && x.reps === 5)).toBe(true)
  })
})

describe('fallback prefill ignores warm-up rows', () => {
  it('when the previous session only has done warm-ups, work rows stay blank', async () => {
    const first = await startSession(r, { routine: routine({ warmupSets: 1 }) })
    const rows = await r.byIndex('exerciseSets', 'sessionId', first.id)
    for (const w of rows.filter(isWarmupSet)) await r.update('exerciseSets', w.id, { weight: 20, reps: 12, done: true })
    await finishSession(r, first)
    const second = await startSession(r, { routine: routine({ warmupSets: 1 }) })
    const work = (await r.byIndex('exerciseSets', 'sessionId', second.id)).filter(isWorkSet)
    expect(work.every((x) => x.weight === null && x.reps === null)).toBe(true)
  })
})
