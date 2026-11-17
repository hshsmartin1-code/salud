import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { ExerciseSet, Routine, TrainingSession } from '../../db/types'
import { DraftWriter, NOTE_DRAFT_DELAY_MS, parseSetField, SET_DRAFT_DELAY_MS, SetDraftModel, type DraftClock } from './draft'
import { finishSession, getActiveSession, lastPerformance, matchPreviousSets, previousForRows, previousSessionSets, startSession, updateExerciseNote } from './session'

// Synthetic data only.
let db: SaludDB
let r: Repo
let dbName: string
let n = 0
beforeEach(async () => {
  dbName = `persist-${Date.now()}-${n++}`
  db = createDB(dbName)
  await db.open()
  const p = await createProfile({ name: 'Perfil', sex: 'male', birthDate: '1990-01-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** Manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: DraftClock = {
    setTimeout: (fn, ms) => {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (h) => void timers.delete(h as number),
  }
  const advance = async (ms: number) => {
    now += ms
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        timers.delete(id)
        t.fn()
      }
    }
    await sleep(0)
  }
  return { clock, advance }
}

async function blankSet(sessionId = 's1', extra: Partial<ExerciseSet> = {}) {
  return r.add('exerciseSets', { sessionId, date: '2026-11-10', exerciseId: 'fedb:squat', exerciseName: 'Sentadilla', setIndex: 0, weight: null, reps: null, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: false, ...extra })
}

describe('draft writer', () => {
  it('coalesces a burst into one write within the window and keeps saving during continuous typing', async () => {
    const { clock, advance } = fakeClock()
    const writes: number[] = []
    const w = new DraftWriter<number>({ delayMs: 120, key: String, write: async (v) => void writes.push(v), clock, initialKey: '0' })
    w.set(1)
    w.set(12)
    w.set(125)
    expect(writes).toEqual([])
    await advance(119)
    expect(writes).toEqual([])
    await advance(1)
    expect(writes).toEqual([125]) // one write per window, the latest value
    // Continuous typing: the window is not pushed back by later keystrokes.
    for (let i = 0; i < 10; i++) {
      w.set(200 + i)
      await advance(30)
    }
    expect(writes.length).toBeGreaterThanOrEqual(3)
    await w.flush()
    expect(writes.at(-1)).toBe(209)
    // Writing the same value again is skipped.
    w.set(209)
    await advance(200)
    expect(writes.filter((x) => x === 209)).toHaveLength(1)
  })

  it('serialises writes and retries a value whose write failed', async () => {
    const { clock, advance } = fakeClock()
    const seen: number[] = []
    let fail = true
    const w = new DraftWriter<number>({
      delayMs: 50,
      key: String,
      clock,
      write: async (v) => {
        await sleep(5)
        if (fail) {
          fail = false
          throw new Error('x')
        }
        seen.push(v)
      },
    })
    w.set(1)
    await advance(50)
    await w.flush()
    expect(seen).toEqual([])
    w.set(1) // same value again after a failure: written this time
    await w.flush()
    w.set(2)
    await w.flush()
    expect(seen).toEqual([1, 2])
    expect(w.busy).toBe(false)
  })

  it('the windows meet the owner requirement (numbers ≤ 150 ms, notes ≤ 300 ms)', () => {
    expect(SET_DRAFT_DELAY_MS).toBeLessThanOrEqual(150)
    expect(NOTE_DRAFT_DELAY_MS).toBeLessThanOrEqual(300)
  })
})

describe('set draft persistence (real Dexie, real timers)', () => {
  it('a typed weight is in the database without any flush event (simulated crash) and survives a reopen', async () => {
    const set = await blankSet()
    const m = new SetDraftModel({ fields: ['weight', 'reps'], tracking: 'weight_reps', initial: set, write: (v) => r.update('exerciseSets', set.id, v) })
    m.change('weight', '6')
    m.change('weight', '62')
    m.change('weight', '62,5')
    m.change('reps', '8')
    // No blur, no pagehide, no flush: the process "dies" after 200 ms.
    await sleep(SET_DRAFT_DELAY_MS + 80)
    db.close()
    const reopened = createDB(dbName)
    await reopened.open()
    const row = await reopened.exerciseSets.get(set.id)
    expect(row).toMatchObject({ weight: 62.5, reps: 8 })
    reopened.close()
    await db.open()
  })

  it('invalid intermediate text is never written and never erases the last valid value', async () => {
    const set = await blankSet('s1', { weight: 60, reps: 8 })
    const { clock, advance } = fakeClock()
    const m = new SetDraftModel({ fields: ['weight', 'reps'], tracking: 'weight_reps', initial: set, clock, write: (v) => r.update('exerciseSets', set.id, v) })
    expect(m.change('weight', '7')).toBe(true)
    expect(m.change('weight', '7x')).toBe(false)
    expect(m.change('reps', '8,5')).toBe(false) // reps must be whole
    await advance(SET_DRAFT_DELAY_MS)
    await m.flush()
    expect(await r.get('exerciseSets', set.id)).toMatchObject({ weight: 7, reps: 8 })
    expect(m.invalid()).toEqual({ weight: true, reps: true })
    expect(m.canComplete()).toBe(false)
    // Only invalid text since the last write: nothing at all is written.
    const before = (await r.get('exerciseSets', set.id))!.updatedAt
    m.change('weight', 'abc')
    await advance(500)
    await m.flush()
    expect((await r.get('exerciseSets', set.id))!.updatedAt).toBe(before)
    expect(await r.get('exerciseSets', set.id)).toMatchObject({ weight: 7, reps: 8 })
    // Clearing a field is a valid change (null).
    m.change('weight', '')
    await m.flush()
    expect((await r.get('exerciseSets', set.id))!.weight).toBeNull()
  })

  it('echoes of its own writes never clobber what is being typed; external changes are adopted when idle', async () => {
    const set = await blankSet()
    const { clock, advance } = fakeClock()
    const m = new SetDraftModel({ fields: ['weight', 'reps'], tracking: 'weight_reps', initial: set, clock, write: (v) => r.update('exerciseSets', set.id, v) })
    m.change('weight', '6')
    await advance(SET_DRAFT_DELAY_MS)
    await m.flush()
    m.change('weight', '65') // still typing, not yet written
    // The live query now delivers the row with weight 6 (echo of the first write).
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(false)
    expect(m.text.weight).toBe('65')
    await m.flush()
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(false)
    // Another device changes the value while this row is idle: adopted.
    await r.update('exerciseSets', set.id, { weight: 70 })
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(true)
    expect(m.text.weight).toBe('70')
    // An external change back to a value this row wrote earlier is still recognised as external.
    await r.update('exerciseSets', set.id, { weight: 6 })
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(true)
    expect(m.text.weight).toBe('6')
    // While local typing is pending, an external change does not overwrite the inputs.
    m.change('weight', '80')
    await r.update('exerciseSets', set.id, { weight: 90 })
    expect(m.stored((await r.get('exerciseSets', set.id))!)).toBe(false)
    await m.flush()
    expect((await r.get('exerciseSets', set.id))!.weight).toBe(80)
  })

  it('RPE, RIR and notes are drafted too; notes and per-exercise notes are written within 300 ms', async () => {
    const set = await blankSet()
    const m = new SetDraftModel({ fields: ['rpe', 'rir'], tracking: 'weight_reps', initial: set, write: (v) => r.update('exerciseSets', set.id, v) })
    m.change('rpe', '8,5')
    m.change('rir', '2')
    expect(parseSetField('rpe', '11', 'weight_reps').ok).toBe(false)
    const notes = new DraftWriter<string | undefined>({ delayMs: NOTE_DRAFT_DELAY_MS, key: (v) => JSON.stringify(v ?? null), write: (v) => r.update('exerciseSets', set.id, { notes: v }) })
    notes.set('Rodilla')
    notes.set('Rodilla bien')
    const session = await startSession(r, { routine: routineOf([['fedb:squat', 'Sentadilla']]) })
    const exNote = new DraftWriter<string | undefined>({ delayMs: NOTE_DRAFT_DELAY_MS, key: (v) => JSON.stringify(v ?? null), write: (v) => updateExerciseNote(r, session.id, 'fedb:squat', v) })
    exNote.set('Bajar lento')
    await sleep(NOTE_DRAFT_DELAY_MS + 80)
    expect(await r.get('exerciseSets', set.id)).toMatchObject({ rpe: 8.5, rir: 2, notes: 'Rodilla bien' })
    expect((await r.get('trainingSessions', session.id))!.exerciseOrder[0]!.notes).toBe('Bajar lento')
    // Emptying a note removes the field.
    notes.set(undefined)
    await notes.flush()
    expect('notes' in (await r.get('exerciseSets', set.id))!).toBe(false)
  })
})

function routineOf(ex: [string, string, Partial<Routine['exercises'][number]>?][]): Routine {
  return {
    id: 'routine-1',
    profileId: r.profileId,
    name: 'Rutina',
    createdAt: '',
    updatedAt: '',
    exercises: ex.map(([exerciseId, name, extra], i) => ({ key: `k${i}`, exerciseId, name, trackingType: 'weight_reps' as const, targetSets: 2, targetReps: '8-10', restSec: 90, ...extra })),
  }
}

describe('one active session per profile', () => {
  it('startSession returns the existing active session instead of creating a second one', async () => {
    const first = await startSession(r, { routine: routineOf([['fedb:squat', 'Sentadilla']]) })
    const again = await startSession(r, {})
    expect(again.id).toBe(first.id)
    const [x, y] = await Promise.all([startSession(r, {}), startSession(r, { name: 'Otra' })])
    expect(x.id).toBe(first.id)
    expect(y.id).toBe(first.id)
    expect((await r.all('trainingSessions')).filter((s) => s.status === 'active')).toHaveLength(1)
    expect((await getActiveSession(r))?.id).toBe(first.id)
    expect(await r.count('exerciseSets')).toBe(2) // the routine's sets were not added twice
    await finishSession(r, first)
    expect(await getActiveSession(r)).toBeNull()
    const next = await startSession(r, {})
    expect(next.id).not.toBe(first.id)
  })

  it('a concurrent double start (two taps) creates only one session', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => startSession(r, { routine: routineOf([['fedb:bench', 'Press']]) })))
    expect(new Set(results.map((s) => s.id)).size).toBe(1)
    expect(await r.count('trainingSessions')).toBe(1)
  })

  it('with two active sessions (synced from two devices) the most recently started one is returned', async () => {
    const base = { date: '2026-11-10', name: 'X', routineId: null, status: 'active' as const, endedAt: null, restEndsAt: null, exerciseOrder: [] }
    await r.add('trainingSessions', { ...base, startedAt: '2026-11-10T10:00:00.000Z' })
    const newer = await r.add('trainingSessions', { ...base, startedAt: '2026-11-10T11:00:00.000Z' })
    expect((await getActiveSession(r))?.id).toBe(newer.id)
    expect((await startSession(r, {})).id).toBe(newer.id)
  })

  it('finishSession does not write restEndsAt unless an older client left one', async () => {
    const s = await startSession(r, {})
    await finishSession(r, s)
    const done = (await r.get('trainingSessions', s.id))!
    expect(done.restEndsAt).toBeNull()
    expect(done.status).toBe('done')
    const legacy = await startSession(r, {})
    await r.update('trainingSessions', legacy.id, { restEndsAt: Date.now() + 60_000 })
    await finishSession(r, legacy)
    expect((await r.get('trainingSessions', legacy.id))!.restEndsAt).toBeNull()
  })
})

describe('routine targets and notes are copied into the session', () => {
  it('copies targetSets/targetReps/notes and carries the last finished session note when the routine has none', async () => {
    // A finished session where the squat had a note (and a later one without the exercise).
    await r.add('trainingSessions', {
      date: '2026-11-01', name: 'Antes', routineId: null, status: 'done', startedAt: '2026-11-01T10:00:00.000Z', endedAt: '2026-11-01T11:00:00.000Z', restEndsAt: null,
      exerciseOrder: [{ exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 120, notes: 'Cinturón desde 100 kg' }],
    })
    await r.add('trainingSessions', {
      date: '2026-11-03', name: 'Otra', routineId: null, status: 'done', startedAt: '2026-11-03T10:00:00.000Z', endedAt: null, restEndsAt: null,
      exerciseOrder: [{ exerciseId: 'fedb:bench', name: 'Press', trackingType: 'weight_reps', restSec: 120, notes: 'Agarre medio' }],
    })
    const routine = routineOf([
      ['fedb:squat', 'Sentadilla'],
      ['fedb:bench', 'Press', { notes: 'Pausa en el pecho', targetSets: 3, targetReps: '5' }],
      ['fedb:row', 'Remo'],
    ])
    const s = await startSession(r, { routine })
    expect(s.exerciseOrder).toEqual([
      { exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 90, targetSets: 2, targetReps: '8-10', notes: 'Cinturón desde 100 kg' },
      { exerciseId: 'fedb:bench', name: 'Press', trackingType: 'weight_reps', restSec: 90, targetSets: 3, targetReps: '5', notes: 'Pausa en el pecho' },
      { exerciseId: 'fedb:row', name: 'Remo', trackingType: 'weight_reps', restSec: 90, targetSets: 2, targetReps: '8-10' },
    ])
    expect('notes' in s.exerciseOrder[2]!).toBe(false)
    await updateExerciseNote(r, s.id, 'fedb:row', 'Nuevo')
    await updateExerciseNote(r, s.id, 'fedb:squat', '')
    const after = (await r.get('trainingSessions', s.id))!
    expect(after.exerciseOrder.map((o) => o.notes)).toEqual([undefined, 'Pausa en el pecho', 'Nuevo'])
  })
})

describe('previous performance is genuinely comparable', () => {
  async function session(date: string, startedAt: string, status: 'done' | 'active', extra: Partial<TrainingSession> = {}) {
    return r.add('trainingSessions', { date, name: date, routineId: null, status, startedAt, endedAt: null, restEndsAt: null, exerciseOrder: [], ...extra })
  }
  async function sets(sessionId: string, date: string, exerciseId: string, rows: [number, number, ('warmup' | 'drop' | 'failure')?, Partial<ExerciseSet>?][]) {
    let i = 0
    for (const [weight, reps, kind, extra] of rows)
      await r.add('exerciseSets', { sessionId, date, exerciseId, exerciseName: exerciseId, setIndex: i++, weight, reps, durationSec: null, distanceM: null, rpe: null, isWarmup: kind === 'warmup', ...(kind ? { kind } : {}), done: true, ...extra })
  }

  it('uses the most recent FINISHED earlier session, alias-resolved, skipping excluded rows and other active sessions', async () => {
    const old = await session('2026-11-01', '2026-11-01T10:00:00.000Z', 'done')
    await sets(old.id, '2026-11-01', 'fedb:old_squat', [[40, 10, 'warmup'], [100, 5], [105, 4]]) // stored under the old (aliased) id
    const excluded = await session('2026-11-03', '2026-11-03T10:00:00.000Z', 'done', { excludeFromStats: true })
    await sets(excluded.id, '2026-11-03', 'fedb:squat', [[999, 1]])
    const excludedSets = await session('2026-11-04', '2026-11-04T10:00:00.000Z', 'done')
    await sets(excludedSets.id, '2026-11-04', 'fedb:squat', [[888, 1, undefined, { excludeFromStats: true }]])
    const otherActive = await session('2026-11-05', '2026-11-05T10:00:00.000Z', 'active')
    await sets(otherActive.id, '2026-11-05', 'fedb:squat', [[777, 1]])
    const current = await session('2026-11-06', '2026-11-06T10:00:00.000Z', 'active')
    const aliases = { 'fedb:old_squat': 'fedb:squat' }
    const prev = await previousSessionSets(r, current, 'fedb:squat', aliases)
    expect(prev.map((s) => s.weight)).toEqual([40, 100, 105])
    expect(await previousSessionSets(r, current, 'fedb:squat')).toEqual([]) // without the alias map, the old id is a different exercise
    // A later finished session on the same day, started earlier than the current one, wins.
    const sameDay = await session('2026-11-06', '2026-11-06T08:00:00.000Z', 'done')
    await sets(sameDay.id, '2026-11-06', 'fedb:squat', [[110, 3]])
    expect((await previousSessionSets(r, current, 'fedb:squat', aliases)).map((s) => s.weight)).toEqual([110])
    // A finished session that started AFTER the current one is not "previous".
    const later = await session('2026-11-06', '2026-11-06T12:00:00.000Z', 'done')
    await sets(later.id, '2026-11-06', 'fedb:squat', [[120, 3]])
    expect((await previousSessionSets(r, current, 'fedb:squat', aliases)).map((s) => s.weight)).toEqual([110])
    expect((await lastPerformance(r, 'fedb:squat', current.date, current.id, aliases)).map((s) => s.weight)).toEqual([110])
  })

  it('matches per set by ordinal among work sets, warm-ups among warm-ups (drop/failure are work sets)', async () => {
    const old = await session('2026-11-01', '2026-11-01T10:00:00.000Z', 'done')
    await sets(old.id, '2026-11-01', 'fedb:squat', [[40, 10, 'warmup'], [60, 5, 'warmup'], [100, 5], [100, 5], [80, 8, 'drop']])
    const current = await session('2026-11-02', '2026-11-02T10:00:00.000Z', 'active')
    await sets(current.id, '2026-11-02', 'fedb:squat', [[45, 10, 'warmup'], [100, 6], [102, 5, 'failure'], [85, 8], [50, 12, 'warmup'], [90, 3]])
    const rows = (await r.byIndex('exerciseSets', 'sessionId', current.id)).sort((a, b) => a.setIndex - b.setIndex)
    const m = await previousForRows(r, current, 'fedb:squat', rows)
    expect(rows.map((s) => m.get(s.id)?.weight ?? null)).toEqual([40, 100, 100, 80, 60, null])
    // Pure matcher, independent of storage order.
    const shuffled = matchPreviousSets([...rows].reverse(), (await previousSessionSets(r, current, 'fedb:squat')).reverse())
    expect(rows.map((s) => shuffled.get(s.id)?.weight ?? null)).toEqual([40, 100, 100, 80, 60, null])
  })
})
