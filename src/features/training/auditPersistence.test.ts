import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { DraftWriter, SetDraftModel, type DraftClock } from './draft'
import { finishSession, startSession } from './session'

// Synthetic data only. Expected failures describe unresolved audit findings.
let db: SaludDB
let r: Repo
const clock: DraftClock = { setTimeout: () => 1, clearTimeout: () => undefined }
beforeEach(async () => {
  db = createDB(`audit-drafts-${crypto.randomUUID()}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => { await db.delete() })

async function seed(done = true) {
  const session = await startSession(r, {})
  const set = await r.add('exerciseSets', { sessionId: session.id, date: session.date, exerciseId: 'synthetic:lift', exerciseName: 'Ejercicio sintetico', setIndex: 0, weight: 60, reps: 8, rpe: null, durationSec: null, distanceM: null, isWarmup: false, done })
  const model = () => new SetDraftModel({ initial: set, fields: ['weight', 'reps'], tracking: 'weight_reps', clock, write: (v) => r.update('exerciseSets', set.id, v) })
  return { session, set, model }
}

describe('draft audit', () => {
  it('two tabs editing different columns preserve both changes', async () => {
    const { set, model } = await seed()
    const a = model(), b = model()
    a.change('weight', '65')
    b.change('reps', '10')
    await a.flush()
    b.stored((await r.get('exerciseSets', set.id))!) // echo arrives while B has a draft
    await b.flush()
    expect(await r.get('exerciseSets', set.id)).toMatchObject({ weight: 65, reps: 10 })
  })

  it('adopts an idle external change back to an older value this draft once wrote', async () => {
    const { set, model } = await seed()
    const m = model()
    m.change('weight', '61')
    await m.flush()
    m.change('weight', '65')
    await m.flush()
    m.stored((await r.get('exerciseSets', set.id))!)
    await r.update('exerciseSets', set.id, { weight: 61 })
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(true)
    expect(m.text.weight).toBe('61')
  })

  it('a failed write can be retried by flush without typing the value again', async () => {
    let attempts = 0
    const w = new DraftWriter<number>({ clock, delayMs: 120, key: String, write: async () => { if (++attempts === 1) throw new Error('synthetic failure') } })
    w.set(65)
    await w.flush()
    await w.flush()
    expect(attempts).toBe(2)
  })

  it('a newer value replaces a failed one; failed is reported until a write succeeds', async () => {
    const written: number[] = []
    let fail = true
    const w = new DraftWriter<number>({ clock, delayMs: 120, key: String, write: async (v) => { if (fail) throw new Error('synthetic failure'); written.push(v) } })
    let changes = 0
    w.onFailedChange(() => changes++)
    w.set(65)
    await w.flush()
    expect(w.failed).toBe(true)
    expect(w.busy).toBe(true) // the value is kept, not dropped
    w.set(70)
    fail = false
    await w.flush()
    expect(written).toEqual([70])
    expect(w.failed).toBe(false)
    expect(w.busy).toBe(false)
    expect(changes).toBe(2)
  })

  it('finishing does not delete a row another tab completed after the pending-row read', async () => {
    const { set, session } = await seed(false)
    const wrapped: Repo = { ...r, byIndex: async (...args) => {
      const rows = await r.byIndex(...args)
      await r.update('exerciseSets', set.id, { done: true })
      return rows
    } }
    await finishSession(wrapped, session)
    expect(await r.get('exerciseSets', set.id)).toMatchObject({ done: true })
  })

  it('a delayed draft after deletion never recreates the set', async () => {
    const { set, model } = await seed()
    const m = model()
    m.change('weight', '65')
    await r.remove('exerciseSets', set.id)
    await m.flush()
    expect(await r.get('exerciseSets', set.id)).toBeUndefined()
  })
})
