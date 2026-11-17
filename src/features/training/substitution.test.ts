import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { startSession } from './session'
import { substituteExercise } from './substitution'

// Synthetic data only.
let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`subst-${Date.now()}-${n++}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil', sex: 'male', birthDate: '1990-01-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const routine = {
  id: 'r1',
  name: 'Día A',
  exercises: [
    { exerciseId: 'fedb:a', name: 'Ejercicio A', trackingType: 'weight_reps' as const, restSec: 90, targetSets: 3 },
    { exerciseId: 'fedb:b', name: 'Ejercicio B', trackingType: 'weight_reps' as const, restSec: 60, targetSets: 2 },
  ],
}
const next = { id: 'fedb:c', nameEs: 'Ejercicio C', trackingType: 'weight_reps' as const }

describe('substituteExercise', () => {
  it('replaces in place when nothing was done, moving pending sets to the substitute', async () => {
    const s = await startSession(r, { routine: routine as never })
    const sets = await r.byIndex('exerciseSets', 'sessionId', s.id)
    const ok = await substituteExercise(r, s, sets, s.exerciseOrder[0]!, next)
    expect(ok).toBe(true)
    const after = (await r.get('trainingSessions', s.id))!
    expect(after.exerciseOrder.map((o) => o.exerciseId)).toEqual(['fedb:c', 'fedb:b'])
    expect(after.exerciseOrder[0]!.restSec).toBe(90)
    const rows = await r.byIndex('exerciseSets', 'sessionId', s.id)
    expect(rows.filter((x) => x.exerciseId === 'fedb:a')).toHaveLength(0)
    expect(rows.filter((x) => x.exerciseId === 'fedb:c')).toHaveLength(3)
  })

  it('keeps done sets with the original and inserts the substitute after it', async () => {
    const s = await startSession(r, { routine: routine as never })
    let sets = await r.byIndex('exerciseSets', 'sessionId', s.id)
    const first = sets.filter((x) => x.exerciseId === 'fedb:a').sort((a, b) => a.setIndex - b.setIndex)[0]!
    await r.update('exerciseSets', first.id, { done: true, weight: 40, reps: 10 })
    sets = await r.byIndex('exerciseSets', 'sessionId', s.id)
    await substituteExercise(r, s, sets, s.exerciseOrder[0]!, next)
    const after = (await r.get('trainingSessions', s.id))!
    expect(after.exerciseOrder.map((o) => o.exerciseId)).toEqual(['fedb:a', 'fedb:c', 'fedb:b'])
    const rows = await r.byIndex('exerciseSets', 'sessionId', s.id)
    const a = rows.filter((x) => x.exerciseId === 'fedb:a')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ done: true, weight: 40, exerciseName: 'Ejercicio A' })
    expect(rows.filter((x) => x.exerciseId === 'fedb:c')).toHaveLength(2)
  })

  it('refuses a substitute already in the session', async () => {
    const s = await startSession(r, { routine: routine as never })
    const sets = await r.byIndex('exerciseSets', 'sessionId', s.id)
    expect(await substituteExercise(r, s, sets, s.exerciseOrder[0]!, { id: 'fedb:b', nameEs: 'Ejercicio B', trackingType: 'weight_reps' })).toBe(false)
  })
})
