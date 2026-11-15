import { dayNumber, isoWeekStart } from './dates';

export type DatedPoint = { date: string; value: number };

function byDate<T extends { date: string }>(points: T[]): T[] {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Calendar-based moving average: mean of all points with date in [date − (windowDays−1), date]. */
export function movingAverage(
  points: DatedPoint[],
  windowDays = 7,
): { date: string; value: number; avg: number; n: number }[] {
  const sorted = byDate(points).map((p) => ({ ...p, day: dayNumber(p.date) }));
  const out: { date: string; value: number; avg: number; n: number }[] = [];
  let lo = 0;
  let sum = 0;
  // sliding window over sorted points; window = points with day > cur.day − windowDays
  let hi = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    // include every point with the same day as cur (they sort adjacent, may come after i)
    while (hi < sorted.length && sorted[hi]!.day <= cur.day) {
      sum += sorted[hi]!.value;
      hi++;
    }
    while (lo < hi && sorted[lo]!.day <= cur.day - windowDays) {
      sum -= sorted[lo]!.value;
      lo++;
    }
    const n = hi - lo;
    out.push({ date: cur.date, value: cur.value, avg: n > 0 ? sum / n : cur.value, n });
  }
  return out;
}

/** One point per date (mean of that day's values), ascending. */
export function dailyMean(points: DatedPoint[]): DatedPoint[] {
  const m = new Map<string, { s: number; n: number }>();
  for (const p of points) {
    const e = m.get(p.date) ?? { s: 0, n: 0 };
    e.s += p.value;
    e.n++;
    m.set(p.date, e);
  }
  return byDate([...m.entries()].map(([date, e]) => ({ date, value: e.s / e.n })));
}

/** Mean per ISO week (Monday start) of all points; n = number of points. */
export function weeklyMeans(points: DatedPoint[]): { weekStart: string; mean: number; n: number }[] {
  const m = new Map<string, { s: number; n: number }>();
  for (const p of points) {
    const w = isoWeekStart(p.date);
    const e = m.get(w) ?? { s: 0, n: 0 };
    e.s += p.value;
    e.n++;
    m.set(w, e);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, e]) => ({ weekStart, mean: e.s / e.n, n: e.n }));
}

/** Least-squares slope in units per week; null with fewer than 2 distinct dates. */
export function linearTrendPerWeek(points: DatedPoint[]): number | null {
  if (new Set(points.map((p) => p.date)).size < 2) return null;
  const xs = points.map((p) => dayNumber(p.date));
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (points[i]!.value - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  return (sxy / sxx) * 7;
}

export function summarize(values: number[]): { n: number; mean: number; min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let s = 0;
  for (const v of values) {
    s += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { n: values.length, mean: s / values.length, min, max };
}
