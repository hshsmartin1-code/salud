import { describe, expect, it } from 'vitest'
import {
  bestVolumeSession,
  defaultPeriod,
  E1RM_NOTE,
  isWorkSet,
  MAX_GAP_DAYS,
  metricSeries,
  metricsFor,
  periodRange,
  recordList,
  repRecords,
  sessionPoints,
  setKindOf,
  weeklyFrequency,
  type ProgressSet,
} from './exerciseProgress'

// Synthetic data only.
let n = 0
function set(sessionId: string, date: string, p: Partial<ProgressSet> = {}): ProgressSet {
  n++
  return { id: `s${n}`, sessionId, date, setIndex: n, weight: null, reps: null, durationSec: null, distanceM: null, isWarmup: false, done: true, ...p }
}

const sets: ProgressSet[] = [
  set('a', '2026-10-05', { weight: 40, reps: 10, isWarmup: true }),
  set('a', '2026-10-05', { weight: 60, reps: 8 }),
  set('a', '2026-10-05', { weight: 60, reps: 6 }),
  set('b', '2026-10-12', { weight: 62.5, reps: 8 }),
  set('b', '2026-10-12', { weight: 62.5, reps: 20 }), // reps > 10: no e1RM
  set('b', '2026-10-12', { weight: 100, reps: 3, done: false }), // not done: ignored everywhere
  set('c', '2026-11-09', { weight: 65, reps: 5 }),
  set('c', '2026-11-09', { weight: 200, reps: 1, excludeFromStats: true }), // flagged: ignored
]

describe('set kind helper', () => {
  it('treats isWarmup as warm-up and everything else as work', () => {
    expect(setKindOf({ isWarmup: true })).toBe('warmup')
    expect(setKindOf({ isWarmup: false })).toBe('work')
    expect(isWorkSet(sets[0]!)).toBe(false)
    expect(isWorkSet(sets[1]!)).toBe(true)
    expect(isWorkSet(sets[5]!)).toBe(false)
    expect(isWorkSet(sets[7]!)).toBe(false)
  })
})

describe('sessionPoints', () => {
  const pts = sessionPoints(sets)
  it('one point per session, oldest first, work sets only', () => {
    expect(pts.map((p) => p.sessionId)).toEqual(['a', 'b', 'c'])
    expect(pts[0]!.workSets).toBe(2)
    expect(pts[0]!.maxWeight).toBe(60)
    expect(pts[0]!.volume).toBe(60 * 8 + 60 * 6)
    expect(pts[2]!.maxWeight).toBe(65)
  })
  it('best e1RM uses Epley and ignores reps outside 1-15', () => {
    expect(pts[0]!.e1rm).toBeCloseTo(60 * (1 + 8 / 30), 6)
    // session b: the 20-rep set has no e1RM, the 8-rep one does
    expect(pts[1]!.e1rm).toBeCloseTo(62.5 * (1 + 8 / 30), 6)
    expect(pts[1]!.maxReps).toBe(20)
  })
})

describe('metricSeries', () => {
  const pts = sessionPoints(sets)
  it('max weight is a line of kg per session date', () => {
    const s = metricSeries(pts, 'maxWeight')
    expect(s.kind).toBe('line')
    expect(s.unit).toBe('kg')
    expect(s.points.map((p) => [p.date, p.value])).toEqual([
      ['2026-10-05', 60],
      ['2026-10-12', 62.5],
      ['2026-11-09', 65],
    ])
  })
  it('1RM points are marked as estimates', () => {
    expect(metricSeries(pts, 'e1rm').points.every((p) => p.estimated === true)).toBe(true)
  })
  it('volume is a bar series', () => {
    expect(metricSeries(pts, 'volume').kind).toBe('bar')
  })
  it('merges two sessions of the same day (max for peaks, sum for totals)', () => {
    const two = sessionPoints([set('x', '2026-11-01', { weight: 50, reps: 10 }), set('y', '2026-11-01', { weight: 55, reps: 5 })])
    expect(metricSeries(two, 'maxWeight').points).toHaveLength(1)
    expect(metricSeries(two, 'maxWeight').points[0]!.value).toBe(55)
    expect(metricSeries(two, 'volume').points[0]!.value).toBe(500 + 275)
  })
  it('scales long durations to minutes and long distances to km', () => {
    const long = sessionPoints([set('t', '2026-11-01', { durationSec: 1800, distanceM: 5000 })])
    expect(metricSeries(long, 'maxDuration')).toMatchObject({ unit: 'min', points: [{ value: 30 }] })
    expect(metricSeries(long, 'maxDistance')).toMatchObject({ unit: 'km', points: [{ value: 5 }] })
    const short = sessionPoints([set('t', '2026-11-01', { durationSec: 45 })])
    expect(metricSeries(short, 'maxDuration')).toMatchObject({ unit: 's', points: [{ value: 45 }] })
  })
  it('exposes the gap rule', () => {
    expect(MAX_GAP_DAYS).toBe(21)
  })
})

describe('metricsFor', () => {
  it('adapts to the tracking type', () => {
    expect(metricsFor('weight_reps')).toEqual(['maxWeight', 'e1rm', 'volume', 'maxReps'])
    expect(metricsFor('time')).toEqual(['maxDuration', 'totalDuration'])
    expect(metricsFor('distance')[0]).toBe('maxDistance')
    expect(metricsFor('bodyweight_reps', [set('s', '2026-01-01', { reps: 5 })])).toEqual(['maxReps', 'totalReps'])
    expect(metricsFor('bodyweight_reps', [set('s', '2026-01-01', { reps: 5, weight: 10 })])).toContain('maxWeight')
  })
})

describe('periods', () => {
  it('ranges end today and "all" starts at the first session', () => {
    expect(periodRange('90d', '2026-11-15', null)).toEqual({ from: '2026-08-18', to: '2026-11-15' })
    expect(periodRange('all', '2026-11-15', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-11-15' })
  })
  it('default period is the shortest one with at least two points', () => {
    const s = metricSeries(sessionPoints(sets), 'maxWeight')
    expect(defaultPeriod(s, '2026-11-15', '2026-10-05')).toBe('90d')
    expect(defaultPeriod(s, '2027-06-01', '2026-10-05')).toBe('1y')
    expect(defaultPeriod(s, '2030-01-01', '2026-10-05')).toBe('all')
  })
})

describe('weeklyFrequency', () => {
  it('counts sessions per ISO week, zero weeks included, and the average', () => {
    const f = weeklyFrequency(sessionPoints(sets), '2026-10-05', '2026-11-15')
    expect(f.sessions).toBe(3)
    expect(f.series.kind).toBe('bar')
    expect(f.series.points[0]).toMatchObject({ date: '2026-10-05', value: 1, span: 7 })
    expect(f.series.points[1]).toMatchObject({ date: '2026-10-12', value: 1 })
    expect(f.series.points[2]!.value).toBe(0)
    expect(f.weeks).toBe(6)
    expect(f.perWeek).toBeCloseTo(0.5, 6)
  })
  it('clamps the first and last weeks to the range', () => {
    const f = weeklyFrequency([], '2026-10-07', '2026-10-14') // Wed to Wed
    expect(f.series.points[0]).toMatchObject({ date: '2026-10-07', span: 5 })
    expect(f.series.points[1]).toMatchObject({ date: '2026-10-12', span: 3 })
  })
})

describe('records', () => {
  const recs = recordList(sets)
  const by = (id: string) => recs.find((r) => r.id === id)!
  it('each record carries its date and the set that produced it', () => {
    expect(by('maxWeight')).toMatchObject({ value: 65, date: '2026-11-09', sessionId: 'c', set: { weight: 65, reps: 5 } })
    expect(by('volumeSet')).toMatchObject({ value: 62.5 * 20, date: '2026-10-12' })
    expect(by('maxReps')).toMatchObject({ value: 20, date: '2026-10-12' })
    expect(by('e1rm').value).toBeCloseTo(62.5 * (1 + 8 / 30), 6) // 65x5 = 75.8 vs 62.5x8 = 79.2
  })
  it('ignores warm-ups, undone sets and flagged rows; ties keep the earliest date', () => {
    expect(recs.some((r) => r.value === 200 || r.value === 100)).toBe(false)
    const tie = recordList([set('p', '2026-02-01', { weight: 50, reps: 5 }), set('q', '2026-01-01', { weight: 50, reps: 5 })])
    expect(tie.find((r) => r.id === 'maxWeight')!.date).toBe('2026-01-01')
  })
  it('no e1RM from sets above 10 reps (Reynolds 2006), and never for body-weight exercises', () => {
    const twelve = recordList([set('h', '2026-04-01', { weight: 80, reps: 12 })], 'weight_reps')
    expect(twelve.find((r) => r.id === 'e1rm')).toBeUndefined()
    expect(twelve.find((r) => r.id === 'maxWeight')!.value).toBe(80)
    // Weighted pull-ups: +10 kg × 8. An "e1RM" of 12,7 kg would ignore the body mass.
    const bw = recordList([set('w', '2026-04-01', { weight: 10, reps: 8 })], 'bodyweight_reps')
    expect(bw.find((r) => r.id === 'e1rm')).toBeUndefined()
    expect(bw.map((r) => r.id)).toEqual(expect.arrayContaining(['maxWeight', 'volumeSet', 'maxReps']))
    expect(E1RM_NOTE).toMatch(/1 a 10 repeticiones/)
  })
  it('time and distance records', () => {
    const r = recordList([set('t', '2026-03-01', { durationSec: 60 }), set('t2', '2026-03-08', { durationSec: 75, distanceM: 400 })])
    expect(r.find((x) => x.id === 'maxDuration')).toMatchObject({ value: 75, date: '2026-03-08' })
    expect(r.find((x) => x.id === 'maxDistance')!.value).toBe(400)
  })
  it('best volume session', () => {
    expect(bestVolumeSession(sessionPoints(sets))).toMatchObject({ sessionId: 'b', value: 62.5 * 28 })
    expect(bestVolumeSession([])).toBeNull()
  })
})

describe('repRecords', () => {
  it('best weight per exact rep count, 10 or more grouped', () => {
    const rr = repRecords([
      set('a', '2026-01-01', { weight: 100, reps: 3 }),
      set('b', '2026-01-08', { weight: 105, reps: 3 }),
      set('c', '2026-01-15', { weight: 60, reps: 12 }),
      set('d', '2026-01-22', { weight: 55, reps: 15 }),
      set('e', '2026-01-29', { weight: 80, reps: 8, isWarmup: true }),
    ])
    expect(rr.map((r) => r.reps)).toEqual([3, 10])
    expect(rr[0]).toMatchObject({ weight: 105, date: '2026-01-08', orMore: false })
    expect(rr[1]).toMatchObject({ weight: 60, repsDone: 12, orMore: true })
  })
  it('is empty without weighted sets', () => {
    expect(repRecords([set('a', '2026-01-01', { reps: 12 })])).toEqual([])
  })
})
