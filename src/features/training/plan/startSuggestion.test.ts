import { describe, expect, it } from 'vitest'
import type { Routine, TrainingPlan } from '../../../db/types'
import { offeredRoutine, startSuggestion } from './startSuggestion'

// 2026-11-18 is a Wednesday, 2026-11-19 a Thursday.
const r = (id: string, name: string, extra: Partial<Routine> = {}) => ({ id, name, archived: false, ...extra }) as Routine
const upper = r('upper', 'Upper A')
const lower = r('lower', 'Lower A')
const old = r('old', 'Vieja', { archived: true })
const routines = [upper, lower, old]
const lastUsed = new Map([['upper', '2026-11-16']])
const TODAY = '2026-11-18'
const NONE = new Set<string>()
const call = (plan: TrainingPlan | undefined, done: ReadonlySet<string> = NONE, rs: Routine[] = routines) => startSuggestion({ plan, today: TODAY, done, routines: rs, lastUsed })

describe('startSuggestion', () => {
  it('no plan: the habitual routine, flagged as no plan', () => {
    const s = call(undefined)
    expect(s).toMatchObject({ kind: 'habitual', hasPlan: false })
    expect(s.routine?.id).toBe('upper')
    expect(offeredRoutine(s)?.id).toBe('upper')
  })
  it('no plan and no routines: nothing to offer (a free session)', () => {
    const s = call(undefined, NONE, [])
    expect(s).toMatchObject({ kind: 'habitual', routine: null, habitual: null, hasPlan: false })
    expect(offeredRoutine(s)).toBeNull()
  })
  it('today planned with a routine: that routine, not the habitual one', () => {
    const s = call({ days: { '3': { routineId: 'lower' } } })
    expect(s).toMatchObject({ kind: 'planned', hasPlan: true })
    expect(s.routine?.id).toBe('lower')
    expect(s.habitual?.id).toBe('upper')
    expect(offeredRoutine(s)?.id).toBe('lower')
  })
  it('today planned without a routine (days-only plan): planned, and the offer is the habitual routine', () => {
    const s = call({ days: { '3': {} } })
    expect(s).toMatchObject({ kind: 'planned', routine: null })
    expect(offeredRoutine(s)?.id).toBe('upper')
  })
  it('today planned with no routines at all: planned, free session', () => {
    const s = call({ days: { '3': {} } }, NONE, [])
    expect(s.kind).toBe('planned')
    expect(offeredRoutine(s)).toBeNull()
  })
  it('today planned with an archived or deleted routine: treated as a days-only day', () => {
    for (const id of ['old', 'gone']) {
      const s = call({ days: { '3': { routineId: id } } })
      expect(s.kind).toBe('planned')
      expect(s.routine).toBeNull()
      expect(offeredRoutine(s)?.id).toBe('upper')
    }
  })
  it('today planned and done: back to the habitual suggestion, plan still flagged', () => {
    const s = call({ days: { '3': { routineId: 'lower' } } }, new Set([TODAY]))
    expect(s).toMatchObject({ kind: 'habitual', hasPlan: true })
    expect(offeredRoutine(s)?.id).toBe('upper')
  })
  it('today rest: habitual, plan flagged', () => {
    const s = call({ days: { '4': { routineId: 'lower' } } })
    expect(s).toMatchObject({ kind: 'habitual', hasPlan: true })
    expect(offeredRoutine(s)?.id).toBe('upper')
  })
  it('today rest but a session was done: still habitual', () => {
    expect(call({ days: { '4': {} } }, new Set([TODAY]))).toMatchObject({ kind: 'habitual', hasPlan: true })
  })
  it('a one-off override can make a rest day planned, and a planned day rest', () => {
    expect(call({ days: { '4': {} }, overrides: { [TODAY]: { routineId: 'lower' } } }).kind).toBe('planned')
    expect(call({ days: { '3': {} }, overrides: { [TODAY]: { rest: true } } }).kind).toBe('habitual')
  })
  it('plan exists but nothing is left this week (all earlier weekdays): habitual, plan flagged', () => {
    const s = call({ days: { '1': {}, '2': {} } })
    expect(s).toMatchObject({ kind: 'habitual', hasPlan: true })
  })
  it('an empty plan object is "no plan"', () => {
    expect(call({} as TrainingPlan)).toMatchObject({ kind: 'habitual', hasPlan: false })
    expect(call({ days: {} })).toMatchObject({ kind: 'habitual', hasPlan: false })
  })
})
