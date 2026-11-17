import { describe, expect, it } from 'vitest'
import type { ExerciseSet, Routine, TrainingSession } from '../../db/types'
import { addDays } from '../../domain/dates'
import {
  allRecords,
  digestSessions,
  formatMinutes,
  groupByMonth,
  headlineRecords,
  lastExercisePerformance,
  lastUsedByRoutine,
  minutesText,
  prepareStats,
  recentRecords,
  recordCountBySession,
  routineStats,
  weekSummary,
  weekToDate,
  weeklyVolumeMean,
  weeklySeries,
  workSetsPerGroup,
  type CatalogMuscles,
} from './trainingStats'

// Synthetic data only. 2026-11-09 is a Monday, 2026-11-15 the Sunday that closes that week.
const TODAY = '2026-11-15'
let n = 0
const base = { profileId: 'p', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
function session(date: string, extra: Partial<TrainingSession> = {}): TrainingSession {
  const id = extra.id ?? `s${++n}`
  return { ...base, id, date, name: 'Pierna A', routineId: 'r1', status: 'done', startedAt: `${date}T18:00:00.000Z`, endedAt: null, restEndsAt: null, exerciseOrder: [], durationMin: 60, ...extra }
}
function set(sessionId: string, date: string, extra: Partial<ExerciseSet> = {}): ExerciseSet {
  return { ...base, id: `x${++n}`, sessionId, date, exerciseId: 'squat', exerciseName: 'Sentadilla', setIndex: 0, weight: 100, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, ...extra }
}

describe('weekSummary', () => {
  it('uses ISO weeks (Monday to Sunday) and the date of the session', () => {
    const sun = session('2026-11-08')
    const mon = session('2026-11-09')
    const end = session('2026-11-15')
    const next = session('2026-11-16')
    const sets = [set(sun.id, sun.date), set(mon.id, mon.date), set(end.id, end.date, { reps: 10 }), set(next.id, next.date)]
    const p = prepareStats([sun, mon, end, next], sets)
    const w = weekSummary(p, '2026-11-12')
    expect(w).toMatchObject({ weekStart: '2026-11-09', weekEnd: '2026-11-15', sessions: 2, workSets: 2, volume: 500 + 1000 })
    expect(weekSummary(p, '2026-11-08')).toMatchObject({ weekStart: '2026-11-02', sessions: 1, volume: 500 })
    expect(weekSummary(p, '2026-11-16').sessions).toBe(1)
  })

  it('ignores warm-ups (flag and kind), undone sets, flagged rows, active sessions and orphan sets', () => {
    const s = session('2026-11-10')
    const flagged = session('2026-11-11', { excludeFromStats: true })
    const active = session('2026-11-12', { status: 'active' })
    const sets = [
      set(s.id, s.date),
      set(s.id, s.date, { isWarmup: true, kind: 'warmup', weight: 40 }),
      set(s.id, s.date, { kind: 'drop', weight: 50, reps: 10 }), // drop sets are work sets
      set(s.id, s.date, { done: false }),
      set(s.id, s.date, { excludeFromStats: true }),
      set(flagged.id, flagged.date),
      set(active.id, active.date),
      set('ghost', s.date),
    ]
    const w = weekSummary(prepareStats([s, flagged, active], sets), TODAY)
    expect(w.sessions).toBe(1)
    expect(w.workSets).toBe(2)
    expect(w.volume).toBe(500 + 500)
  })

  it('totals time only over sessions that have a duration and says how many lack one', () => {
    const a = session('2026-11-09', { durationMin: 50 })
    const b = session('2026-11-10', { durationMin: 70 })
    const c = session('2026-11-11', { durationMin: null })
    const d = session('2026-11-12', { durationMin: 0 })
    const w = weekSummary(prepareStats([a, b, c, d], []), TODAY)
    expect(w).toMatchObject({ sessions: 4, durationMin: 120, timedSessions: 2, untimedSessions: 2 })
  })
})

describe('weeklySeries', () => {
  it('lists consecutive weeks oldest first, keeps empty weeks, and drops weeks before the first session', () => {
    const a = session('2026-10-20') // week of 2026-10-19
    const b = session('2026-11-10')
    const p = prepareStats([a, b], [set(a.id, a.date), set(b.id, b.date)])
    const s = weeklySeries(p, TODAY, 10)
    expect(s.map((w) => w.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'])
    expect(s.map((w) => w.sessions)).toEqual([1, 0, 0, 1])
    expect(weeklySeries(p, TODAY, 2).map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09'])
  })
  it('is empty without sessions', () => {
    expect(weeklySeries(prepareStats([], []), TODAY)).toEqual([])
  })
})

describe('workSetsPerGroup', () => {
  const catalog: CatalogMuscles = new Map([
    ['squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings'] }],
    ['row', { primaryMuscles: ['lats', 'middle back'], secondaryMuscles: ['biceps'] }],
  ])
  it('counts work sets for the primary muscle group only, once per set and group', () => {
    const s = session('2026-11-10')
    const sets = [set(s.id, s.date), set(s.id, s.date), set(s.id, s.date, { isWarmup: true }), set(s.id, s.date, { exerciseId: 'row' }), set(s.id, s.date, { exerciseId: 'unknown' })]
    const r = workSetsPerGroup(prepareStats([s], sets), TODAY, catalog)
    expect(r.groups).toEqual([
      { group: 'legs', sets: 2 },
      { group: 'back', sets: 1 }, // lats + middle back are both "back": one set, one count
    ])
    expect(r.perMuscle.find((m) => m.muscle === 'glutes')).toMatchObject({ sets: 0, secondarySets: 2 })
  })
  it('only looks at the requested week', () => {
    const s = session('2026-11-02')
    expect(workSetsPerGroup(prepareStats([s], [set(s.id, s.date)]), TODAY, catalog).groups).toEqual([])
  })
})

describe('records', () => {
  function history() {
    const old = session('2026-09-01')
    const recent = session('2026-11-10')
    const edge = session(addDays(TODAY, -29)) // first day of the 30-day window
    const outside = session(addDays(TODAY, -30))
    const sets = [
      set(old.id, old.date, { weight: 100, reps: 5, createdAt: '2026-09-01T10:00:00.000Z' }),
      set(outside.id, outside.date, { weight: 105, reps: 5, createdAt: '2026-10-16T10:00:00.000Z' }),
      set(edge.id, edge.date, { weight: 110, reps: 5, createdAt: '2026-10-17T10:00:00.000Z' }),
      set(recent.id, recent.date, { weight: 120, reps: 5, createdAt: '2026-11-10T10:00:00.000Z' }),
      set(recent.id, recent.date, { setIndex: 1, weight: 60, reps: 5, isWarmup: true, createdAt: '2026-11-10T10:01:00.000Z' }),
    ]
    return { p: prepareStats([old, recent, edge, outside], sets), recent, edge, outside }
  }
  it('lists records from the last 30 days, one per exercise and type, newest first, never from warm-ups', () => {
    const { p, recent } = history()
    const recs = recentRecords(p, allRecords(p), TODAY, 30)
    expect(recs.every((r) => r.date >= addDays(TODAY, -29))).toBe(true)
    const w = recs.filter((r) => r.type === 'max_weight')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ exerciseName: 'Sentadilla', value: 120, display: '120 kg', date: recent.date, label: 'Peso máximo' })
    expect(recs[0]!.date).toBe(recent.date)
    expect(recs.some((r) => r.value === 60)).toBe(false)
  })
  it('respects the window: older records are out, the first day of the window is in', () => {
    const { p, edge, outside } = history()
    const all = recentRecords(p, allRecords(p), TODAY, 30)
    expect(all.some((r) => r.sessionId === outside.id)).toBe(false)
    expect(recentRecords(p, allRecords(p), TODAY, 3)).toEqual([])
    // On the day of the edge session a one-day window holds its own record.
    const day = recentRecords(p, allRecords(p), edge.date, 1)
    expect(day.map((r) => r.sessionId)).toEqual(expect.arrayContaining([edge.id]))
  })
  it('headlineRecords keeps one record per exercise and a limit', () => {
    const { p } = history()
    const recs = recentRecords(p, allRecords(p), TODAY, 30)
    expect(recs.length).toBeGreaterThan(1)
    expect(headlineRecords(recs, 5)).toHaveLength(1)
    expect(headlineRecords(recs, 0)).toEqual([])
  })
  it('counts the exercises that reached a record in each session', () => {
    const { p, recent, edge } = history()
    const c = recordCountBySession(p, allRecords(p))
    expect(c.get(recent.id)).toBe(1)
    expect(c.get(edge.id)).toBe(1)
  })
})

describe('routineStats', () => {
  const routine: Pick<Routine, 'id' | 'exercises'> = {
    id: 'r1',
    exercises: [
      { key: 'a', exerciseId: 'squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 4, targetReps: '5', restSec: 120, warmupSets: 2 },
      { key: 'b', exerciseId: 'row', name: 'Remo', trackingType: 'weight_reps', targetSets: 3, targetReps: '8-10', restSec: 90 },
    ],
  }
  const catalog: CatalogMuscles = new Map([
    ['squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: [] }],
    ['row', { primaryMuscles: ['lats'], secondaryMuscles: [] }],
  ])
  it('summarises the plan, the groups and the last use', () => {
    const a = session('2026-11-02', { durationMin: 50 })
    const b = session('2026-11-10', { durationMin: 70 })
    const other = session('2026-11-12', { routineId: 'r2' })
    const p = prepareStats([a, b, other], [])
    const st = routineStats(routine, p, TODAY, catalog)
    expect(st).toMatchObject({ exerciseCount: 2, plannedSets: 7, plannedWarmups: 2, lastDate: '2026-11-10', timesLast4Weeks: 2, sessionCount: 2 })
    expect(st.groups).toEqual([
      { group: 'legs', sets: 4 },
      { group: 'back', sets: 3 },
    ])
    expect(lastUsedByRoutine(p).get('r1')).toBe('2026-11-10')
  })
  it('estimates the duration only from at least 2 sessions that have one (median)', () => {
    const none = routineStats(routine, prepareStats([], []), TODAY)
    expect(none.estimatedMin).toBeNull()
    expect(none.lastDate).toBeNull()
    const one = routineStats(routine, prepareStats([session('2026-11-10', { durationMin: 60 })], []), TODAY)
    expect(one.estimatedMin).toBeNull()
    const oneTimed = routineStats(routine, prepareStats([session('2026-11-10', { durationMin: 60 }), session('2026-11-03', { durationMin: null })], []), TODAY)
    expect(oneTimed.estimatedMin).toBeNull()
    const two = routineStats(routine, prepareStats([session('2026-11-10', { durationMin: 60 }), session('2026-11-03', { durationMin: 51 })], []), TODAY)
    expect(two.estimatedMin).toBe(56) // median of 51 and 60 is 55.5
    const three = routineStats(routine, prepareStats([session('2026-11-10', { durationMin: 90 }), session('2026-11-03', { durationMin: 50 }), session('2026-10-27', { durationMin: 56 })], []), TODAY)
    expect(three.estimatedMin).toBe(56)
  })
  it('does not count flagged or unfinished sessions of the routine, nor sessions older than 4 weeks as recent', () => {
    const p = prepareStats([session('2026-11-10', { excludeFromStats: true }), session('2026-11-11', { status: 'active' }), session('2026-10-10')], [])
    const st = routineStats(routine, p, TODAY)
    expect(st.sessionCount).toBe(1)
    expect(st.timesLast4Weeks).toBe(0)
    expect(st.lastDate).toBe('2026-10-10')
  })
})

describe('lastExercisePerformance', () => {
  it('returns the latest session with work sets of the exercise and its best set', () => {
    const a = session('2026-11-02')
    const b = session('2026-11-10')
    const sets = [set(a.id, a.date, { weight: 90 }), set(b.id, b.date, { setIndex: 1, weight: 100 }), set(b.id, b.date, { setIndex: 0, weight: 80, isWarmup: true }), set(b.id, b.date, { setIndex: 2, weight: 100, reps: 7 })]
    const last = lastExercisePerformance(prepareStats([a, b], sets), ['squat'])
    expect(last?.date).toBe('2026-11-10')
    expect(last?.sets).toHaveLength(2)
    expect(last?.best?.reps).toBe(7)
    expect(lastExercisePerformance(prepareStats([a, b], sets), ['nothing'])).toBeNull()
  })
})

describe('history helpers', () => {
  it('digests sessions and groups them by month in order', () => {
    const a = session('2026-11-10', { durationMin: null })
    const b = session('2026-10-30')
    const c = session('2026-10-02')
    const p = prepareStats([a, b, c], [set(a.id, a.date), set(a.id, a.date), set(b.id, b.date)])
    const d = digestSessions(p, new Map([[a.id, 2]]))
    expect(d.map((x) => [x.session.id, x.workSets, x.volume, x.minutes, x.records])).toEqual([
      [a.id, 2, 1000, null, 2],
      [b.id, 1, 500, 60, 0],
      [c.id, 0, 0, 60, 0],
    ])
    expect(groupByMonth(d).map((g) => [g.label, g.rows.length])).toEqual([
      ['Noviembre 2026', 1],
      ['Octubre 2026', 2],
    ])
  })
  it('formats minutes', () => {
    expect(formatMinutes(48)).toEqual({ value: '48', unit: 'min' })
    expect(formatMinutes(95)).toEqual({ value: '1:35', unit: 'h' })
    expect(minutesText(58)).toBe('58 min')
    expect(minutesText(95)).toBe('1 h 35 min')
  })
})

describe('weekToDate (the week so far against the same point of the previous one)', () => {
  // Previous week 2026-11-09 (Mon) .. 11-15 (Sun): sessions on Monday, Wednesday and Friday.
  const mon = session('2026-11-09')
  const wed = session('2026-11-11')
  const fri = session('2026-11-13', { durationMin: 30 })
  const lastWeek = [mon, wed, fri]
  const sets = lastWeek.map((s) => set(s.id, s.date)) // 500 kg each
  const prepared = (extra: TrainingSession[] = [], extraSets: ExerciseSet[] = []) => prepareStats([...lastWeek, ...extra], [...sets, ...extraSets])

  it('Monday with no session yet: an empty week, last Monday as the same point, the whole last week as reference', () => {
    const r = weekToDate(prepared(), '2026-11-16')
    expect(r.week).toMatchObject({ weekStart: '2026-11-16', sessions: 0, workSets: 0, volume: 0, durationMin: 0 })
    expect(r.previous).toMatchObject({ weekStart: '2026-11-09', sessions: 1, volume: 500 })
    expect(r.previousFull).toMatchObject({ sessions: 3, workSets: 3, volume: 1500 })
  })

  it('Wednesday with one session: compared with last Monday + Wednesday, not with the whole week', () => {
    const now = session('2026-11-16')
    const r = weekToDate(prepared([now], [set(now.id, now.date)]), '2026-11-18')
    expect(r.week.sessions).toBe(1)
    expect(r.previous).toMatchObject({ sessions: 2, volume: 1000 })
    expect(r.previousFull.sessions).toBe(3)
  })

  it('Sunday: the same point is the whole previous week (full week against full week)', () => {
    const now = session('2026-11-22')
    const r = weekToDate(prepared([now], [set(now.id, now.date)]), '2026-11-22')
    expect(r.previous).toEqual(r.previousFull)
    expect(r.week.weekEnd).toBe('2026-11-22')
  })

  it('a session of today counts in this week and a session of the same weekday last week counts in the other', () => {
    const lastMonday = session('2026-11-16')
    const r = weekToDate(prepareStats([lastMonday], [set(lastMonday.id, lastMonday.date)]), '2026-11-23')
    expect(r.week.sessions).toBe(0)
    expect(r.previous.sessions).toBe(1)
  })
})

describe('weeklyVolumeMean (the week in progress is not a week yet)', () => {
  const a = session('2026-11-02')
  const b = session('2026-11-09')
  const sets = [set(a.id, a.date), set(b.id, b.date, { reps: 10 })] // 500 kg and 1000 kg
  const p = prepareStats([a, b], sets)

  it('Monday with no session yet: the empty current week is out of the mean and of the coverage', () => {
    const weeks = weeklySeries(p, '2026-11-16', 3) // 11-02, 11-09, 11-16 (just started, empty)
    expect(weeks.map((w) => w.volume)).toEqual([500, 1000, 0])
    const r = weeklyVolumeMean(weeks, '2026-11-16')
    expect(r.complete.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09'])
    expect(r.inProgress?.weekStart).toBe('2026-11-16')
    expect(r.mean).toBe(750) // not 500
    expect(r.trained).toBe(2)
  })

  it('also leaves a partly trained current week out, and counts it again once it is over', () => {
    const c = session('2026-11-16')
    const q = prepareStats([a, b, c], [...sets, set(c.id, c.date)])
    const mid = weeklyVolumeMean(weeklySeries(q, '2026-11-18', 3), '2026-11-18')
    expect(mid.mean).toBe(750)
    const after = weeklyVolumeMean(weeklySeries(q, '2026-11-23', 4), '2026-11-23')
    expect(after.complete).toHaveLength(3)
    expect(after.inProgress?.weekStart).toBe('2026-11-23')
    expect(after.mean).toBeCloseTo(2000 / 3)
  })

  it('has no mean when no week is complete', () => {
    const r = weeklyVolumeMean(weeklySeries(prepareStats([b], [sets[1]!]), '2026-11-11', 3), '2026-11-11')
    expect(r.mean).toBeNull()
  })
})
