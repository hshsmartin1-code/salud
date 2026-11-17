import { afterEach, beforeEach, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { SetDraftModel, type DraftClock } from './draft'
import { markSetDone, startSession } from './session'
import { finishSessionWhenSettled, markSetTouched, registerDraft, trackSessionWork } from './sessionWork'

// Synthetic data only.
let db: SaludDB
let r: Repo
const clock: DraftClock = { setTimeout: () => 1, clearTimeout: () => undefined }
beforeEach(async () => {
  db = createDB(`session-work-${crypto.randomUUID()}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

async function seed() {
  const session = await startSession(r, {})
  const set = await r.add('exerciseSets', { sessionId: session.id, date: session.date, exerciseId: 'synthetic:lift', exerciseName: 'Ejercicio sintetico', setIndex: 0, weight: null, reps: null, rpe: null, durationSec: null, distanceM: null, isWarmup: false, done: false })
  return { session, set }
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

it('"Terminar" a moment after tapping done keeps the set (its completion is awaited first)', async () => {
  const { session, set } = await seed()
  // The done button first flushes the row's draft, then marks it done: that takes a moment.
  void trackSessionWork(
    (async () => {
      await delay(30)
      await markSetDone(r, set.id, { weight: 60, reps: 8 }, true)
    })(),
  )
  const { removed } = await finishSessionWhenSettled(r, session)
  expect(removed).toBe(0)
  expect(await r.get('exerciseSets', set.id)).toMatchObject({ done: true, weight: 60, reps: 8 })
  expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'done' })
})

it('"Terminar" writes values still waiting in a mounted draft before closing', async () => {
  const { session, set } = await seed()
  await r.update('exerciseSets', set.id, { done: true, weight: 60, reps: 8 })
  const model = new SetDraftModel({ initial: { weight: 60, reps: 8 }, fields: ['weight', 'reps'], tracking: 'weight_reps', clock, write: (v) => r.update('exerciseSets', set.id, v) })
  const off = registerDraft(model)
  model.change('reps', '9') // typed, window not elapsed yet
  await finishSessionWhenSettled(r, session)
  off()
  expect(await r.get('exerciseSets', set.id)).toMatchObject({ done: true, reps: 9 })
})

it('refuses to finish after a mounted draft write fails, keeping the session and row', async () => {
  const { session, set } = await seed()
  const model = new SetDraftModel({ initial: set, fields: ['weight', 'reps'], tracking: 'weight_reps', clock, write: async () => { throw new Error('disk failure') } })
  const off = registerDraft(model)
  model.change('weight', '60')
  await expect(finishSessionWhenSettled(r, session)).rejects.toThrow('No se pudo guardar')
  off()
  expect(await r.get('trainingSessions', session.id)).toMatchObject({ status: 'active' })
  expect(await r.get('exerciseSets', set.id)).toMatchObject({ done: false, weight: null })
})

it('keeps a touched row whose just-typed values were flushed only when finishing', async () => {
  const { session, set } = await seed()
  await r.update('trainingSessions', session.id, { exerciseOrder: [{ exerciseId: set.exerciseId, name: set.exerciseName, trackingType: 'weight_reps', restSec: 90 }] })
  const model = new SetDraftModel({ initial: set, fields: ['weight', 'reps'], tracking: 'weight_reps', clock, write: (v) => r.update('exerciseSets', set.id, v) })
  const off = registerDraft(model)
  model.change('weight', '60')
  model.change('reps', '8')
  markSetTouched(session.id, set.id)
  const out = await finishSessionWhenSettled(r, session, { completeTouched: true })
  off()
  expect(out.completed).toBe(1)
  expect(await r.get('exerciseSets', set.id)).toMatchObject({ done: true, weight: 60, reps: 8 })
})
