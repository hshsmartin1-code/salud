import { afterEach, describe, expect, it } from 'vitest'
import { createDB, type SaludDB } from '../db/schema'
import { repo } from '../db/repo'
import { createProfile } from '../db/profiles'
import { encodeRow } from '../sync/codec'
import { V221_PROFILE_ID, V221_SET } from '../test/fixtures/v221Rows'
import { isWarmupSet, isWorkSet, nextSetKind, setKind, setKindPatch, withSetKind } from './setKind'
import { bestSet, detectPRs, sessionVolume, setVolume } from './training'

const dbs: SaludDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const base = { date: '2026-11-10', sessionId: 's1', weight: 100, reps: 5 }

describe('setKind reader', () => {
  it('isWarmup is the compatibility source; kind adds drop and failure', () => {
    expect(setKind({ isWarmup: false })).toBe('normal')
    expect(setKind({ isWarmup: true })).toBe('warmup')
    expect(setKind({ isWarmup: true, kind: 'warmup' })).toBe('warmup')
    expect(setKind({ isWarmup: false, kind: 'drop' })).toBe('drop')
    expect(setKind({ isWarmup: false, kind: 'failure' })).toBe('failure')
    // A 2.2.1 client un-marked the warm-up (it only knows isWarmup): it is a normal set again.
    expect(setKind({ isWarmup: false, kind: 'warmup' })).toBe('normal')
    // A 2.2.1 client marked a drop set as warm-up: warm-up wins.
    expect(setKind({ isWarmup: true, kind: 'drop' })).toBe('warmup')
    expect(setKind({ isWarmup: false, kind: 'bogus' })).toBe('normal')
    expect(isWarmupSet({ isWarmup: true })).toBe(true)
    expect(isWorkSet({ isWarmup: false, kind: 'failure' })).toBe(true)
    expect(nextSetKind('normal')).toBe('warmup')
    expect(nextSetKind('failure')).toBe('normal')
  })
})

describe('setKind writers keep kind and isWarmup consistent', () => {
  it('patch through repo.update removes kind for a normal set', async () => {
    const db = createDB(`setkind-${Date.now()}`)
    await db.open()
    dbs.push(db)
    const pid = (await createProfile({ name: 'P', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'violet', settings: { addActivityKcal: false } }, db)).id
    const r = repo(pid, db)
    const s = await r.add('exerciseSets', { sessionId: 's', date: '2026-11-10', exerciseId: 'e', exerciseName: 'E', setIndex: 0, weight: 10, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: false })
    for (const k of ['warmup', 'drop', 'failure', 'normal'] as const) {
      await r.update('exerciseSets', s.id, setKindPatch(k))
      const row = (await r.get('exerciseSets', s.id))!
      expect(setKind(row)).toBe(k)
      expect(row.isWarmup).toBe(k === 'warmup')
      expect(row.kind === 'warmup').toBe(row.isWarmup)
      if (k === 'normal') expect('kind' in row).toBe(false)
    }
  })

  it('a set made normal again encodes byte-identically to the 2.2.1 row', () => {
    const marked = withSetKind({ ...V221_SET }, 'drop')
    expect(marked).toMatchObject({ kind: 'drop', isWarmup: false })
    const normal = withSetKind(marked, 'normal')
    expect('kind' in normal).toBe(false)
    expect(encodeRow('exerciseSets', normal as never, V221_PROFILE_ID).h).toBe(encodeRow('exerciseSets', V221_SET as never, V221_PROFILE_ID).h)
    expect(withSetKind({ ...V221_SET }, 'warmup')).toMatchObject({ kind: 'warmup', isWarmup: true })
  })
})

describe('volume and PRs by kind', () => {
  it('warm-ups are excluded; drop and failure sets count as work sets', () => {
    expect(setVolume({ ...base, isWarmup: true })).toBe(0)
    expect(setVolume({ ...base, isWarmup: false, kind: 'drop' })).toBe(500)
    expect(setVolume({ ...base, isWarmup: false, kind: 'failure' })).toBe(500)
    expect(setVolume({ ...base, isWarmup: false, kind: 'warmup' })).toBe(500) // stale kind, normal set
    expect(sessionVolume([{ ...base, isWarmup: true }, { ...base, kind: 'drop' }, base])).toBe(1000)
    const history = [{ ...base, weight: 90 }]
    expect(detectPRs(history, { ...base, isWarmup: true, weight: 200 })).toEqual([])
    expect(detectPRs(history, { ...base, kind: 'failure', weight: 120 })).toContain('max_weight')
    expect(detectPRs([{ ...base, isWarmup: true, weight: 300 }, ...history], { ...base, kind: 'drop', weight: 120 })).toContain('max_weight')
    expect(bestSet([{ ...base, isWarmup: true, weight: 300 }, { ...base, kind: 'drop', weight: 60 }])?.weight).toBe(60)
  })
})
