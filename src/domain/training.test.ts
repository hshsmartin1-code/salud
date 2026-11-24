import { describe, expect, it } from 'vitest';
import {
  bestSet,
  brzycki,
  detectPRs,
  E1RM_MAX_REPS,
  e1rm,
  e1rmApplies,
  setStrengthScore,
  epley,
  previousPerformance,
  sessionVolume,
  setVolume,
  weeklyVolume,
} from './training';
import type { SetLike } from './training';

const S = (weight: number | null, reps: number | null, date = '2026-11-01', sessionId = 's1', extra: Partial<SetLike> = {}): SetLike => ({
  weight,
  reps,
  date,
  sessionId,
  ...extra,
});

describe('1RM formulas', () => {
  it('epley / brzycki', () => {
    expect(epley(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley(100, 1)).toBe(100);
    expect(brzycki(100, 5)).toBeCloseTo(112.5, 6);
  });
  it('e1rm validity', () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.667, 3);
    expect(e1rm(100, 5, 'brzycki')).toBeCloseTo(112.5, 6);
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
    // Linear equations are only valid up to 10 reps (Reynolds, Gordon & Robergs 2006; Brzycki 1993).
    expect(E1RM_MAX_REPS).toBe(10);
    expect(e1rm(100, 10)).toBeCloseTo(133.333, 3);
    expect(e1rm(100, 11)).toBeNull();
    expect(e1rm(100, 15)).toBeNull();
    expect(e1rm(100, 16)).toBeNull();
  });
});

describe('volume', () => {
  it('setVolume', () => {
    expect(setVolume(S(60, 10))).toBe(600);
    expect(setVolume(S(null, 10))).toBe(0);
    expect(setVolume(S(60, null))).toBe(0);
    expect(setVolume(S(60, 10, 'd', 's', { isWarmup: true }))).toBe(0);
  });
  it('sessionVolume', () => {
    expect(sessionVolume([S(60, 10), S(70, 8), S(40, 10, 'd', 's', { isWarmup: true })])).toBe(1160);
    expect(sessionVolume([])).toBe(0);
  });
  it('weeklyVolume groups by ISO week', () => {
    const r = weeklyVolume([
      S(10, 10, '2026-11-09'), // Monday
      S(10, 10, '2026-11-15'), // Sunday, same week
      S(20, 5, '2026-11-16'), // next Monday
      S(20, 5, '2026-11-02'),
    ]);
    expect(r).toEqual([
      { weekStart: '2026-11-02', volume: 100 },
      { weekStart: '2026-11-09', volume: 200 },
      { weekStart: '2026-11-16', volume: 100 },
    ]);
  });
});

describe('detectPRs', () => {
  const history = [S(100, 5), S(90, 8), S(60, 10, '2026-11-01', 's1', { isWarmup: true })];

  it('first time is not a PR', () => {
    expect(detectPRs([], S(100, 5))).toEqual([]);
    expect(detectPRs([S(200, 20, 'd', 's', { isWarmup: true })], S(100, 5))).toEqual([]);
  });
  it('heavier weight', () => {
    const prs = detectPRs(history, S(105, 3));
    expect(prs).toContain('max_weight');
    expect(prs).not.toContain('max_reps_at_weight'); // nothing done at ≥105
  });
  it('more reps at same weight', () => {
    const prs = detectPRs(history, S(100, 6));
    expect(prs).toContain('max_reps_at_weight');
    expect(prs).toContain('max_e1rm');
    expect(prs).not.toContain('max_weight');
  });
  it('reps at lower weight compares against sets at ≥ weight', () => {
    // 90×8 exists; 80×8 is not more reps than 90×8
    expect(detectPRs(history, S(80, 8))).not.toContain('max_reps_at_weight');
    expect(detectPRs(history, S(80, 9))).toContain('max_reps_at_weight');
  });
  it('equal performance is not a PR', () => {
    expect(detectPRs(history, S(100, 5))).toEqual([]);
  });
  it('warm-up candidate is never a PR; warm-up history ignored', () => {
    expect(detectPRs(history, S(500, 5, 'd', 's', { isWarmup: true }))).toEqual([]);
    expect(detectPRs([S(50, 5), S(500, 5, 'd', 's', { isWarmup: true })], S(60, 5))).toContain('max_weight');
  });
  it('excludes the candidate itself', () => {
    const cand = S(120, 5);
    expect(detectPRs([...history, cand], cand)).toContain('max_weight');
  });
  it('no e1RM record above 10 reps (outside the validity of linear equations)', () => {
    // 95×12 would be an Epley "e1RM" of 133 (> 116.7 of 100×5), but 12 reps is outside the valid range.
    expect(detectPRs(history, S(95, 12))).not.toContain('max_e1rm');
    expect(detectPRs(history, S(95, 10))).toContain('max_e1rm'); // 126.7 > 116.7
  });
  it('e1rm: false (body-weight exercises) never yields an e1RM record from the added load', () => {
    const h = [S(10, 8), S(10, 6)];
    expect(detectPRs(h, S(15, 8))).toContain('max_e1rm');
    const bw = detectPRs(h, S(15, 8), { e1rm: false });
    expect(bw).not.toContain('max_e1rm');
    expect(bw).toContain('max_weight'); // other records are unchanged
    expect(e1rmApplies('bodyweight_reps')).toBe(false);
    expect(e1rmApplies('weight_reps')).toBe(true);
  });
  it('duration and distance', () => {
    const h: SetLike[] = [{ durationSec: 60, distanceM: 200, date: 'd', sessionId: 's' }];
    expect(detectPRs(h, { durationSec: 90, date: 'd2', sessionId: 't' })).toEqual(['max_duration']);
    expect(detectPRs(h, { distanceM: 250, date: 'd2', sessionId: 't' })).toEqual(['max_distance']);
    expect(detectPRs(h, { durationSec: 50, distanceM: 100, date: 'd2', sessionId: 't' })).toEqual([]);
  });
});

describe('bestSet', () => {
  it('highest e1RM, ignoring warm-ups', () => {
    const best = bestSet([S(100, 5), S(110, 3), S(200, 1, 'd', 's', { isWarmup: true })]);
    expect(best).toEqual(S(110, 3)); // e1RM 121 vs 116.7
  });
  it('picks 110x3 when higher', () => {
    expect(bestSet([S(100, 5), S(110, 4)])).toEqual(S(110, 4));
  });
  it('fallback to reps / duration', () => {
    const a: SetLike = { reps: 10, date: 'd', sessionId: 's' };
    const b: SetLike = { reps: 12, date: 'd', sessionId: 's' };
    expect(bestSet([a, b])).toBe(b);
    const c: SetLike = { durationSec: 30, date: 'd', sessionId: 's' };
    const d: SetLike = { durationSec: 45, date: 'd', sessionId: 's' };
    expect(bestSet([c, d])).toBe(d);
  });
  it('still ranks sets of 11–15 reps by load (ordering score, not an e1RM)', () => {
    expect(bestSet([S(60, 12), S(70, 12)])).toEqual(S(70, 12));
    expect(setStrengthScore(70, 12)).toBeCloseTo(98, 6);
    expect(setStrengthScore(70, 16)).toBeNull();
    expect(e1rm(70, 12)).toBeNull();
  });
  it('empty → null', () => {
    expect(bestSet([])).toBeNull();
    expect(bestSet([S(50, 5, 'd', 's', { isWarmup: true })])).toBeNull();
  });
});

describe('previousPerformance', () => {
  const sets = [
    S(50, 10, '2026-11-01', 'a'),
    S(60, 8, '2026-11-05', 'b'),
    S(65, 6, '2026-11-05', 'b'),
    S(70, 5, '2026-11-08', 'c'),
  ];
  it('most recent session strictly before date', () => {
    const r = previousPerformance(sets, '2026-11-08');
    expect(r?.sessionId).toBe('b');
    expect(r?.sets).toEqual([sets[1], sets[2]]);
  });
  it('none before', () => {
    expect(previousPerformance(sets, '2026-11-01')).toBeNull();
  });
  it('same date allowed only with different excluded session', () => {
    expect(previousPerformance(sets, '2026-11-08', 'c')?.sessionId).toBe('b');
    expect(previousPerformance(sets, '2026-11-08', 'x')?.sessionId).toBe('c');
  });
  it('two sessions same day keeps original order', () => {
    const two = [S(1, 1, '2026-11-05', 'x'), S(2, 2, '2026-11-05', 'y')];
    const r = previousPerformance(two, '2026-11-05', 'y');
    expect(r?.sessionId).toBe('x');
  });
});
