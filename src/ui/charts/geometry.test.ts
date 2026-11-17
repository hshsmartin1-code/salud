import { describe, expect, it } from 'vitest'
import {
  addDays,
  aggregate,
  barPath,
  coverage,
  defaultFormat,
  fmtNumber,
  panelValueText,
  repsUnit,
  isoWeekStart,
  linePath,
  nearestIndex,
  nearestPoint,
  previousRange,
  shiftToPeriod,
  shortDate,
  timeScale,
  xTickIndices,
  yDomain,
} from './geometry'

describe('timeScale', () => {
  const s = timeScale('2026-03-01', '2026-03-10', 0, 100)
  it('gives every calendar day an equal slot, with or without data', () => {
    expect(s.days).toBe(10)
    expect(s.slot).toBe(10)
    expect(s.x('2026-03-01')).toBe(5)
    expect(s.x('2026-03-02') - s.x('2026-03-01')).toBe(10)
    expect(s.x('2026-03-10')).toBe(95)
  })
  it('is calendar-true across month ends and leap day', () => {
    const t = timeScale('2028-02-27', '2028-03-02', 0, 50)
    expect(t.days).toBe(5)
    expect(t.x('2028-02-29')).toBe(25)
    expect(t.dateAt(2)).toBe('2028-02-29')
  })
  it('maps a pixel back to a clamped day index', () => {
    expect(s.indexAt(-20)).toBe(0)
    expect(s.indexAt(34)).toBe(3)
    expect(s.indexAt(500)).toBe(9)
  })
})

describe('yDomain', () => {
  it('returns at most 4 nice ticks covering the data', () => {
    for (const [lo, hi] of [[71.2, 74.9], [0, 12000], [48, 63], [0.2, 0.9], [118, 142], [3.1, 3.2]]) {
      const d = yDomain([lo!, hi!])
      expect(d.ticks.length).toBeLessThanOrEqual(4)
      expect(d.min).toBeLessThanOrEqual(lo!)
      expect(d.max).toBeGreaterThanOrEqual(hi!)
      expect(d.ticks[0]).toBe(d.min)
      expect(d.ticks.at(-1)).toBe(d.max)
    }
  })
  it('uses round steps', () => {
    expect(yDomain([0, 9500], { zero: true }).ticks).toEqual([0, 5000, 10000])
    expect(yDomain([71.2, 74.9]).ticks).toEqual([70, 72, 74, 76])
  })
  it('forces a zero baseline for bars', () => {
    const d = yDomain([5200, 9100], { zero: true })
    expect(d.min).toBe(0)
    expect(yDomain([5200, 9100]).min).toBeGreaterThan(0)
  })
  it('survives a flat or empty series', () => {
    expect(yDomain([7, 7]).max).toBeGreaterThan(yDomain([7, 7]).min)
    expect(yDomain([]).ticks.length).toBeGreaterThan(1)
  })
})

describe('linePath', () => {
  const x = (d: string) => Number(d.slice(8))
  const y = (v: number) => v
  const pts = (arr: [string, number | null][]) => arr.map(([date, value]) => ({ date, value }))
  it('connects consecutive days', () => {
    expect(linePath(pts([['2026-03-01', 1], ['2026-03-02', 2]]), x, y)).toBe('M1 1L2 2')
  })
  it('bridges up to maxGapDays (default 3) and breaks beyond', () => {
    const near = linePath(pts([['2026-03-01', 1], ['2026-03-04', 2]]), x, y)
    expect(near).toBe('M1 1L4 2')
    const far = linePath(pts([['2026-03-01', 1], ['2026-03-02', 1], ['2026-03-06', 2], ['2026-03-07', 3]]), x, y)
    expect(far).toBe('M1 1L2 1M6 2L7 3')
  })
  it('honours a custom maxGapDays', () => {
    const d = pts([['2026-03-01', 1], ['2026-03-03', 2]])
    expect(linePath(d, x, y, 1)).toBe('')
    expect(linePath(d, x, y, 2)).toBe('M1 1L3 2')
  })
  it('never bridges null', () => {
    const d = pts([['2026-03-01', 1], ['2026-03-02', null], ['2026-03-03', 2], ['2026-03-04', 3]])
    expect(linePath(d, x, y)).toBe('M3 2L4 3')
  })
  it('draws nothing for lone points', () => {
    expect(linePath(pts([['2026-03-01', 1]]), x, y)).toBe('')
  })
})

describe('barPath', () => {
  it('is anchored at the baseline with a rounded top', () => {
    const p = barPath(10, 8, 100, 40)
    expect(p.startsWith('M10 100V44')).toBe(true)
    expect(p.endsWith('V100Z')).toBe(true)
  })
  it('is empty for zero height', () => {
    expect(barPath(0, 5, 10, 10)).toBe('')
  })
})

describe('nearest', () => {
  it('finds the closest x', () => {
    const xs = [10, 20, 40, 80]
    expect(nearestIndex(xs, 0)).toBe(0)
    expect(nearestIndex(xs, 14)).toBe(0)
    expect(nearestIndex(xs, 16)).toBe(1)
    expect(nearestIndex(xs, 31)).toBe(2)
    expect(nearestIndex(xs, 200)).toBe(3)
    expect(nearestIndex([], 5)).toBe(-1)
  })
  it('skips null points', () => {
    const p = [
      { date: '2026-03-01', value: 1 },
      { date: '2026-03-02', value: null },
      { date: '2026-03-03', value: 3 },
    ]
    const x = (d: string) => Number(d.slice(8)) * 10
    expect(nearestPoint(p, x, 21)?.date).toBe('2026-03-03')
    expect(nearestPoint([], x, 1)).toBeNull()
  })
})

describe('coverage', () => {
  it('counts distinct days with data inside the range', () => {
    const p = [
      { date: '2026-02-28', value: 1 },
      { date: '2026-03-01', value: 1 },
      { date: '2026-03-01', value: 2 },
      { date: '2026-03-02', value: null },
      { date: '2026-03-05', value: 3 },
    ]
    expect(coverage(p, '2026-03-01', '2026-03-10')).toEqual({ daysWithData: 2, totalDays: 10 })
  })
})

describe('aggregate', () => {
  const pts = [
    { date: '2026-03-02', value: 10 }, // Monday
    { date: '2026-03-04', value: 20 },
    { date: '2026-03-08', value: 30 }, // Sunday, same ISO week
    { date: '2026-03-09', value: 40 }, // next Monday
    { date: '2026-03-10', value: null },
  ]
  it('bins by ISO week (Monday) with mean and count', () => {
    expect(aggregate(pts, 'week', 'mean')).toEqual([
      { date: '2026-03-02', value: 20, count: 3 },
      { date: '2026-03-09', value: 40, count: 1 },
    ])
  })
  it('sums by month', () => {
    const m = aggregate([...pts, { date: '2026-04-01', value: 5 }], 'month', 'sum')
    expect(m).toEqual([
      { date: '2026-03-01', value: 100, count: 4 },
      { date: '2026-04-01', value: 5, count: 1 },
    ])
  })
  it('isoWeekStart handles Sunday and year change', () => {
    expect(isoWeekStart('2026-03-08')).toBe('2026-03-02')
    expect(isoWeekStart('2027-01-01')).toBe('2026-12-28')
  })
})

describe('previous period', () => {
  it('computes the equal-length range before', () => {
    expect(previousRange('2026-03-01', '2026-03-30')).toEqual({ from: '2026-01-30', to: '2026-02-28' })
  })
  it('shifts onto the current axis', () => {
    const shifted = shiftToPeriod([{ date: '2026-01-30', value: 1 }, { date: '2026-02-28', value: 2 }], '2026-01-30', '2026-03-01')
    expect(shifted.map((p) => p.date)).toEqual(['2026-03-01', '2026-03-30'])
  })
  it('addDays crosses months', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('formatting', () => {
  it('uses es-CO separators', () => {
    expect(fmtNumber(1234.5)).toBe('1.234,5')
    expect(fmtNumber(10000, 0)).toBe('10.000')
    expect(defaultFormat(72.44, 'kg')).toBe('72,4 kg')
    expect(defaultFormat(7412, 'pasos')).toBe('7.412 pasos')
  })
  it('panel header formats numbers the Spanish way', () => {
    expect(panelValueText(96.2)).toBe('96,2')
    expect(panelValueText(2516)).toBe('2.516')
    expect(panelValueText(74)).toBe('74')
    expect(panelValueText('12,5')).toBe('12,5')
    expect(panelValueText(null)).toBe('—')
    expect(panelValueText(Number.NaN)).toBe('—')
    expect(repsUnit(1, 'reps')).toBe('rep')
    expect(repsUnit(-1, 'reps')).toBe('rep')
    expect(repsUnit(3, 'reps')).toBe('reps')
    expect(repsUnit(1, 'kg')).toBe('kg')
  })
  it('tick decimals follow the step', async () => {
    const { tickDecimals } = await import('./geometry')
    expect([tickDecimals(5000), tickDecimals(2.5), tickDecimals(0.5), tickDecimals(0.25)]).toEqual([0, 1, 1, 2])
  })
  it('short dates are Spanish', () => {
    expect(shortDate('2026-03-05')).toBe('5 mar')
    expect(shortDate('2026-12-31')).toBe('31 dic')
  })
  it('x ticks include both ends and at most 4', () => {
    expect(xTickIndices(90)).toEqual([0, 30, 59, 89])
    expect(xTickIndices(2)).toEqual([0, 1])
    expect(xTickIndices(1)).toEqual([0])
  })
})
