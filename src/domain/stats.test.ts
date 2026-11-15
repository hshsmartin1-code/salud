import { describe, expect, it } from 'vitest';
import { dailyMean, linearTrendPerWeek, movingAverage, summarize, weeklyMeans } from './stats';

describe('movingAverage', () => {
  it('is calendar based, handles gaps and unsorted input', () => {
    const r = movingAverage(
      [
        { date: '2026-11-10', value: 70 },
        { date: '2026-11-01', value: 80 },
        { date: '2026-11-02', value: 78 },
        { date: '2026-11-08', value: 76 },
      ],
      7,
    );
    expect(r.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-10']);
    expect(r[0]).toMatchObject({ avg: 80, n: 1 });
    expect(r[1]).toMatchObject({ avg: 79, n: 2 });
    // window for 11-08 = 11-02..11-08 → 78 and 76
    expect(r[2]).toMatchObject({ avg: 77, n: 2 });
    // window for 11-10 = 11-04..11-10 → 76 and 70
    expect(r[3]).toMatchObject({ avg: 73, n: 2 });
  });
  it('multiple values per date: one output per input point', () => {
    const r = movingAverage([
      { date: '2026-11-01', value: 10 },
      { date: '2026-11-01', value: 20 },
      { date: '2026-11-02', value: 30 },
    ]);
    expect(r).toHaveLength(3);
    expect(r[0]!.avg).toBe(15);
    expect(r[1]!.avg).toBe(15);
    expect(r[2]!.avg).toBe(20);
    expect(r[2]!.n).toBe(3);
  });
  it('window of 1 day = same-day mean; empty input', () => {
    expect(movingAverage([{ date: '2026-11-01', value: 5 }, { date: '2026-11-02', value: 7 }], 1).map((x) => x.avg)).toEqual([5, 7]);
    expect(movingAverage([])).toEqual([]);
  });
  it('handles month boundary', () => {
    const r = movingAverage([{ date: '2026-10-31', value: 10 }, { date: '2026-11-02', value: 20 }], 3);
    expect(r[1]!.avg).toBe(15);
  });
});

describe('dailyMean / weeklyMeans', () => {
  it('dailyMean', () => {
    expect(dailyMean([{ date: '2026-11-02', value: 3 }, { date: '2026-11-01', value: 1 }, { date: '2026-11-01', value: 3 }])).toEqual([
      { date: '2026-11-01', value: 2 },
      { date: '2026-11-02', value: 3 },
    ]);
  });
  it('weeklyMeans uses Monday starts', () => {
    const r = weeklyMeans([
      { date: '2026-11-09', value: 10 },
      { date: '2026-11-15', value: 20 },
      { date: '2026-11-16', value: 30 },
    ]);
    expect(r).toEqual([
      { weekStart: '2026-11-09', mean: 15, n: 2 },
      { weekStart: '2026-11-16', mean: 30, n: 1 },
    ]);
  });
});

describe('linearTrendPerWeek', () => {
  it('exact line: −0.5 kg per week', () => {
    const pts = [0, 7, 14, 21].map((d, i) => ({ date: `2026-11-${String(1 + d).padStart(2, '0')}`, value: 80 - 0.5 * i }));
    expect(linearTrendPerWeek(pts)).toBeCloseTo(-0.5, 9);
  });
  it('null with fewer than 2 distinct dates', () => {
    expect(linearTrendPerWeek([])).toBeNull();
    expect(linearTrendPerWeek([{ date: '2026-11-01', value: 1 }])).toBeNull();
    expect(linearTrendPerWeek([{ date: '2026-11-01', value: 1 }, { date: '2026-11-01', value: 2 }])).toBeNull();
  });
  it('flat → 0', () => {
    expect(linearTrendPerWeek([{ date: '2026-11-01', value: 5 }, { date: '2026-11-04', value: 5 }])).toBeCloseTo(0);
  });
});

describe('summarize', () => {
  it('stats', () => {
    expect(summarize([1, 2, 3, 6])).toEqual({ n: 4, mean: 3, min: 1, max: 6 });
    expect(summarize([])).toBeNull();
  });
});
