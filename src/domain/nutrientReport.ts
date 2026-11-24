import { NUTRIENT_CODES } from '../db/catalogTypes';
import type { NutrientCode, NutrientMap } from '../db/catalogTypes';
import type { MealKey } from '../db/types';
import { addDays, dateRange } from './dates';

/**
 * Nutrient intake of a day or a period. A nutrient with no known value in any entry is unknown (null), never zero.
 * Coverage = share of the logged energy that comes from entries that carry the nutrient, so partial data is visible.
 */

export interface ReportLog {
  date: string;
  meal: MealKey;
  nutrients: NutrientMap;
}
export interface ReportMark {
  date: string;
  complete: boolean;
}

export interface NutrientStat {
  /** Total of the day, or average per logged day over the days that have the nutrient. Null = no data at all. */
  value: number | null;
  /** 0..1: energy of the entries that carry the nutrient over the energy of all entries (period: summed over days). */
  coverage: number;
  /** Average per day of the energy (kcal) of the entries that carry the nutrient, over the same days as `value`. */
  coveredKcal: number;
  /** Days (of those included) in which at least one entry carries the nutrient. */
  daysWithData: number;
}

export interface MealShare {
  meal: MealKey;
  /** kcal per day (average over the included days). */
  kcal: number;
  /** Share of the logged energy, 0..100. */
  pct: number;
}

export interface NutrientReport {
  from: string;
  to: string;
  /** Days used in the figures, ascending. */
  days: string[];
  /** Days in the window with at least one entry. */
  loggedDays: number;
  /** Days left out of an average because they are marked incomplete. */
  excludedIncomplete: number;
  /** Day view only: the day is marked incomplete (it is shown anyway). */
  selectedIncomplete: boolean;
  entries: number;
  stats: Record<NutrientCode, NutrientStat>;
  meals: MealShare[];
  /** Entries without a known energy value (they cannot be placed in the energy distribution). */
  entriesWithoutKcal: number;
}

const known = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export type ReportPeriod = 'day' | '7d' | '30d';
export const PERIOD_DAYS: Record<ReportPeriod, number> = { day: 1, '7d': 7, '30d': 30 };

export function periodRange(date: string, period: ReportPeriod): { from: string; to: string } {
  return { from: addDays(date, -(PERIOD_DAYS[period] - 1)), to: date };
}

export function buildReport(
  logs: readonly ReportLog[],
  marks: readonly ReportMark[],
  from: string,
  to: string,
  opts: { excludeIncomplete: boolean },
): NutrientReport {
  const byDay = new Map<string, ReportLog[]>();
  for (const l of logs) {
    if (l.date < from || l.date > to) continue;
    const list = byDay.get(l.date);
    if (list) list.push(l);
    else byDay.set(l.date, [l]);
  }
  const incomplete = new Set(marks.filter((m) => m.complete === false).map((m) => m.date));
  const logged = dateRange(from, to).filter((d) => byDay.has(d));
  const days = opts.excludeIncomplete ? logged.filter((d) => !incomplete.has(d)) : logged;
  const excludedIncomplete = logged.length - days.length;

  const sum = {} as Record<NutrientCode, { total: number; covered: number; days: number }>;
  for (const c of NUTRIENT_CODES) sum[c] = { total: 0, covered: 0, days: 0 };
  let allKcal = 0;
  let entries = 0;
  let entriesWithoutKcal = 0;
  const mealKcal = new Map<MealKey, number>();

  for (const d of days) {
    for (const l of byDay.get(d)!) {
      entries++;
      const kcal = l.nutrients.kcal;
      if (known(kcal)) {
        allKcal += kcal;
        mealKcal.set(l.meal, (mealKcal.get(l.meal) ?? 0) + kcal);
      } else entriesWithoutKcal++;
    }
    for (const c of NUTRIENT_CODES) {
      let total = 0;
      let covered = 0;
      let any = false;
      for (const l of byDay.get(d)!) {
        const v = l.nutrients[c];
        if (!known(v)) continue;
        any = true;
        total += v;
        const kcal = l.nutrients.kcal;
        if (known(kcal)) covered += kcal;
      }
      if (any) {
        sum[c].total += total;
        sum[c].covered += covered;
        sum[c].days++;
      }
    }
  }

  const stats = {} as Record<NutrientCode, NutrientStat>;
  for (const c of NUTRIENT_CODES) {
    const s = sum[c];
    const entriesWith = days.reduce((n, d) => n + byDay.get(d)!.filter((l) => known(l.nutrients[c])).length, 0);
    stats[c] = {
      value: s.days > 0 ? s.total / s.days : null,
      coverage: c === 'kcal' ? (entries > 0 ? entriesWith / entries : 0) : allKcal > 0 ? s.covered / allKcal : s.days > 0 ? 1 : 0,
      coveredKcal: s.days > 0 ? s.covered / s.days : 0,
      daysWithData: s.days,
    };
  }
  // Energy per entry that has it, so the distribution by meal sums to the logged energy.
  const nDays = Math.max(days.length, 1);
  const total = [...mealKcal.values()].reduce((a, b) => a + b, 0);
  const meals: MealShare[] = [...mealKcal.entries()].map(([meal, kcal]) => ({
    meal,
    kcal: kcal / nDays,
    pct: total > 0 ? (kcal / total) * 100 : 0,
  }));

  return {
    from,
    to,
    days,
    loggedDays: logged.length,
    excludedIncomplete,
    selectedIncomplete: !opts.excludeIncomplete && logged.some((d) => incomplete.has(d)),
    entries,
    stats,
    meals,
    entriesWithoutKcal,
  };
}

/** Energy from a nutrient in kcal per gram (Atwater general factors; alcohol and fiber adjustments ignored). */
export const KCAL_PER_G: Partial<Record<NutrientCode, number>> = { protein: 4, carbs: 4, fat: 9, satFat: 9, addedSugars: 4 };

/**
 * Percent of energy supplied by a nutrient, over the energy of the entries that carry it (so partial data does not
 * bias the share). Null when it cannot be computed.
 */
export function energyPercent(code: NutrientCode, stat: NutrientStat): number | null {
  const k = KCAL_PER_G[code];
  if (k === undefined || stat.value === null || stat.coveredKcal <= 0) return null;
  return ((stat.value * k) / stat.coveredKcal) * 100;
}
