import { describe, expect, it } from 'vitest';
import type { NutrientMap } from '../db/catalogTypes';
import type { MealKey } from '../db/types';
import { buildReport, energyPercent, periodRange, type ReportLog } from './nutrientReport';

const log = (date: string, meal: MealKey, nutrients: NutrientMap): ReportLog => ({ date, meal, nutrients });

describe('coverage and unknown values', () => {
  const logs = [
    log('2026-11-24', 'desayuno', { kcal: 300, iron: 3, protein: 10 }),
    log('2026-11-24', 'almuerzo', { kcal: 700, protein: 30 }), // no iron: unknown, not zero
  ];
  const r = buildReport(logs, [], '2026-11-24', '2026-11-24', { excludeIncomplete: false });

  it('sums known values and reports coverage by energy', () => {
    expect(r.stats.iron.value).toBe(3);
    expect(r.stats.iron.coverage).toBeCloseTo(0.3, 5);
    expect(r.stats.protein.value).toBe(40);
    expect(r.stats.protein.coverage).toBe(1);
  });

  it('a nutrient that no entry carries is null, with no coverage', () => {
    expect(r.stats.vitD.value).toBeNull();
    expect(r.stats.vitD.coverage).toBe(0);
    expect(r.stats.vitD.daysWithData).toBe(0);
  });

  it('a known zero stays zero', () => {
    const z = buildReport([log('2026-11-24', 'cena', { kcal: 100, transFat: 0 })], [], '2026-11-24', '2026-11-24', { excludeIncomplete: false });
    expect(z.stats.transFat.value).toBe(0);
  });

  it('percent of energy uses the energy of the entries that carry the nutrient', () => {
    // 10 g protein in a 300 kcal entry and 30 g in a 700 kcal entry: 160 kcal / 1000 kcal = 16 %.
    expect(energyPercent('protein', r.stats.protein)).toBeCloseTo(16, 5);
    // Iron has no kcal factor.
    expect(energyPercent('iron', r.stats.iron)).toBeNull();
    // satFat only in the 300 kcal entry: 5 g * 9 / 300 = 15 %, not 4.5 %.
    const s = buildReport([log('2026-11-24', 'cena', { kcal: 300, satFat: 5 }), log('2026-11-24', 'otro', { kcal: 700 })], [], '2026-11-24', '2026-11-24', { excludeIncomplete: false });
    expect(energyPercent('satFat', s.stats.satFat)).toBeCloseTo(15, 5);
    expect(s.stats.satFat.coverage).toBeCloseTo(0.3, 5);
  });
});

describe('periods', () => {
  it('computes the window ending at the selected date', () => {
    expect(periodRange('2026-11-24', 'day')).toEqual({ from: '2026-11-24', to: '2026-11-24' });
    expect(periodRange('2026-11-24', '7d')).toEqual({ from: '2026-11-18', to: '2026-11-24' });
    expect(periodRange('2026-11-24', '30d')).toEqual({ from: '2026-10-26', to: '2026-11-24' });
  });

  const logs = [
    log('2026-11-20', 'almuerzo', { kcal: 2000, protein: 100 }),
    log('2026-11-22', 'almuerzo', { kcal: 1000, protein: 40 }),
    log('2026-11-23', 'almuerzo', { kcal: 500, protein: 10 }), // marked incomplete
    log('2026-11-10', 'almuerzo', { kcal: 9999, protein: 999 }), // outside the 7 d window
  ];
  const marks = [{ date: '2026-11-23', complete: false }, { date: '2026-11-20', complete: true }];

  it('averages over logged days only and excludes incomplete days, saying how many', () => {
    const r = buildReport(logs, marks, '2026-11-18', '2026-11-24', { excludeIncomplete: true });
    expect(r.days).toEqual(['2026-11-20', '2026-11-22']);
    expect(r.loggedDays).toBe(3);
    expect(r.excludedIncomplete).toBe(1);
    expect(r.stats.kcal.value).toBe(1500);
    expect(r.stats.protein.value).toBe(70);
  });

  it('the day view keeps an incomplete day and flags it', () => {
    const r = buildReport(logs, marks, '2026-11-23', '2026-11-23', { excludeIncomplete: false });
    expect(r.days).toEqual(['2026-11-23']);
    expect(r.excludedIncomplete).toBe(0);
    expect(r.selectedIncomplete).toBe(true);
  });

  it('averages a nutrient over the days that have it, not over every logged day', () => {
    const r = buildReport(
      [log('2026-11-22', 'cena', { kcal: 500, zinc: 6 }), log('2026-11-23', 'cena', { kcal: 500 })],
      [],
      '2026-11-18',
      '2026-11-24',
      { excludeIncomplete: true },
    );
    expect(r.stats.zinc.value).toBe(6);
    expect(r.stats.zinc.daysWithData).toBe(1);
    expect(r.stats.zinc.coverage).toBeCloseTo(0.5, 5);
  });

  it('an empty window has no days and unknown stats', () => {
    const r = buildReport([], [], '2026-11-18', '2026-11-24', { excludeIncomplete: true });
    expect(r.days).toEqual([]);
    expect(r.stats.kcal.value).toBeNull();
  });
});

describe('energy by meal', () => {
  it('splits kcal per meal, as a daily average with its share', () => {
    const r = buildReport(
      [
        log('2026-11-23', 'desayuno', { kcal: 400 }),
        log('2026-11-23', 'almuerzo', { kcal: 600 }),
        log('2026-11-24', 'desayuno', { kcal: 200 }),
        log('2026-11-24', 'almuerzo', { kcal: 800 }),
        log('2026-11-24', 'cena', { protein: 5 }), // no kcal: left out of the split
      ],
      [],
      '2026-11-18',
      '2026-11-24',
      { excludeIncomplete: true },
    );
    const by = Object.fromEntries(r.meals.map((m) => [m.meal, m]));
    expect(by.desayuno!.kcal).toBe(300);
    expect(by.desayuno!.pct).toBeCloseTo(30, 5);
    expect(by.almuerzo!.kcal).toBe(700);
    expect(by.almuerzo!.pct).toBeCloseTo(70, 5);
    expect(by.cena).toBeUndefined();
    expect(r.entriesWithoutKcal).toBe(1);
  });
});
