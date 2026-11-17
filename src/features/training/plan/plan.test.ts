import { describe, expect, it } from 'vitest'
import type { TrainingPlan } from '../../../db/types'
import {
  dayStatus,
  desiredReminders,
  doneDates,
  hasPlan,
  isValidReminderTime,
  localInstant,
  moveDay,
  nextPlanned,
  planFor,
  pruneOverrides,
  remindersFor,
  resolveRoutine,
  sanitizePlan,
  setOverride,
  setReminder,
  setWeekday,
} from './plan'

// 2026-11-16 is a Monday; 2026-11-18 a Wednesday; 2026-11-22 a Sunday.
const NONE = new Set<string>()
const daysOnly: TrainingPlan = { days: { '1': {}, '3': {}, '5': {} } } // Mon, Wed, Fri
const withRoutines: TrainingPlan = { days: { '1': { routineId: 'upper' }, '4': { routineId: 'lower' } } }

describe('hasPlan / planFor', () => {
  it('no plan, empty plan and garbage are "no plan" (null), never rest', () => {
    for (const p of [undefined, null, {}, { days: {} }, { reminder: { on: true, time: '07:00' } }, 'x', 3, []] as unknown[]) {
      expect(hasPlan(p as TrainingPlan)).toBe(false)
      expect(planFor(p as TrainingPlan, '2026-11-18')).toBeNull()
    }
  })
  it('a weekday-only plan trains the listed weekdays and rests the others', () => {
    expect(hasPlan(daysOnly)).toBe(true)
    expect(planFor(daysOnly, '2026-11-16')).toEqual({ kind: 'train', routineId: null })
    expect(planFor(daysOnly, '2026-11-17')).toEqual({ kind: 'rest' })
    expect(planFor(daysOnly, '2026-11-18')).toEqual({ kind: 'train', routineId: null })
    expect(planFor(daysOnly, '2026-11-22')).toEqual({ kind: 'rest' }) // Sunday
  })
  it('a plan with routines returns the routine id per weekday', () => {
    expect(planFor(withRoutines, '2026-11-19')).toEqual({ kind: 'train', routineId: 'lower' })
    expect(planFor(withRoutines, '2026-11-23')).toEqual({ kind: 'train', routineId: 'upper' })
  })
  it('overrides beat weekdays in both directions', () => {
    const p: TrainingPlan = { ...withRoutines, overrides: { '2026-11-19': { rest: true }, '2026-11-20': { routineId: 'upper' }, '2026-11-23': { routineId: 'lower' } } }
    expect(planFor(p, '2026-11-19')).toEqual({ kind: 'rest' }) // Thursday trains, this one rests
    expect(planFor(p, '2026-11-20')).toEqual({ kind: 'train', routineId: 'upper' }) // Friday rests, this one trains
    expect(planFor(p, '2026-11-23')).toEqual({ kind: 'train', routineId: 'lower' }) // other routine that day only
    expect(planFor(p, '2026-11-30')).toEqual({ kind: 'train', routineId: 'upper' }) // next Monday is untouched
  })
  it('a malformed date is "no plan", not a crash', () => {
    expect(planFor(daysOnly, 'hoy')).toBeNull()
    expect(planFor(daysOnly, '2026-02-30')).toBeNull()
  })
  it('weekday boundaries: Sunday to Monday, month and year', () => {
    const p: TrainingPlan = { days: { '7': {}, '1': {}, '4': {}, '5': {} } }
    expect(planFor(p, '2026-11-22')?.kind).toBe('train') // Sunday
    expect(planFor(p, '2026-11-23')?.kind).toBe('train') // Monday
    expect(planFor(p, '2026-12-31')?.kind).toBe('train') // Thursday, end of year
    expect(planFor(p, '2027-01-01')?.kind).toBe('train') // Friday, new year
    expect(planFor(p, '2027-01-02')?.kind).toBe('rest')
    expect(planFor(p, '2026-10-31')?.kind).toBe('rest') // Saturday
  })
})

describe('doneDates / dayStatus', () => {
  const s = (date: string, status: 'active' | 'done', excludeFromStats?: boolean) => ({ date, status, excludeFromStats })
  it('only counted finished sessions make a day done', () => {
    const done = doneDates([s('2026-11-18', 'active'), s('2026-11-17', 'done', true), s('2026-11-16', 'done'), s('bad', 'done')])
    expect([...done]).toEqual(['2026-11-16'])
    expect(dayStatus(daysOnly, '2026-11-18', done)).toBe('planned') // the active session does not count
    expect(dayStatus(daysOnly, '2026-11-17', done)).toBe('rest') // nor the excluded one
    expect(dayStatus(daysOnly, '2026-11-16', done)).toBe('done')
  })
  it('none / rest / planned / done', () => {
    expect(dayStatus(undefined, '2026-11-18', NONE)).toBe('none')
    expect(dayStatus(daysOnly, '2026-11-17', NONE)).toBe('rest')
    expect(dayStatus(daysOnly, '2026-11-18', NONE)).toBe('planned')
    expect(dayStatus(daysOnly, '2026-11-18', new Set(['2026-11-18']))).toBe('done')
  })
  it('a finished session on a rest day or without a plan still shows done (it really happened)', () => {
    expect(dayStatus(daysOnly, '2026-11-17', new Set(['2026-11-17']))).toBe('done')
    expect(dayStatus(undefined, '2026-11-17', new Set(['2026-11-17']))).toBe('done')
  })
})

describe('nextPlanned', () => {
  it('returns today when today trains and is not done', () => {
    expect(nextPlanned(withRoutines, '2026-11-19', NONE)).toEqual({ date: '2026-11-19', routineId: 'lower' })
  })
  it('skips today when today is done', () => {
    expect(nextPlanned(withRoutines, '2026-11-19', new Set(['2026-11-19']))).toEqual({ date: '2026-11-23', routineId: 'upper' })
  })
  it('crosses the Sunday to Monday boundary, the month and the year', () => {
    expect(nextPlanned(withRoutines, '2026-11-20', NONE)?.date).toBe('2026-11-23')
    expect(nextPlanned({ days: { '2': {} } }, '2026-12-30', NONE)?.date).toBe('2027-01-05')
  })
  it('respects the horizon and returns null without a plan or without training days', () => {
    expect(nextPlanned(undefined, '2026-11-18', NONE)).toBeNull()
    expect(nextPlanned({ days: {} }, '2026-11-18', NONE)).toBeNull()
    const onlyOverride: TrainingPlan = { days: { '1': {} }, overrides: { '2026-11-23': { rest: true }, '2026-11-30': { rest: true }, '2026-12-07': { rest: true } } }
    expect(nextPlanned(onlyOverride, '2026-11-22', NONE, 21)).toBeNull()
    expect(nextPlanned(onlyOverride, '2026-11-22', NONE, 22)?.date).toBe('2026-12-14')
  })
  it('an override that moves the session is found at its new date', () => {
    const moved = moveDay(withRoutines, '2026-11-19', '2026-11-21')
    expect(nextPlanned(moved, '2026-11-19', NONE)).toEqual({ date: '2026-11-21', routineId: 'lower' })
  })
})

describe('resolveRoutine', () => {
  const routines = [
    { id: 'upper', archived: false },
    { id: 'old', archived: true },
  ]
  it('finds an active routine', () => {
    expect(resolveRoutine({ kind: 'train', routineId: 'upper' }, routines)).toBe(routines[0])
  })
  it('a missing or archived routine, no routine, rest and no plan resolve to null (a training day without routine)', () => {
    expect(resolveRoutine({ kind: 'train', routineId: 'gone' }, routines)).toBeNull()
    expect(resolveRoutine({ kind: 'train', routineId: 'old' }, routines)).toBeNull()
    expect(resolveRoutine({ kind: 'train', routineId: null }, routines)).toBeNull()
    expect(resolveRoutine({ kind: 'rest' }, routines)).toBeNull()
    expect(resolveRoutine(null, routines)).toBeNull()
    expect(resolveRoutine({ kind: 'train', routineId: 'upper' }, undefined)).toBeNull()
  })
  it('the plan day itself still trains when the routine vanished', () => {
    const p: TrainingPlan = { days: { '4': { routineId: 'gone' } } }
    expect(planFor(p, '2026-11-19')).toEqual({ kind: 'train', routineId: 'gone' })
    expect(dayStatus(p, '2026-11-19', NONE)).toBe('planned')
  })
})

describe('remindersFor', () => {
  const plan: TrainingPlan = { days: { '1': { routineId: 'upper' }, '3': {}, '5': {} }, reminder: { on: true, time: '07:30' } }
  const now = new Date(2026, 10, 18, 6, 0) // Wednesday 06:00 on this device
  it('lists future instants of training days at the local time, within 28 days', () => {
    const r = remindersFor(plan, now, NONE)
    expect(r[0]).toEqual({ date: '2026-11-18', atMs: new Date(2026, 10, 18, 7, 30).getTime(), routineId: null })
    expect(r.map((x) => x.date).slice(0, 4)).toEqual(['2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25'])
    expect(r.at(-1)!.date <= '2026-12-15').toBe(true) // today + 27
    expect(r).toHaveLength(12)
    expect(r.find((x) => x.date === '2026-11-23')?.routineId).toBe('upper')
    for (const x of r) expect(x.atMs).toBeGreaterThan(now.getTime())
  })
  it('today is dropped once its time has passed', () => {
    const r = remindersFor(plan, new Date(2026, 10, 18, 7, 30, 0, 1), NONE)
    expect(r[0]!.date).toBe('2026-11-20')
  })
  it('none for done days, none when off, none for a malformed time or no plan', () => {
    expect(remindersFor(plan, now, new Set(['2026-11-18']))[0]!.date).toBe('2026-11-20')
    expect(remindersFor({ ...plan, reminder: { on: false, time: '07:30' } }, now, NONE)).toEqual([])
    for (const time of ['7:30', '24:00', '07:60', '', 'ab:cd', '07:30:00']) expect(remindersFor({ ...plan, reminder: { on: true, time } }, now, NONE)).toEqual([])
    expect(remindersFor({ days: plan.days }, now, NONE)).toEqual([])
    expect(remindersFor(undefined, now, NONE)).toEqual([])
  })
  it('follows overrides (a rested day has none, a moved session reminds on its new date)', () => {
    const moved = moveDay(plan, '2026-11-20', '2026-11-21')
    const dates = remindersFor(moved, now, NONE).map((x) => x.date)
    expect(dates).not.toContain('2026-11-20')
    expect(dates).toContain('2026-11-21')
  })
  it('accepts a number, honours `days`, crosses the year and never throws on bad input', () => {
    expect(remindersFor(plan, now.getTime(), NONE, 3).map((x) => x.date)).toEqual(['2026-11-18', '2026-11-20'])
    const ny = remindersFor({ days: { '4': {}, '5': {} }, reminder: { on: true, time: '08:00' } }, new Date(2026, 11, 30, 9, 0), NONE, 5)
    expect(ny.map((x) => x.date)).toEqual(['2026-12-31', '2027-01-01'])
    expect(remindersFor(plan, Number.NaN, NONE)).toEqual([])
    expect(() => remindersFor({ days: 'x', reminder: 4 } as unknown as TrainingPlan, now, NONE)).not.toThrow()
  })
  it('localInstant is the device wall clock of that date and does not throw', () => {
    expect(localInstant('2026-11-18', '07:30')).toBe(new Date(2026, 10, 18, 7, 30).getTime())
    expect(Number.isFinite(localInstant('2026-03-08', '02:30'))).toBe(true)
  })
  it('time validation', () => {
    expect(isValidReminderTime('00:00')).toBe(true)
    expect(isValidReminderTime('23:59')).toBe(true)
    expect(isValidReminderTime('9:00')).toBe(false)
    expect(isValidReminderTime(900)).toBe(false)
  })
})

describe('edit helpers', () => {
  it('setWeekday sets and clears without touching other days, keeps routines and unknown keys', () => {
    const base = { days: { '1': { routineId: 'upper' } }, reminder: { on: true, time: '07:00' }, future: { a: 1 } } as TrainingPlan
    const a = setWeekday(base, 4, { kind: 'train', routineId: 'lower' })
    expect(a.days).toEqual({ '1': { routineId: 'upper' }, '4': { routineId: 'lower' } })
    expect((a as Record<string, unknown>).future).toEqual({ a: 1 })
    expect(a.reminder).toEqual({ on: true, time: '07:00' })
    expect(setWeekday(a, 4, { kind: 'train', routineId: null }).days?.['4']).toEqual({})
    expect(setWeekday(a, 4, { kind: 'rest' }).days).toEqual({ '1': { routineId: 'upper' } })
    expect(setWeekday(a, 1, null).days).toEqual({ '4': { routineId: 'lower' } })
    expect(base.days).toEqual({ '1': { routineId: 'upper' } }) // input untouched
    expect(setWeekday(undefined, 2, { kind: 'train', routineId: null }).days).toEqual({ '2': {} })
    expect(setWeekday(a, 9, { kind: 'train', routineId: null })).toEqual(a)
  })
  it('setOverride stores only real differences and clears with null', () => {
    const a = setOverride(withRoutines, '2026-11-19', { kind: 'rest' })
    expect(a.overrides).toEqual({ '2026-11-19': { rest: true } })
    expect(setOverride(a, '2026-11-19', null).overrides).toEqual({})
    // same as the weekday already says → nothing stored
    expect(setOverride(withRoutines, '2026-11-19', { kind: 'train', routineId: 'lower' }).overrides).toEqual({})
    expect(setOverride(withRoutines, '2026-11-20', { kind: 'rest' }).overrides).toEqual({})
    expect(setOverride(withRoutines, '2026-11-20', { kind: 'train', routineId: null }).overrides).toEqual({ '2026-11-20': {} })
    expect(setOverride(withRoutines, 'nope', { kind: 'rest' })).toEqual(withRoutines)
  })
  it('moveDay = rest on the origin + training on the target with the origin routine', () => {
    const m = moveDay(withRoutines, '2026-11-19', '2026-11-21')
    expect(planFor(m, '2026-11-19')).toEqual({ kind: 'rest' })
    expect(planFor(m, '2026-11-21')).toEqual({ kind: 'train', routineId: 'lower' })
    expect(planFor(m, '2026-11-26')).toEqual({ kind: 'train', routineId: 'lower' }) // next week untouched
    expect(moveDay(withRoutines, '2026-11-20', '2026-11-21')).toEqual(withRoutines) // origin does not train
    expect(moveDay(withRoutines, '2026-11-19', '2026-11-19')).toEqual(withRoutines)
  })
  it('moving a session back restores the plain weekly plan (no leftover overrides)', () => {
    const there = moveDay(withRoutines, '2026-11-19', '2026-11-21')
    const back = moveDay(there, '2026-11-21', '2026-11-19')
    expect(back.overrides).toEqual({})
  })
  it('moving an override-trained day keeps the routine of that day', () => {
    const p = setOverride(withRoutines, '2026-11-20', { kind: 'train', routineId: 'upper' })
    const m = moveDay(p, '2026-11-20', '2026-11-22')
    expect(planFor(m, '2026-11-20')).toEqual({ kind: 'rest' })
    expect(planFor(m, '2026-11-22')).toEqual({ kind: 'train', routineId: 'upper' })
  })
  it('pruneOverrides drops overrides older than 14 days and keeps the rest', () => {
    const p: TrainingPlan = { days: { '1': {} }, overrides: { '2026-11-03': { rest: true }, '2026-11-04': { rest: true }, '2026-11-18': { rest: true }, '2026-12-10': { routineId: 'x' } } }
    expect(Object.keys(pruneOverrides(p, '2026-11-18').overrides!)).toEqual(['2026-11-04', '2026-11-18', '2026-12-10'])
    expect(pruneOverrides({ days: { '1': {} } }, '2026-11-18')).toEqual({ days: { '1': {} } })
  })
  it('setReminder writes a valid time', () => {
    expect(setReminder(daysOnly, { on: true, time: '06:45' }).reminder).toEqual({ on: true, time: '06:45' })
    expect(setReminder(daysOnly, { on: true, time: 'x' }).reminder).toEqual({ on: true, time: '07:00' })
  })
})

describe('sanitizePlan', () => {
  it('keeps valid data and unknown keys, drops the invalid', () => {
    const raw = {
      days: { '1': { routineId: 'a' }, '8': {}, '0': {}, x: {}, '2': 'no', '3': { routineId: 5 } },
      overrides: { '2026-11-19': { rest: true }, '2026-13-01': { rest: true }, '2026-11-20': { rest: false }, '2026-11-21': { routineId: 'b' }, '2026-11-22': null },
      reminder: { on: true, time: '07:00' },
      later: [1, 2],
    }
    expect(sanitizePlan(raw)).toEqual({
      days: { '1': { routineId: 'a' }, '3': {} },
      overrides: { '2026-11-19': { rest: true }, '2026-11-21': { routineId: 'b' } },
      reminder: { on: true, time: '07:00' },
      later: [1, 2],
    })
  })
  it('malformed reminders and non-objects never throw', () => {
    expect(sanitizePlan({ days: { '1': {} }, reminder: { on: 'yes', time: '07:00' } })?.reminder).toBeUndefined()
    expect(sanitizePlan({ days: { '1': {} }, reminder: { on: true, time: '7am' } })?.reminder).toBeUndefined()
    for (const v of [null, undefined, 0, 'x', [], true]) expect(sanitizePlan(v)).toBeUndefined()
    expect(sanitizePlan({ days: [1], overrides: 'x' })).toEqual({})
  })
  it('does not mutate its input', () => {
    const raw = { days: { '1': { routineId: 'a' }, '9': {} } }
    const copy = JSON.parse(JSON.stringify(raw))
    sanitizePlan(raw)
    expect(raw).toEqual(copy)
  })
})

describe('desiredReminders', () => {
  const routines = [
    { id: 'upper', name: 'Torso A', archived: false },
    { id: 'old', name: 'Vieja', archived: true },
  ]
  const now = new Date(2026, 10, 18, 6, 0)
  const plan: TrainingPlan = { days: { '3': { routineId: 'upper' }, '4': { routineId: 'old' }, '5': { routineId: 'gone' }, '6': {} }, reminder: { on: true, time: '07:30' } }
  it('body is the routine name; empty for no routine, an archived one or a deleted one', () => {
    const d = desiredReminders(plan, now, NONE, routines, 4)
    expect(d.map((x) => [x.date, x.body])).toEqual([['2026-11-18', 'Torso A'], ['2026-11-19', ''], ['2026-11-20', ''], ['2026-11-21', '']])
    expect(d[0]!.atMs).toBe(new Date(2026, 10, 18, 7, 30).getTime())
  })
  it('follows the done days, the reminder switch and the plan', () => {
    expect(desiredReminders(plan, now, new Set(['2026-11-18']), routines, 2)).toEqual([{ date: '2026-11-19', atMs: new Date(2026, 10, 19, 7, 30).getTime(), body: '' }])
    expect(desiredReminders({ ...plan, reminder: { on: false, time: '07:30' } }, now, NONE, routines)).toEqual([])
    expect(desiredReminders(undefined, now, NONE, routines)).toEqual([])
  })
})
