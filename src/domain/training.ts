import { isoWeekStart } from './dates';
import { isWarmupSet } from './setKind';

export type SetLike = {
  weight?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  isWarmup?: boolean;
  /** V3 set type; read only through setKind()/isWarmupSet(). */
  kind?: string | null;
  date: string;
  sessionId: string;
};

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Epley: w·(1 + reps/30). reps = 1 → w. */
export function epley(weight: number, reps: number): number {
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Brzycki: w·36/(37 − reps). */
export function brzycki(weight: number, reps: number): number {
  return (weight * 36) / (37 - reps);
}

/** Estimated 1RM; null if not meaningful (weight ≤ 0, reps < 1 or > 15). */
export function e1rm(weight: number, reps: number, formula: 'epley' | 'brzycki' = 'epley'): number | null {
  if (!num(weight) || !num(reps) || weight <= 0 || reps < 1 || reps > 15) return null;
  return formula === 'epley' ? epley(weight, reps) : brzycki(weight, reps);
}

/** weight × reps; 0 if either is missing; warm-ups count 0 (drop and failure sets count). */
export function setVolume(s: SetLike): number {
  if (isWarmupSet(s)) return 0;
  if (!num(s.weight) || !num(s.reps)) return 0;
  return s.weight * s.reps;
}

export function sessionVolume(sets: SetLike[]): number {
  return sets.reduce((a, s) => a + setVolume(s), 0);
}

export type PRType =
  | 'max_weight'
  | 'max_e1rm'
  | 'max_reps_at_weight'
  | 'max_volume_set'
  | 'max_duration'
  | 'max_distance';

function setE1rm(s: SetLike): number | null {
  return num(s.weight) && num(s.reps) ? e1rm(s.weight, s.reps) : null;
}

/**
 * Compare `candidate` to non-warm-up history (the candidate object itself is excluded).
 * Design choice: with no prior (non-warm-up) history the first performance is NOT a PR (returns []);
 * likewise each metric needs at least one prior value to beat.
 * max_reps_at_weight = more reps than any previous set done at >= the same weight.
 */
export function detectPRs(history: SetLike[], candidate: SetLike): PRType[] {
  if (isWarmupSet(candidate)) return [];
  const prior = history.filter((h) => h !== candidate && !isWarmupSet(h));
  if (prior.length === 0) return [];
  const prs: PRType[] = [];

  if (num(candidate.weight) && candidate.weight > 0) {
    const ws = prior.filter((h) => num(h.weight) && h.weight > 0).map((h) => h.weight as number);
    if (ws.length > 0 && candidate.weight > Math.max(...ws)) prs.push('max_weight');
  }

  const ce = setE1rm(candidate);
  if (ce !== null) {
    const es = prior.map(setE1rm).filter((v): v is number => v !== null);
    if (es.length > 0 && ce > Math.max(...es) + 1e-9) prs.push('max_e1rm');
  }

  if (num(candidate.weight) && candidate.weight > 0 && num(candidate.reps) && candidate.reps > 0) {
    const same = prior.filter((h) => num(h.weight) && h.weight >= (candidate.weight as number) && num(h.reps));
    if (same.length > 0 && candidate.reps > Math.max(...same.map((h) => h.reps as number))) prs.push('max_reps_at_weight');
  }

  const cv = num(candidate.weight) && num(candidate.reps) ? candidate.weight * candidate.reps : 0;
  if (cv > 0) {
    const vs = prior.map((h) => (num(h.weight) && num(h.reps) ? h.weight * h.reps : 0)).filter((v) => v > 0);
    if (vs.length > 0 && cv > Math.max(...vs)) prs.push('max_volume_set');
  }

  if (num(candidate.durationSec) && candidate.durationSec > 0) {
    const ds = prior.filter((h) => num(h.durationSec) && h.durationSec > 0).map((h) => h.durationSec as number);
    if (ds.length > 0 && candidate.durationSec > Math.max(...ds)) prs.push('max_duration');
  }

  if (num(candidate.distanceM) && candidate.distanceM > 0) {
    const ds = prior.filter((h) => num(h.distanceM) && h.distanceM > 0).map((h) => h.distanceM as number);
    if (ds.length > 0 && candidate.distanceM > Math.max(...ds)) prs.push('max_distance');
  }

  return prs;
}

/** Highest e1RM among non-warm-up sets; fallback to most reps, then longest duration. */
export function bestSet(sets: SetLike[]): SetLike | null {
  const work = sets.filter((s) => !isWarmupSet(s));
  if (work.length === 0) return null;
  let best: SetLike | null = null;
  let bestE = -Infinity;
  for (const s of work) {
    const e = setE1rm(s);
    if (e !== null && e > bestE) {
      bestE = e;
      best = s;
    }
  }
  if (best) return best;
  return work.reduce((a, b) => {
    const ra = a.reps ?? 0;
    const rb = b.reps ?? 0;
    if (rb !== ra) return rb > ra ? b : a;
    return (b.durationSec ?? 0) > (a.durationSec ?? 0) ? b : a;
  });
}

/**
 * Most recent session whose date < beforeDate, or date == beforeDate with a different sessionId
 * than excludeSessionId. Sets are returned in original order.
 */
export function previousPerformance(
  sets: SetLike[],
  beforeDate: string,
  excludeSessionId?: string,
): { date: string; sessionId: string; sets: SetLike[] } | null {
  const eligible = sets.filter(
    (s) => s.date < beforeDate || (s.date === beforeDate && excludeSessionId !== undefined && s.sessionId !== excludeSessionId),
  );
  if (eligible.length === 0) return null;
  let date = eligible[0]!.date;
  let sessionId = eligible[0]!.sessionId;
  for (const s of eligible) {
    if (s.date > date) {
      date = s.date;
      sessionId = s.sessionId;
    }
  }
  return { date, sessionId, sets: eligible.filter((s) => s.date === date && s.sessionId === sessionId) };
}

/** Volume per ISO week (Monday start), ascending. */
export function weeklyVolume(sets: SetLike[]): { weekStart: string; volume: number }[] {
  const byWeek = new Map<string, number>();
  for (const s of sets) {
    const w = isoWeekStart(s.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + setVolume(s));
  }
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([weekStart, volume]) => ({ weekStart, volume }));
}
