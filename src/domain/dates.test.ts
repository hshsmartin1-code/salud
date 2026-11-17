import { describe, expect, it } from 'vitest';
import {
  APP_TZ,
  addDays,
  compareDates,
  dateRange,
  daysBetween,
  formatDateEs,
  isoWeekStart,
  isoWeekday,
  nowLocalTime,
  todayLocal,
} from './dates';

describe('dates', () => {
  it('todayLocal uses Bogotá time', () => {
    expect(APP_TZ).toBe('America/Bogota');
    expect(todayLocal(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-14');
    expect(todayLocal(new Date('2026-11-15T05:00:00Z'))).toBe('2026-11-15');
  });
  it('nowLocalTime', () => {
    expect(nowLocalTime(new Date('2026-11-15T03:05:00Z'))).toBe('22:05');
    expect(nowLocalTime(new Date('2026-11-15T05:00:00Z'))).toBe('00:00');
  });
  it('addDays / daysBetween across month, year and leap day', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-14', '2026-11-21')).toBe(7);
    expect(daysBetween('2026-11-21', '2026-11-14')).toBe(-7);
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
  });
  it('dateRange is inclusive', () => {
    expect(dateRange('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(dateRange('2026-11-14', '2026-11-14')).toEqual(['2026-11-14']);
    expect(dateRange('2026-11-15', '2026-11-14')).toEqual([]);
  });
  it('isoWeekStart returns Monday', () => {
    expect(isoWeekStart('2026-11-14')).toBe('2026-11-09'); // Saturday
    expect(isoWeekStart('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(isoWeekStart('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(isoWeekStart('2026-01-01')).toBe('2025-12-29');
  });
  it('compareDates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('formatDateEs', () => {
    expect(formatDateEs('2026-11-14')).toBe('14 nov 2026');
    expect(formatDateEs('2026-11-14', 'long')).toBe('sábado, 14 de noviembre de 2026');
    expect(formatDateEs('2026-11-14', 'weekday')).toBe('sáb 14 nov');
  });
});

describe('isoWeekday', () => {
  it('Monday is 1 and Sunday is 7, across week, month, year and leap boundaries', () => {
    expect(isoWeekday('2026-11-16')).toBe(1); // Monday
    expect(isoWeekday('2026-11-18')).toBe(3);
    expect(isoWeekday('2026-11-22')).toBe(7); // Sunday
    expect(isoWeekday('2026-11-23')).toBe(1);
    expect(isoWeekday('2026-12-31')).toBe(4);
    expect(isoWeekday('2027-01-01')).toBe(5);
    expect(isoWeekday('2028-02-29')).toBe(2); // leap day
  });
  it('does not depend on the process time zone (no date-only Date parsing)', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const tz = env.TZ;
    try {
      for (const z of ['America/Bogota', 'Pacific/Honolulu', 'Asia/Tokyo']) {
        env.TZ = z;
        expect(isoWeekday('2026-11-22')).toBe(7);
        expect(isoWeekday('2026-11-23')).toBe(1);
      }
    } finally {
      if (tz === undefined) delete env.TZ;
      else env.TZ = tz;
    }
  });
  it('rejects a malformed date instead of guessing', () => {
    expect(() => isoWeekday('hoy')).toThrow();
  });
});
