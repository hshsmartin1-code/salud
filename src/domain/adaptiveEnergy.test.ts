import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MIN_KCAL,
  DEFAULT_ADAPTIVE_SETTINGS,
  PHASE_RATE_LIMITS,
  adaptiveSettingsForGoal,
  detectWeightOutliers,
  estimateObservedTdee,
  phaseForGoal,
  proposeAdjustment,
  requiredValidIntakeDays,
  sanitizeAdaptiveSettings,
  targetForPhase,
  toAdjustmentRecord,
  weightTrend,
} from './adaptiveEnergy';
import type {
  AdaptiveSettings,
  AdjustmentProposal,
  AdjustmentRecord,
  IntakeDay,
  ObservedTdeeResult,
  WeighIn,
} from './adaptiveEnergy';
import { addDays } from './dates';
import type { Sex } from './energy';
import { dailyMean, linearTrendPerWeek } from './stats';

const TO = '2026-11-15';
const FROM = addDays(TO, -27); // default 28-day window
const PHRASE = 'estimación a partir de tus registros de comida y peso';

// ───────────── deterministic synthetic data ─────────────

/** mulberry32: small seeded PRNG, so every run sees the same "noise". */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rng(seed: number) {
  const u = mulberry32(seed);
  return {
    uniform: (half: number) => (u() * 2 - 1) * half,
    /** Box–Muller normal with the given SD. */
    gauss: (sd: number) => sd * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()),
  };
}

interface ProfileSpec {
  seed: number;
  historyDays?: number; // days of history ending at TO (default 42 → window fully covered)
  intakeKcal: number;
  intakeSd?: number;
  startKg: number;
  kgPerWeek: number;
  noise?: { kind: 'gauss'; sd: number } | { kind: 'uniform'; half: number };
  weighEvery?: number;
}

interface Profile {
  intake: IntakeDay[];
  weights: WeighIn[];
}

const day = (date: string, kcal: number | null, over: Partial<IntakeDay> = {}): IntakeDay => ({
  date,
  kcal,
  entries: 5,
  partial: false,
  complete: null,
  ...over,
});

function buildProfile(spec: ProfileSpec): Profile {
  const n = spec.historyDays ?? 42;
  const start = addDays(TO, -(n - 1));
  const r = rng(spec.seed);
  const noise = spec.noise ?? { kind: 'gauss', sd: 0.35 };
  const intake: IntakeDay[] = [];
  const weights: WeighIn[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    intake.push(day(date, Math.round(spec.intakeKcal + r.gauss(spec.intakeSd ?? 250))));
    const e = noise.kind === 'gauss' ? r.gauss(noise.sd) : r.uniform(noise.half);
    if (i % (spec.weighEvery ?? 1) === 0) {
      // scale resolution 0.1 kg
      weights.push({ date, weightKg: Math.round((spec.startKg + (spec.kgPerWeek * i) / 7 + e) * 10) / 10 });
    }
  }
  return { intake, weights };
}

const truth = (spec: ProfileSpec) => spec.intakeKcal - (spec.kgPerWeek * 7700) / 7;

const settings = (over: Partial<AdaptiveSettings> = {}): AdaptiveSettings => ({ ...DEFAULT_ADAPTIVE_SETTINGS, ...over });

function run(p: Profile, over: { formulaTdee?: number; bmr?: number; settings?: Partial<AdaptiveSettings> } = {}) {
  return estimateObservedTdee({
    intake: p.intake,
    weights: p.weights,
    to: TO,
    formulaTdee: over.formulaTdee ?? 2500,
    bmr: over.bmr ?? 1700,
    settings: settings(over.settings),
  });
}

function expectNearTruth(r: ObservedTdeeResult, expected: number, maxAbs: number): void {
  expect(r.status).toBe('ok');
  expect(r.observedTdee).not.toBeNull();
  expect(r.observedSe).not.toBeNull();
  const err = Math.abs(r.observedTdee! - expected);
  expect(err).toBeLessThan(3 * r.observedSe!); // consistent with its own uncertainty
  expect(err).toBeLessThan(maxAbs);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const STABLE: ProfileSpec = { seed: 101, intakeKcal: 2400, startKg: 75, kgPerWeek: 0 };
const LOSS: ProfileSpec = { seed: 202, intakeKcal: 2200, startKg: 82, kgPerWeek: -0.5 };
const GAIN: ProfileSpec = { seed: 303, intakeKcal: 3000, startKg: 64, kgPerWeek: 0.3 };

// ───────────── constants & settings ─────────────

describe('settings and constants', () => {
  it('defaults: off, 28-day window, conservative minimums', () => {
    expect(DEFAULT_ADAPTIVE_SETTINGS).toEqual({
      mode: 'off',
      phase: 'maintenance',
      targetRatePctPerWeek: 0,
      windowDays: 28,
      minValidIntakeDays: 14,
      minWeighIns: 8,
      maxStepKcal: 150,
      cooldownDays: 14,
      energyPerKgKcal: 7700,
      minKcalFloor: null,
    });
    expect(Object.isFrozen(DEFAULT_ADAPTIVE_SETTINGS)).toBe(true);
    expect(Object.isFrozen(PHASE_RATE_LIMITS.deficit)).toBe(true);
  });
  it('rate limits per phase (% body weight / week)', () => {
    expect(PHASE_RATE_LIMITS).toEqual({
      deficit: { min: -1.0, max: -0.25, default: -0.5 },
      maintenance: { min: 0, max: 0, default: 0 },
      surplus: { min: 0.1, max: 0.5, default: 0.25 },
    });
  });
  it('phase and default rate from the goal; mode stays off', () => {
    expect(phaseForGoal('lose')).toBe('deficit');
    expect(phaseForGoal('gain')).toBe('surplus');
    expect(phaseForGoal('maintain')).toBe('maintenance');
    expect(phaseForGoal('recomp')).toBe('maintenance');
    expect(adaptiveSettingsForGoal('lose')).toMatchObject({ mode: 'off', phase: 'deficit', targetRatePctPerWeek: -0.5 });
    expect(adaptiveSettingsForGoal('gain')).toMatchObject({ phase: 'surplus', targetRatePctPerWeek: 0.25 });
  });
  it('valid intake days: max(minimum, 60 % of window)', () => {
    expect(requiredValidIntakeDays(DEFAULT_ADAPTIVE_SETTINGS)).toBe(17);
    expect(requiredValidIntakeDays(settings({ minValidIntakeDays: 20 }))).toBe(20);
    expect(requiredValidIntakeDays(settings({ windowDays: 42 }))).toBe(26);
  });
  it('sanitize clamps unsafe or invalid values', () => {
    const s = sanitizeAdaptiveSettings(
      settings({
        mode: 'turbo' as never,
        phase: 'deficit',
        targetRatePctPerWeek: -3,
        windowDays: 5,
        maxStepKcal: 2000,
        cooldownDays: 0,
        energyPerKgKcal: Number.NaN,
        minKcalFloor: 500,
      }),
    );
    expect(s).toMatchObject({
      mode: 'off',
      targetRatePctPerWeek: -1,
      windowDays: 21,
      maxStepKcal: 500,
      cooldownDays: 7,
      energyPerKgKcal: 7700,
      minKcalFloor: ABSOLUTE_MIN_KCAL,
    });
  });
});

describe('targetForPhase', () => {
  it('maintenance = TDEE', () => {
    expect(targetForPhase(2500, 80, 0, 7700)).toBe(2500);
  });
  it('deficit: 80 kg × 0.5 %/wk = 0.4 kg/wk ≈ 440 kcal/day', () => {
    expect(targetForPhase(2500, 80, -0.5, 7700)).toBeCloseTo(2060, 6);
  });
  it('surplus: 60 kg × 0.25 %/wk = 0.15 kg/wk ≈ 165 kcal/day', () => {
    expect(targetForPhase(2500, 60, 0.25, 7700)).toBeCloseTo(2665, 6);
  });
  it('scales with energy density', () => {
    expect(targetForPhase(2500, 80, -0.5, 7000)).toBeCloseTo(2100, 6);
  });
});

// ───────────── weights helpers ─────────────

describe('detectWeightOutliers / weightTrend', () => {
  const series = (vals: number[]) => vals.map((v, i) => ({ date: addDays(FROM, i), value: v }));

  it('needs ≥ 5 points', () => {
    const r = detectWeightOutliers(series([70, 70, 75, 70]));
    expect(r.outliers).toEqual([]);
    expect(r.kept).toHaveLength(4);
  });
  it('a steep but clean trend is not an outlier (robust detrending)', () => {
    const r = detectWeightOutliers(series(Array.from({ length: 20 }, (_, i) => 90 - 0.2 * i)));
    expect(r.outliers).toEqual([]);
  });
  it('flags a single spike, including at the edge', () => {
    const vals = Array.from({ length: 14 }, (_, i) => 70 + (i % 2 ? 0.2 : -0.2));
    vals[13] = 73;
    vals[6] = 67.5;
    expect(detectWeightOutliers(series(vals)).outliers).toEqual([addDays(FROM, 6), addDays(FROM, 13)]);
  });
  it('uses daily means for several weigh-ins on the same day', () => {
    const r = detectWeightOutliers([
      { date: FROM, value: 70 },
      { date: FROM, value: 71 },
      { date: addDays(FROM, 1), value: 70 },
    ]);
    expect(r.kept).toEqual([
      { date: FROM, value: 70.5 },
      { date: addDays(FROM, 1), value: 70 },
    ]);
  });
  it('weightTrend: slope matches stats.linearTrendPerWeek; SE > 0 with noise; null below 3 points', () => {
    const pts = series([80, 79.9, 80.1, 79.6, 79.8, 79.4, 79.5, 79.2]);
    const t = weightTrend(pts)!;
    expect(t.kgPerWeek).toBeCloseTo(linearTrendPerWeek(pts)!, 10);
    expect(t.seKgPerWeek).toBeGreaterThan(0);
    expect(weightTrend(pts.slice(0, 2))).toBeNull();
  });
});

// ───────────── estimateObservedTdee ─────────────

describe('estimateObservedTdee: recovers the true expenditure', () => {
  it('stable weight + stable intake ≈ intake', () => {
    const r = run(buildProfile(STABLE));
    expectNearTruth(r, 2400, 150);
    expect(Math.abs(r.trendKgPerWeek!)).toBeLessThan(0.15);
    expect(r.window).toEqual({ from: FROM, to: TO, days: 28 });
    expect(r.validIntakeDays).toBe(28);
    expect(r.weighIns).toBe(28);
    expect(r.weighInSpanDays).toBe(27);
    expect(r.reasons).toEqual([]);
    expect(r.confidence).toBe('high');
  });
  it('loss: 2200 kcal and −0.5 kg/week → ≈ 2750', () => {
    const r = run(buildProfile(LOSS), { formulaTdee: 2600 });
    expect(truth(LOSS)).toBe(2750);
    expectNearTruth(r, 2750, 150);
    expect(r.trendKgPerWeek!).toBeCloseTo(-0.5, 0);
  });
  it('gain: 3000 kcal and +0.3 kg/week → ≈ 2670', () => {
    const r = run(buildProfile(GAIN), { formulaTdee: 2700 });
    expectNearTruth(r, truth(GAIN), 150);
    expect(r.trendKgPerWeek!).toBeGreaterThan(0.15);
  });
  it('noisy weights (±0.8 kg daily) stay within tolerance; fluctuation is never removed as outliers', () => {
    const spec: ProfileSpec = {
      seed: 404,
      intakeKcal: 2500,
      intakeSd: 300,
      startKg: 88,
      kgPerWeek: -0.4,
      noise: { kind: 'uniform', half: 0.8 },
    };
    const noisy = run(buildProfile(spec), { formulaTdee: 2900 });
    expectNearTruth(noisy, truth(spec), 300);
    expect(noisy.outliersRemoved).toEqual([]);
    const clean = run(buildProfile({ ...spec, noise: { kind: 'gauss', sd: 0.1 } }), { formulaTdee: 2900 });
    expect(noisy.observedSe!).toBeGreaterThan(clean.observedSe!);
    // no trend + big noise: no fake tissue change
    const flat = run(buildProfile({ ...spec, kgPerWeek: 0 }), { formulaTdee: 2500 });
    expectNearTruth(flat, 2500, 300);
    expect(Math.abs(flat.trendKgPerWeek!)).toBeLessThan(0.3);
  });
  it('water/scale spikes are removed and do not move the estimate', () => {
    const spec: ProfileSpec = { ...STABLE, seed: 505, noise: { kind: 'gauss', sd: 0.3 } };
    const base = buildProfile(spec);
    const spikes: Record<string, number> = { [addDays(TO, -22)]: -2.5, [addDays(TO, -8)]: 2.8, [TO]: 3.2 };
    const spiked: Profile = {
      intake: base.intake,
      weights: base.weights.map((w) => ({ ...w, weightKg: w.weightKg + (spikes[w.date] ?? 0) })),
    };
    const r = run(spiked);
    const clean = run(base);
    expect(r.outliersRemoved).toEqual(Object.keys(spikes).sort());
    expect(r.weighIns).toBe(25);
    expect(Math.abs(r.observedTdee! - clean.observedTdee!)).toBeLessThan(60);
    // a plain regression over the spiked series would be pulled away from the truth
    const inWindow = spiked.weights.filter((w) => w.date >= FROM).map((w) => ({ date: w.date, value: w.weightKg }));
    const naive = r.meanIntakeKcal! - (linearTrendPerWeek(dailyMean(inWindow))! * 7700) / 7;
    expect(Math.abs(naive - 2400)).toBeGreaterThan(Math.abs(r.observedTdee! - 2400));
  });
  it('several weigh-ins per day → daily mean; approx/excluded weigh-ins ignored', () => {
    const base = buildProfile(LOSS);
    const ref = run(base);
    const extra: WeighIn[] = base.weights.flatMap((w, i) => [
      w,
      { date: w.date, weightKg: w.weightKg + 0.6 }, // evening weigh-in
      ...(i % 4 === 0 ? [{ date: w.date, weightKg: 95, excluded: true }] : []),
      ...(i % 5 === 0 ? [{ date: w.date, weightKg: 60, approx: true }] : []),
    ]);
    const r = run({ intake: base.intake, weights: extra });
    expect(r.weighIns).toBe(ref.weighIns);
    expect(r.trendKgPerWeek!).toBeCloseTo(ref.trendKgPerWeek!, 8);
    expect(r.observedTdee!).toBeCloseTo(ref.observedTdee!, 6);
  });
  it('data after `to` is ignored', () => {
    const base = buildProfile(STABLE);
    const later: Profile = {
      intake: [...base.intake, day(addDays(TO, 1), 6000), day(addDays(TO, 2), 900)],
      weights: [...base.weights, { date: addDays(TO, 1), weightKg: 90 }],
    };
    expect(run(later)).toEqual(run(base));
  });
});

describe('estimateObservedTdee: intake exclusions', () => {
  it('missing days (no record, no entries, kcal null) are skipped, not counted as zero', () => {
    const base = buildProfile(LOSS);
    const drop = new Set([1, 4, 5, 9, 15, 20, 26].map((i) => addDays(FROM, i)));
    const intake = base.intake
      .filter((d) => !drop.has(d.date))
      .map((d) =>
        d.date === addDays(FROM, 2)
          ? { ...d, entries: 0, kcal: null }
          : d.date === addDays(FROM, 3)
            ? { ...d, kcal: null }
            : d,
      );
    const r = run({ intake, weights: base.weights }, { formulaTdee: 2600 });
    expect(r.missingIntakeDays).toBe(9);
    expect(r.validIntakeDays).toBe(19);
    expect(r.excludedIntakeDays).toEqual([]);
    expectNearTruth(r, 2750, 200);
  });
  it('clearly incomplete days are excluded with reasons; user-confirmed days are kept', () => {
    const base = buildProfile(STABLE);
    const d = (i: number) => addDays(FROM, i);
    const patch: Record<string, Partial<IntakeDay>> = {
      [d(2)]: { kcal: 600 }, // very low, not confirmed
      [d(7)]: { partial: true }, // some foods without kcal, not confirmed
      [d(12)]: { complete: false }, // marked incomplete
      [d(17)]: { kcal: 24000 }, // typo
      [d(22)]: { kcal: 700, complete: true }, // low but confirmed (e.g. sick day) → kept
      [d(25)]: { partial: true, complete: true }, // confirmed → kept
    };
    const intake = base.intake.map((x) => (patch[x.date] ? { ...x, ...patch[x.date] } : x));
    const r = run({ intake, weights: base.weights });
    expect(r.excludedIntakeDays.map((x) => x.date)).toEqual([d(2), d(7), d(12), d(17)]);
    const reasons = r.excludedIntakeDays.map((x) => x.reason);
    expect(reasons[0]).toMatch(/Solo 600 kcal .*no está confirmado/);
    expect(reasons[1]).toMatch(/alimentos sin kcal/);
    expect(reasons[2]).toMatch(/Marcado por ti como incompleto/);
    expect(reasons[3]).toMatch(/error de registro/);
    expect(r.validIntakeDays).toBe(24);
    expect(r.status).toBe('ok');
    expect(r.meanIntakeKcal!).toBeGreaterThan(2250); // the 600-kcal day did not drag the mean down
  });
  it('the "very low" threshold is max(800, 0.5 × BMR)', () => {
    const base = buildProfile(STABLE);
    const intake = base.intake.map((x) => (x.date === addDays(FROM, 5) ? { ...x, kcal: 900 } : x));
    expect(run({ intake, weights: base.weights }, { bmr: 1900 }).excludedIntakeDays).toHaveLength(1);
    expect(run({ intake, weights: base.weights }, { bmr: 1500 }).excludedIntakeDays).toHaveLength(0);
  });
});

describe('estimateObservedTdee: insufficient data', () => {
  const expectInsufficient = (r: ObservedTdeeResult, pattern: RegExp) => {
    expect(r.status).toBe('insufficient');
    expect(r.reasons.some((x) => pattern.test(x))).toBe(true);
    expect(r.observedTdee).toBeNull();
    expect(r.blendedTdee).toBeNull();
    expect(r.confidence).toBe('none');
  };

  it('window not yet covered by the history', () => {
    const r = run(buildProfile({ ...STABLE, historyDays: 20 }));
    expectInsufficient(r, /Aún no hay 28 días de historial.*faltan 8 días/);
    expect(r.reasons).toHaveLength(1);
    expect(r.meanIntakeKcal).not.toBeNull(); // partial info still reported
  });
  it('no data at all', () => {
    const r = run({ intake: [], weights: [] });
    expectInsufficient(r, /Todavía no hay registros/);
    expect(r.meanIntakeKcal).toBeNull();
    expect(r.trendKgPerWeek).toBeNull();
  });
  it('too few valid intake days (also below 60 % of the window)', () => {
    const base = buildProfile(STABLE);
    const keep = (n: number) => base.intake.filter((d) => d.date < FROM || d.date >= addDays(TO, -(n - 1)));
    expectInsufficient(run({ intake: keep(10), weights: base.weights }), /Solo hay 10 días con la comida completa/);
    const r16 = run({ intake: keep(16), weights: base.weights });
    expect(r16.requiredValidIntakeDays).toBe(17);
    expectInsufficient(r16, /se necesitan al menos 17/);
    expect(run({ intake: keep(17), weights: base.weights }).status).toBe('ok');
  });
  it('too few weigh-ins', () => {
    const r = run(buildProfile({ ...STABLE, weighEvery: 5 }));
    expectInsufficient(r, /días con un peso válido; se necesitan al menos 8/);
  });
  it('weigh-ins spanning less than 14 days', () => {
    const base = buildProfile(STABLE);
    const r = run({ intake: base.intake, weights: base.weights.filter((w) => w.date >= addDays(TO, -9)) });
    expect(r.weighIns).toBe(10);
    expectInsufficient(r, /Los pesos abarcan solo 9 días/);
  });
});

describe('estimateObservedTdee: inconsistent data', () => {
  const expectInconsistent = (r: ObservedTdeeResult, pattern: RegExp) => {
    expect(r.status).toBe('inconsistent');
    expect(r.reasons.some((x) => pattern.test(x))).toBe(true);
    expect(r.observedTdee).toBeNull();
    expect(r.blendedTdee).toBeNull();
    expect(r.confidence).toBe('none');
    expect(r.rawImpliedTdee).not.toBeNull(); // diagnostic only
  };

  it('implied TDEE below 90 % of BMR (under-reporting)', () => {
    const p = buildProfile({ ...STABLE, intakeKcal: 1100, intakeSd: 80 });
    const r = run({ intake: p.intake.map((d) => ({ ...d, complete: true })), weights: p.weights }, { bmr: 1700 });
    expectInconsistent(r, /por debajo del 90 % de tu metabolismo basal/);
    expect(r.rawImpliedTdee!).toBeLessThan(1530);
  });
  it('weight changing faster than 1.5 % of body weight per week', () => {
    const r = run(buildProfile({ seed: 606, intakeKcal: 2000, startKg: 80, kgPerWeek: -2.5 }), { formulaTdee: 2600 });
    expectInconsistent(r, /El peso cambia −3,\d+ % por semana/);
  });
  it('implied TDEE above 1.8 × formula', () => {
    const r = run(buildProfile({ ...STABLE, intakeKcal: 4800 }), { formulaTdee: 2500 });
    expectInconsistent(r, /más de 1,8 veces/);
  });
  it('implied TDEE more than 3500 kcal away from formula', () => {
    const r = run(buildProfile({ ...STABLE, intakeKcal: 8600, intakeSd: 300 }), { formulaTdee: 5000, bmr: 2600 });
    expectInconsistent(r, /se aleja más de 3\.500 kcal/);
    expect(r.reasons).toHaveLength(1);
  });
  it('too many weight outliers', () => {
    const base = buildProfile({ ...STABLE, seed: 707, noise: { kind: 'gauss', sd: 0.2 } });
    const weights = base.weights.map((w, i) => (w.date >= FROM && i % 4 === 0 ? { ...w, weightKg: w.weightKg + 3 } : w));
    const r = run({ intake: base.intake, weights });
    expect(r.outliersRemoved.length).toBe(7);
    expectInconsistent(r, /demasiados pesos atípicos/);
  });
});

describe('estimateObservedTdee: blending and confidence', () => {
  it('blend = inverse-variance weighted mean of prior (SD 15 %) and observation', () => {
    const formulaTdee = 2300;
    const r = run(buildProfile(LOSS), { formulaTdee });
    const priorVar = (0.15 * formulaTdee) ** 2;
    const w = 1 / r.observedSe! ** 2 / (1 / r.observedSe! ** 2 + 1 / priorVar);
    expect(r.observationWeight!).toBeCloseTo(w, 10);
    expect(r.blendedTdee!).toBeCloseTo(w * r.observedTdee! + (1 - w) * formulaTdee, 6);
    expect(r.blendedTdee!).toBeGreaterThan(formulaTdee);
    expect(r.blendedTdee!).toBeLessThan(r.observedTdee!);
    expect(r.blendedSe!).toBeLessThan(Math.min(r.observedSe!, 0.15 * formulaTdee));
  });
  it('sparser data → larger SE and lower confidence', () => {
    const dense = run(buildProfile(STABLE));
    const base = buildProfile({ ...STABLE, weighEvery: 3 });
    const intake = base.intake.filter((_, i) => i % 3 !== 1); // ≈ 2/3 of days logged
    const sparse = run({ intake, weights: base.weights });
    expect(sparse.status).toBe('ok');
    expect(sparse.observedSe!).toBeGreaterThan(dense.observedSe!);
    expect(sparse.observationWeight!).toBeLessThan(dense.observationWeight!);
    expect(sparse.confidence).toBe('low');
    expect(dense.confidence).toBe('high');
  });
});

describe('estimateObservedTdee: independent profiles, no shared state', () => {
  it('call order does not matter and inputs are not mutated', () => {
    const A = deepFreeze(buildProfile({ seed: 1, intakeKcal: 2300, startKg: 92, kgPerWeek: -0.6 }));
    const B = deepFreeze(buildProfile({ seed: 2, intakeKcal: 2100, startKg: 58, kgPerWeek: 0.2 }));
    const argsA = { formulaTdee: 2900, bmr: 1850 };
    const argsB = { formulaTdee: 1950, bmr: 1300 };
    const a1 = run(A, argsA);
    const b1 = run(B, argsB);
    const b2 = run(B, argsB);
    const a2 = run(A, argsA);
    expect(a1).toEqual(a2);
    expect(b1).toEqual(b2);
    expect(a1.status).toBe('ok');
    expect(b1.status).toBe('ok');
    expectNearTruth(a1, 2300 + 660, 200);
    expectNearTruth(b1, 2100 - 220, 200);
    // mutating one result does not leak into the next call
    a1.reasons.push('x');
    a1.excludedIntakeDays.push({ date: TO, reason: 'x' });
    expect(run(A, argsA)).toEqual(a2);
  });
});

// ───────────── proposeAdjustment ─────────────

function okObserved(blendedTdee: number, over: Partial<ObservedTdeeResult> = {}): ObservedTdeeResult {
  return {
    status: 'ok',
    reasons: [],
    window: { from: FROM, to: TO, days: 28 },
    validIntakeDays: 26,
    requiredValidIntakeDays: 17,
    missingIntakeDays: 2,
    excludedIntakeDays: [],
    weighIns: 24,
    weighInSpanDays: 27,
    outliersRemoved: [],
    meanIntakeKcal: blendedTdee,
    trendKgPerWeek: 0,
    trendSeKgPerWeek: 0.06,
    rawImpliedTdee: blendedTdee,
    observedTdee: blendedTdee,
    observedSe: 90,
    blendedTdee,
    blendedSe: 85,
    observationWeight: 0.93,
    confidence: 'high',
    ...over,
  };
}

interface ProposeOpts {
  settings?: Partial<AdaptiveSettings>;
  currentKcal?: number;
  currentWeightKg?: number;
  bmr?: number;
  sex?: Sex;
  manualOverride?: boolean;
  history?: AdjustmentRecord[];
  today?: string;
}

function propose(observed: ObservedTdeeResult, o: ProposeOpts = {}): AdjustmentProposal {
  return proposeAdjustment({
    observed,
    settings: settings({ mode: 'suggest', ...o.settings }),
    currentKcal: o.currentKcal ?? 2300,
    currentWeightKg: o.currentWeightKg ?? 80,
    bmr: o.bmr ?? 1700,
    sex: o.sex ?? 'male',
    manualOverride: o.manualOverride ?? false,
    history: o.history ?? [],
    today: o.today ?? TO,
  });
}

const DEFICIT = { phase: 'deficit', targetRatePctPerWeek: -0.5 } as const;
const rec = (date: string): AdjustmentRecord => ({
  date,
  fromKcal: 2400,
  toKcal: 2300,
  tdee: 2750,
  reason: 'x',
  applied: 'accepted',
});

describe('proposeAdjustment: modes and statuses', () => {
  it("mode 'off' → disabled, nothing proposed", () => {
    const p = propose(okObserved(2750), { settings: { mode: 'off' } });
    expect(p.status).toBe('disabled');
    expect(p.proposedKcal).toBeNull();
    expect(p.deltaKcal).toBeNull();
  });
  it('insufficient / inconsistent observations are passed through with their reasons', () => {
    const ins = propose(okObserved(2750, { status: 'insufficient', reasons: ['Faltan días.'], blendedTdee: null }));
    expect(ins.status).toBe('insufficient');
    expect(ins.proposedKcal).toBeNull();
    expect(ins.explanation).toContain('Faltan días.');
    const inc = propose(okObserved(2750, { status: 'inconsistent', reasons: ['No cuadra.'], blendedTdee: null }));
    expect(inc.status).toBe('inconsistent');
    expect(inc.proposedKcal).toBeNull();
  });
  it("'suggest' → suggest", () => {
    const p = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2250 });
    expect(p.status).toBe('suggest');
    expect(p.rawTargetKcal).toBe(2310); // 2750 − 440
    expect(p.proposedKcal).toBe(2310);
    expect(p.deltaKcal).toBe(60);
    expect(p.limitedBy).toEqual([]);
    expect(p.tdeeUsed).toBe(2750);
  });
  it("'auto' → auto_apply (medium/high confidence); low confidence is only suggested", () => {
    const auto = { ...DEFICIT, mode: 'auto' } as const;
    expect(propose(okObserved(2750), { settings: auto, currentKcal: 2250 }).status).toBe('auto_apply');
    expect(propose(okObserved(2750, { confidence: 'medium' }), { settings: auto, currentKcal: 2250 }).status).toBe(
      'auto_apply',
    );
    const low = propose(okObserved(2750, { confidence: 'low' }), { settings: auto, currentKcal: 2250 });
    expect(low.status).toBe('suggest');
    expect(low.explanation).toMatch(/confianza es baja/);
  });
  it('manual override → manual_locked (never auto_apply) with the suggestion still computed', () => {
    for (const mode of ['auto', 'suggest'] as const) {
      const p = propose(okObserved(2750), { settings: { ...DEFICIT, mode }, currentKcal: 2250, manualOverride: true });
      expect(p.status).toBe('manual_locked');
      expect(p.proposedKcal).toBe(2310);
      expect(p.deltaKcal).toBe(60);
      expect(p.explanation).toMatch(/meta manual/);
    }
  });
  it('changes below 50 kcal → no_change', () => {
    const p = propose(okObserved(2500), { currentKcal: 2470 });
    expect(p.status).toBe('no_change');
    expect(p.proposedKcal).toBe(2470);
    expect(p.deltaKcal).toBe(0);
    expect(p.rawTargetKcal).toBe(2500);
    expect(propose(okObserved(2500), { currentKcal: 2450 }).status).toBe('suggest'); // exactly 50 → change
  });
});

describe('proposeAdjustment: phase targets', () => {
  it('maintenance', () => {
    const p = propose(okObserved(2500), { currentKcal: 2400 });
    expect(p.rawTargetKcal).toBe(2500);
    expect(p.proposedKcal).toBe(2500);
    expect(p.ratePctPerWeek).toBe(0);
  });
  it('deficit', () => {
    const p = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2400, currentWeightKg: 80 });
    expect(p.proposedKcal).toBe(2310);
    expect(p.deltaKcal).toBe(-90);
    expect(p.explanation).toMatch(/perder cerca de 0,5 % de tu peso por semana \(≈ 0,4 kg\)/);
  });
  it('surplus', () => {
    const p = propose(okObserved(2600), {
      settings: { phase: 'surplus', targetRatePctPerWeek: 0.25 },
      currentKcal: 2700,
      currentWeightKg: 60,
    });
    expect(p.rawTargetKcal).toBe(2770); // 2600 + 165 = 2765 → 2770
    expect(p.proposedKcal).toBe(2770);
    expect(p.explanation).toMatch(/ganar cerca de 0,25 %/);
  });
});

describe('proposeAdjustment: bounds', () => {
  it('step limit ±maxStepKcal from the current target', () => {
    const up = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 1800 });
    expect(up.rawTargetKcal).toBe(2310);
    expect(up.proposedKcal).toBe(1950);
    expect(up.limitedBy).toEqual(['step']);
    const down = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2600 });
    expect(down.proposedKcal).toBe(2450);
    expect(down.deltaKcal).toBe(-150);
    const custom = propose(okObserved(2750), { settings: { ...DEFICIT, maxStepKcal: 100 }, currentKcal: 2600 });
    expect(custom.proposedKcal).toBe(2500);
  });
  it('floor (male): max(BMR, 1500)', () => {
    const low = { phase: 'deficit', targetRatePctPerWeek: -1 } as const;
    const p = propose(okObserved(2000), { settings: low, currentKcal: 1700, currentWeightKg: 90, bmr: 1600 });
    expect(p.rawTargetKcal).toBe(1010);
    expect(p.floorKcal).toBe(1600);
    expect(p.proposedKcal).toBe(1600);
    expect(p.limitedBy).toEqual(['floor']);
    expect(p.explanation).toMatch(/No se baja de 1\.600 kcal/);
    expect(propose(okObserved(2000), { settings: low, currentKcal: 1600, bmr: 1400 }).floorKcal).toBe(1500);
  });
  it('floor (female): max(BMR, 1200)', () => {
    const low = { phase: 'deficit', targetRatePctPerWeek: -1 } as const;
    const p = propose(okObserved(1700), {
      settings: low,
      currentKcal: 1300,
      currentWeightKg: 60,
      bmr: 1150,
      sex: 'female',
    });
    expect(p.floorKcal).toBe(1200);
    expect(p.proposedKcal).toBe(1200);
    expect(p.limitedBy).toEqual(['floor']);
    expect(propose(okObserved(1700), { settings: low, bmr: 1345, sex: 'female' }).floorKcal).toBe(1350); // ceil to 10
  });
  it('custom floor is honoured (never below the absolute minimum)', () => {
    const low = { phase: 'deficit', targetRatePctPerWeek: -1, minKcalFloor: 1800 } as const;
    expect(propose(okObserved(2000), { settings: low, currentKcal: 1900 }).proposedKcal).toBe(1800);
    expect(propose(okObserved(2000), { settings: { ...low, minKcalFloor: 600 } }).floorKcal).toBe(ABSOLUTE_MIN_KCAL);
  });
  it('the floor wins over the step limit and over the 50 kcal rule', () => {
    const p = propose(okObserved(2200), { settings: DEFICIT, currentKcal: 1100, bmr: 1400 });
    expect(p.proposedKcal).toBe(1500);
    expect(p.limitedBy).toEqual(['step', 'floor']);
    const near = propose(okObserved(1700), { settings: DEFICIT, currentKcal: 1480, bmr: 1400 });
    expect(near.status).toBe('suggest');
    expect(near.proposedKcal).toBe(1500);
  });
  it('rate is clamped to the phase limits', () => {
    const fast = propose(okObserved(2750), { settings: { phase: 'deficit', targetRatePctPerWeek: -2 } });
    expect(fast.ratePctPerWeek).toBe(-1);
    expect(fast.rateClamped).toBe(true);
    expect(fast.rawTargetKcal).toBe(1870); // 2750 − 880
    expect(fast.explanation).toMatch(/fuera del rango seguro/);
    expect(propose(okObserved(2750), { settings: { phase: 'surplus', targetRatePctPerWeek: 1 } }).ratePctPerWeek).toBe(
      0.5,
    );
    expect(
      propose(okObserved(2750), { settings: { phase: 'maintenance', targetRatePctPerWeek: -0.5 } }).ratePctPerWeek,
    ).toBe(0);
    // wrong sign for the phase → gentlest allowed rate
    expect(propose(okObserved(2750), { settings: { phase: 'deficit', targetRatePctPerWeek: 0.5 } }).ratePctPerWeek).toBe(
      -0.25,
    );
    expect(propose(okObserved(2750), { settings: DEFICIT }).rateClamped).toBe(false);
  });
  it('rounds every kcal value to the nearest 10 and keeps |delta| ≤ maxStep', () => {
    for (const current of [1873, 2107, 2255, 2499, 2731]) {
      for (const tdee of [2111, 2468, 2777, 3033]) {
        const p = propose(okObserved(tdee), { settings: DEFICIT, currentKcal: current, currentWeightKg: 77.3 });
        expect(p.rawTargetKcal! % 10).toBe(0);
        if (p.status === 'no_change') continue;
        expect(p.proposedKcal! % 10).toBe(0);
        expect(Math.abs(p.deltaKcal!)).toBeLessThanOrEqual(150);
      }
    }
    const r = propose(okObserved(2777), { settings: DEFICIT, currentKcal: 2107 });
    expect(r.proposedKcal).toBe(2250); // 2107 + 150 = 2257 → 2250 stays inside the step
  });
});

describe('proposeAdjustment: cooldown', () => {
  it('last adjustment < cooldownDays ago → cooldown with nextEligibleDate (history order irrelevant)', () => {
    const p = propose(okObserved(2750), { settings: DEFICIT, history: [rec('2026-11-05'), rec('2026-10-01')] });
    expect(p.status).toBe('cooldown');
    expect(p.nextEligibleDate).toBe('2026-11-19');
    expect(p.limitedBy).toEqual(['cooldown']);
    expect(p.proposedKcal).toBeNull();
    expect(p.rawTargetKcal).toBe(2310);
    expect(p.explanation).toMatch(/próxima revisión será el 19 nov 2026/);
  });
  it('exactly cooldownDays later → eligible again', () => {
    const p = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2400, history: [rec('2026-11-01')] });
    expect(p.status).toBe('suggest');
    expect(p.nextEligibleDate).toBeNull();
  });
  it('custom cooldown', () => {
    const p = propose(okObserved(2750), { settings: { ...DEFICIT, cooldownDays: 21 }, history: [rec('2026-11-01')] });
    expect(p.status).toBe('cooldown');
    expect(p.nextEligibleDate).toBe('2026-11-22');
  });
  it('manual override during cooldown still reports cooldown', () => {
    const p = propose(okObserved(2750), { settings: DEFICIT, manualOverride: true, history: [rec('2026-11-10')] });
    expect(p.status).toBe('cooldown');
  });
});

describe('proposeAdjustment: explanation wording', () => {
  it('every status says it is an estimate, never an exact measurement', () => {
    const cases: AdjustmentProposal[] = [
      propose(okObserved(2750), { settings: { mode: 'off' } }),
      propose(okObserved(2750, { status: 'insufficient', reasons: ['x'], blendedTdee: null })),
      propose(okObserved(2750, { status: 'inconsistent', reasons: ['x'], blendedTdee: null })),
      propose(okObserved(2750), { settings: DEFICIT, history: [rec('2026-11-10')] }),
      propose(okObserved(2500), { currentKcal: 2490 }),
      propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2200 }),
      propose(okObserved(2750), { settings: { ...DEFICIT, mode: 'auto' }, currentKcal: 2200 }),
      propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2200, manualOverride: true }),
    ];
    expect(cases.map((c) => c.status)).toEqual([
      'disabled',
      'insufficient',
      'inconsistent',
      'cooldown',
      'no_change',
      'suggest',
      'auto_apply',
      'manual_locked',
    ]);
    for (const c of cases) {
      expect(c.explanation).toContain(PHRASE);
      expect(c.explanation).toContain('no una medición exacta');
      expect(c.explanation).not.toMatch(/\b(medimos|medido|tu metabolismo es)\b/);
    }
  });
});

describe('toAdjustmentRecord', () => {
  it('builds a record for applied/accepted proposals only', () => {
    const auto = propose(okObserved(2750), { settings: { ...DEFICIT, mode: 'auto' }, currentKcal: 2200 });
    expect(toAdjustmentRecord(auto, TO, 'auto')).toMatchObject({
      date: TO,
      fromKcal: 2200,
      toKcal: 2310,
      tdee: 2750,
      applied: 'auto',
    });
    const sug = propose(okObserved(2750), { settings: DEFICIT, currentKcal: 2200 });
    expect(toAdjustmentRecord(sug, TO, 'auto')).toBeNull();
    expect(toAdjustmentRecord(sug, TO, 'accepted')?.reason).toMatch(/estimación/);
    expect(toAdjustmentRecord(propose(okObserved(2500), { currentKcal: 2490 }), TO, 'accepted')).toBeNull();
  });
});

describe('end to end', () => {
  it('logged data → estimate → proposal, and the next run respects the cooldown', () => {
    const p = buildProfile(LOSS);
    const s = { ...adaptiveSettingsForGoal('lose'), mode: 'suggest' as const };
    const observed = estimateObservedTdee({ ...p, to: TO, formulaTdee: 2600, bmr: 1750, settings: s });
    expect(observed.status).toBe('ok');
    const args = {
      observed,
      settings: s,
      currentKcal: 2150,
      currentWeightKg: p.weights.at(-1)!.weightKg,
      bmr: 1750,
      sex: 'male' as const,
      manualOverride: false,
      history: [] as AdjustmentRecord[],
      today: TO,
    };
    const first = proposeAdjustment(args);
    expect(first.status).toBe('suggest');
    expect(first.proposedKcal! - 2150).toBeGreaterThanOrEqual(50);
    expect(first.proposedKcal! - 2150).toBeLessThanOrEqual(150);
    const record = toAdjustmentRecord(first, TO, 'accepted')!;
    const again = proposeAdjustment({ ...args, currentKcal: record.toKcal, history: [record], today: addDays(TO, 3) });
    expect(again.status).toBe('cooldown');
    expect(again.nextEligibleDate).toBe(addDays(TO, 14));
  });
});
