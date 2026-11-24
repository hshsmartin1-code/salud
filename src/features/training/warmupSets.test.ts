import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { Routine } from '../../db/types'
import { isWarmupSet, isWorkSet, setKind } from '../../domain/setKind'
import { sessionVolume } from '../../domain/training'
import { finishSession, startSession } from './session'
import { bestE1rm, prsBySet } from './sets'
import { addWarmupSteps, firstWorkWeight } from './warmupSets'

// Synthetic data only.
let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`warmup-live-${Date.now()}-${n++}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil', sex: 'male', birthDate: '1990-01-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const routine = (warmupSets?: number): Routine =>
  ({
    id: 'rt1',
    profileId: 'x',
    createdAt: '',
    updatedAt: '',
    name: 'Pierna A',
    exercises: [{ key: 'k1', exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 3, targetReps: '8', restSec: 120, ...(warmupSets ? { warmupSets } : {}) }],
  }) as Routine

const ordered = async (sessionId: string) => (await r.byIndex('exerciseSets', 'sessionId', sessionId)).sort((a, b) => a.setIndex - b.setIndex)

describe('addWarmupSteps (live "Agregar calentamiento")', () => {
  it('inserts warm-up rows before the work sets and shifts the rest, with contiguous indices', async () => {
    const s = await startSession(r, { routine: routine() })
    const work = await ordered(s.id)
    await r.update('exerciseSets', work[0]!.id, { weight: 100, reps: 5 })
    const out = await addWarmupSteps(r, s, s.exerciseOrder[0]!, [
      { weight: 20, reps: 10 },
      { weight: 60, reps: 3 },
    ])
    expect(out.count).toBe(2)
    const rows = await ordered(s.id)
    expect(rows.map((x) => x.setIndex)).toEqual([0, 1, 2, 3, 4])
    expect(rows.map((x) => setKind(x))).toEqual(['warmup', 'warmup', 'normal', 'normal', 'normal'])
    expect(rows.slice(0, 2).map((x) => [x.weight, x.reps, x.done])).toEqual([
      [20, 10, false],
      [60, 3, false],
    ])
    expect(rows[2]!.id).toBe(work[0]!.id) // the work rows keep their identity and values
    expect(rows[2]!.weight).toBe(100)
    expect(firstWorkWeight(rows)).toBe(100)
  })

  it('goes after existing warm-ups and undo removes only the added pending rows, closing the gap', async () => {
    const s = await startSession(r, { routine: routine(1) })
    const before = await ordered(s.id)
    const out = await addWarmupSteps(r, s, s.exerciseOrder[0]!, [{ weight: 40, reps: 5 }])
    const mid = await ordered(s.id)
    expect(mid.map((x) => setKind(x))).toEqual(['warmup', 'warmup', 'normal', 'normal', 'normal'])
    await out.undo()
    const after = await ordered(s.id)
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id))
    expect(after.map((x) => x.setIndex)).toEqual([0, 1, 2, 3])
  })

  it('undo keeps a warm-up that was already completed', async () => {
    const s = await startSession(r, { routine: routine() })
    const out = await addWarmupSteps(r, s, s.exerciseOrder[0]!, [
      { weight: 20, reps: 10 },
      { weight: 40, reps: 5 },
    ])
    const rows = await ordered(s.id)
    await r.update('exerciseSets', rows[0]!.id, { done: true })
    await out.undo()
    const after = await ordered(s.id)
    expect(after.map((x) => setKind(x))).toEqual(['warmup', 'normal', 'normal', 'normal'])
    expect(after.map((x) => x.setIndex)).toEqual([0, 1, 2, 3])
  })

  it('warm-ups never count in volume, records, best e1RM or work-set totals', async () => {
    const first = await startSession(r, { routine: routine() })
    for (const row of await ordered(first.id)) await r.update('exerciseSets', row.id, { weight: 100, reps: 5, done: true })
    await finishSession(r, first)

    const s = await startSession(r, { routine: routine() })
    // A "warm-up" heavier than any work set must not become a record nor add volume.
    await addWarmupSteps(r, s, s.exerciseOrder[0]!, [{ weight: 300, reps: 5 }])
    for (const row of await ordered(s.id)) await r.update('exerciseSets', row.id, { done: true, ...(isWarmupSet(row) ? {} : { weight: 100, reps: 5 }) })
    const rows = await ordered(s.id)
    expect(rows.filter(isWorkSet)).toHaveLength(3)
    expect(sessionVolume(rows)).toBe(3 * 500)
    expect(bestE1rm(rows)).toBeCloseTo(100 * (1 + 5 / 30), 6)
    const all = await r.all('exerciseSets')
    const prs = prsBySet(all)
    const warm = rows.find(isWarmupSet)!
    expect(prs.has(warm.id)).toBe(false)
  })
})
