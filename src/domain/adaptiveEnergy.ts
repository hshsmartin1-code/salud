/**
 * Adaptive energy expenditure (pure, no DB/React).
 *
 * Five concepts are kept apart on purpose:
 *  1. Initial activity factor — an input chosen by the user (ACTIVITY_LEVELS in ./energy).
 *  2. Formula TDEE — Mifflin–St Jeor × activity factor (computeTargets in ./energy); an input here.
 *  3. Observed / adaptive TDEE — inferred from logged intake + weight trend (estimateObservedTdee).
 *  4. Calorie target for the chosen phase — targetForPhase / proposeAdjustment.
 *  5. Logged activity — NOT an input of this module and never added to the budget: whatever the person
 *     does is already reflected in the observed TDEE, so adding exercise kcal would count it twice.
 *     The UI may show it next to the estimate as context only.
 *
 * Energy balance identity used (Hall 2008 style, simplified, static):
 *   observed TDEE ≈ mean intake − (weight trend kg/day) × energy density (kcal/kg).
 * 7700 kcal/kg is a rule-of-thumb for mixed fat + lean tissue. The real density varies with body
 * composition and phase (early weight change is mostly glycogen + water, much less energy per kg),
 * so every number here is an estimate, never a measurement.
 *
 * Assumptions / caveats:
 *  - Days without usable intake are assumed to resemble the logged ones (missing at random).
 *  - Systematic under-reporting of intake cannot be detected, only implausible results.
 *  - Water shifts (salt, carbs, menstrual cycle, training) are noise, never tissue change:
 *    spikes are removed, multi-day plateaus are averaged out by the 28-day window.
 */
import { addDays, dateRange, dayNumber, daysBetween, formatDateEs } from './dates';
import { ABSOLUTE_MIN_KCAL, safetyFloorKcal, type GoalType, type Sex } from './energy';
import { dailyMean, linearTrendPerWeek } from './stats';
import type { DatedPoint } from './stats';
import { formatNumber } from './units';

export type EnergyPhase = 'deficit' | 'maintenance' | 'surplus';
/** 'auto' is opt-in; the default is 'off'. */
export type AdaptiveMode = 'off' | 'suggest' | 'auto';

export interface IntakeDay {
  date: string;
  /** Sum of the day's logged kcal; null when no logged food has kcal. */
  kcal: number | null;
  entries: number;
  /** Some logged foods lack kcal. */
  partial: boolean;
  /** User-marked complete (true) / incomplete (false), or null = unknown. */
  complete: boolean | null;
}

export interface WeighIn {
  date: string;
  weightKg: number;
  approx?: boolean;
  excluded?: boolean;
}

export interface AdaptiveSettings {
  mode: AdaptiveMode;
  phase: EnergyPhase;
  /** % of body weight per week (negative = loss). Clamped to PHASE_RATE_LIMITS. */
  targetRatePctPerWeek: number;
  windowDays: number;
  minValidIntakeDays: number;
  minWeighIns: number;
  maxStepKcal: number;
  cooldownDays: number;
  /** kcal per kg of body-weight change; 7700 approximates mixed tissue. */
  energyPerKgKcal: number;
  /** null → max(BMR, 1200 women / 1500 men). */
  minKcalFloor: number | null;
}

/** % body weight per week. */
export const PHASE_RATE_LIMITS: Record<EnergyPhase, { min: number; max: number; default: number }> = Object.freeze({
  deficit: Object.freeze({ min: -1.0, max: -0.25, default: -0.5 }),
  maintenance: Object.freeze({ min: 0, max: 0, default: 0 }),
  surplus: Object.freeze({ min: 0.1, max: 0.5, default: 0.25 }),
});

export const DEFAULT_ADAPTIVE_SETTINGS: AdaptiveSettings = Object.freeze({
  mode: 'off',
  phase: 'maintenance', // use adaptiveSettingsForGoal() to derive phase + rate from the goal
  targetRatePctPerWeek: 0,
  windowDays: 28,
  minValidIntakeDays: 14,
  minWeighIns: 8,
  maxStepKcal: 150,
  cooldownDays: 14,
  energyPerKgKcal: 7700, // approximation for mixed fat + lean tissue, not a constant of nature (see chooseEnergyDensity)
  minKcalFloor: null,
});

/** Valid intake days must also cover at least this share of the window (28 d → 17 days). */
export const MIN_INTAKE_COVERAGE = 0.6;
/** First-to-last weigh-in distance required for a trend. */
export const MIN_WEIGH_IN_SPAN_DAYS = 14;
/** Formula TDEE treated as a prior with SD = 15 % of its value. */
export const FORMULA_PRIOR_REL_SD = 0.15;
/** Lower bound for the observation SD (logging error that the data cannot reveal). */
export const MIN_OBSERVATION_SE_KCAL = 50;
/** Weight outliers: |residual| > 3.5 × robust SD (1.4826·MAD; Iglewicz–Hoaglin modified z-score). */
export const OUTLIER_MAD_THRESHOLD = 3.5;
/** Centred rolling-median window (points) and minimum points needed to look for outliers. */
export const OUTLIER_WINDOW_POINTS = 7;
export const OUTLIER_MIN_POINTS = 5;
/** Robust SD never below 0.3 kg, so normal day-to-day fluctuation (< ~1 kg) is never flagged. */
export const MIN_WEIGHT_SCALE_KG = 0.3;
/** Changes smaller than this are ignored. */
export const NO_CHANGE_THRESHOLD_KCAL = 50;
/** No floor (custom or computed) can go below this (defined with the shared floor in ./energy). */
export { ABSOLUTE_MIN_KCAL };

// ───────────────────────── energy density of weight change ─────────────────────────

/** Rule-of-thumb density of a kg of body-weight change (mixed fat + lean tissue). */
export const DEFAULT_ENERGY_PER_KG_KCAL = 7700;
/** Hall 2008 (IJO 32:573): fat tissue 39,5 MJ/kg and lean tissue 7,6 MJ/kg, in kcal (÷ 4,184). */
export const FAT_TISSUE_KCAL_PER_KG = 39500 / 4.184; // ≈ 9441
export const LEAN_TISSUE_KCAL_PER_KG = 7600 / 4.184; // ≈ 1816
/** Forbes (1987): dLean/dWeight = C / (C + fat mass), C = 10,4 kg. */
export const FORBES_C_KG = 10.4;
/** A body-fat estimate older than this (days before the window end) is not used. */
export const BODY_FAT_MAX_AGE_DAYS = 90;

/**
 * Energy density (kcal/kg) of a small change of body weight for a person with `bodyFatPct` % fat, by the
 * Forbes partition and Hall's tissue densities: p = 10,4/(10,4 + G); ρ = p·1816 + (1 − p)·9440, with G the
 * fat mass in kg. About 5550 kcal/kg at 10 kg of fat, 6830 at 20 kg, 7480 at 30 kg: 7700 only fits people
 * with more than ~30 kg of fat. Clamped to the sanitised range 5000–9500.
 */
export function energyDensityForbesHall(weightKg: number, bodyFatPct: number): number {
  assertPositive('El peso (kg)', weightKg);
  if (!Number.isFinite(bodyFatPct) || bodyFatPct <= 0 || bodyFatPct >= 100) throw new Error('El % de grasa debe estar entre 0 y 100');
  const fatKg = (weightKg * bodyFatPct) / 100;
  const leanShare = FORBES_C_KG / (FORBES_C_KG + fatKg);
  return clamp(leanShare * LEAN_TISSUE_KCAL_PER_KG + (1 - leanShare) * FAT_TISSUE_KCAL_PER_KG, 5000, 9500);
}

export interface EnergyDensityChoice {
  kcalPerKg: number;
  /** 'body-fat' = Forbes/Hall from a recent body-fat estimate; 'default' = 7700 (no usable estimate). */
  source: 'body-fat' | 'default';
  bodyFatPct: number | null;
  fatMassKg: number | null;
  date: string | null;
}

/**
 * Picks the energy density for the adaptive estimate: Forbes/Hall from the most recent plausible body-fat
 * estimate (3–70 %) dated within BODY_FAT_MAX_AGE_DAYS before `to`, when the weight is known; otherwise 7700.
 */
export function chooseEnergyDensity(args: { weightKg: number | null; bodyFat: { date: string; pct: number }[]; to: string }): EnergyDensityChoice {
  const fallback: EnergyDensityChoice = { kcalPerKg: DEFAULT_ENERGY_PER_KG_KCAL, source: 'default', bodyFatPct: null, fatMassKg: null, date: null };
  const w = args.weightKg;
  if (w === null || !Number.isFinite(w) || w < 20 || w > 400) return fallback;
  const from = addDays(args.to, -(BODY_FAT_MAX_AGE_DAYS - 1));
  let pick: { date: string; pct: number } | null = null;
  for (const b of args.bodyFat) {
    if (!Number.isFinite(b.pct) || b.pct < 3 || b.pct > 70 || b.date < from || b.date > args.to) continue;
    if (!pick || b.date > pick.date) pick = b;
  }
  if (!pick) return fallback;
  return { kcalPerKg: energyDensityForbesHall(w, pick.pct), source: 'body-fat', bodyFatPct: pick.pct, fatMassKg: (w * pick.pct) / 100, date: pick.date };
}
/**
 * Confidence of an 'ok' estimate (anything not high/medium is low):
 * high: observation SE ≤ 120 kcal and ≥ 85 % of window days with valid intake;
 * medium: SE ≤ 250 kcal and ≥ 70 %.
 */
export const CONFIDENCE_RULES = Object.freeze({
  high: Object.freeze({ maxSeKcal: 120, minCoverage: 0.85 }),
  medium: Object.freeze({ maxSeKcal: 250, minCoverage: 0.7 }),
});
/** Inconsistency limits for the implied TDEE and weight trend. */
export const CONSISTENCY_LIMITS = Object.freeze({
  minBmrFactor: 0.9,
  maxFormulaFactor: 1.8,
  maxFormulaDiffKcal: 3500,
  maxTrendPctPerWeek: 1.5,
  /** More outliers than max(2, 20 % of weigh-in days) → the weight series is not trustworthy. */
  maxOutlierShare: 0.2,
});

export const PHASE_LABELS: Record<EnergyPhase, string> = {
  deficit: 'Déficit',
  maintenance: 'Mantenimiento',
  surplus: 'Superávit',
};

export const MODE_LABELS: Record<AdaptiveMode, string> = {
  off: 'Desactivado',
  suggest: 'Sugerir',
  auto: 'Automático',
};

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  none: 'sin datos',
  low: 'baja',
  medium: 'media',
  high: 'alta',
};

const DISCLAIMER =
  'Es una estimación a partir de tus registros de comida y peso, no una medición exacta de tu metabolismo.';
const MAD_TO_SD = 1.4826;

export interface ObservedTdeeResult {
  status: 'ok' | 'insufficient' | 'inconsistent';
  /** Why insufficient / inconsistent (Spanish). Empty when ok. */
  reasons: string[];
  window: { from: string; to: string; days: number };
  validIntakeDays: number;
  /** max(minValidIntakeDays, ⌈60 % of the window⌉). */
  requiredValidIntakeDays: number;
  /** Days with no record, no entries or kcal null. */
  missingIntakeDays: number;
  excludedIntakeDays: { date: string; reason: string }[];
  /** Days with a usable weigh-in after outlier removal (several per day count once). */
  weighIns: number;
  weighInSpanDays: number;
  outliersRemoved: string[];
  meanIntakeKcal: number | null;
  /** OLS on daily-mean weights after outlier removal. */
  trendKgPerWeek: number | null;
  /** OLS slope SE, inflated for lag-1 autocorrelation of the residuals (water retention lasts days). */
  trendSeKgPerWeek: number | null;
  /** meanIntake − trend·energyPerKg/7 before any check. Diagnostic only, never for use. */
  rawImpliedTdee: number | null;
  /** = meanIntake − trend·energyPerKg/7; null unless status is 'ok'. */
  observedTdee: number | null;
  observedSe: number | null;
  /** Precision-weighted blend of the formula prior and the observation; null unless 'ok'. */
  blendedTdee: number | null;
  blendedSe: number | null;
  /** Share of the blend coming from the observation (0–1). */
  observationWeight: number | null;
  confidence: Confidence;
}

export interface AdjustmentRecord {
  date: string;
  fromKcal: number;
  toKcal: number;
  tdee: number;
  reason: string;
  applied: 'auto' | 'accepted';
}

export interface AdjustmentProposal {
  status:
    | 'disabled'
    | 'insufficient'
    | 'inconsistent'
    | 'cooldown'
    | 'no_change'
    | 'suggest'
    | 'auto_apply'
    | 'manual_locked';
  currentKcal: number;
  proposedKcal: number | null;
  deltaKcal: number | null;
  /** Phase target before step limit / floor (rounded to 10). */
  rawTargetKcal: number | null;
  limitedBy: ('step' | 'floor' | 'cooldown')[];
  nextEligibleDate: string | null;
  /** Spanish, plain language, always states it is an estimate. */
  explanation: string;
  /** Blended TDEE the target was built on. */
  tdeeUsed: number | null;
  /** Rate actually used, after clamping to PHASE_RATE_LIMITS. */
  ratePctPerWeek: number;
  rateClamped: boolean;
  floorKcal: number;
  confidence: Confidence;
}

// ───────────────────────── helpers ─────────────────────────

const f0 = (n: number) => formatNumber(n, 0);

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function round10(n: number): number {
  return Math.round(n / 10) * 10;
}

function assertPositive(name: string, v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${name} debe ser un número mayor que 0`);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

function isUsableWeighIn(w: WeighIn): boolean {
  return !w.excluded && !w.approx && Number.isFinite(w.weightKg) && w.weightKg >= 20 && w.weightKg <= 400;
}

function signed(n: number, text: string): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
}

function signedKcal(n: number): string {
  return `${signed(n, f0(Math.abs(n)))} kcal`;
}

function signedPct(n: number): string {
  return `${signed(n, formatNumber(Math.abs(n), 2))} %`;
}

// ───────────────────────── settings ─────────────────────────

export function phaseForGoal(goal: GoalType): EnergyPhase {
  return goal === 'lose' ? 'deficit' : goal === 'gain' ? 'surplus' : 'maintenance'; // recomp → maintenance
}

/** Defaults with phase and rate derived from the profile goal (mode stays 'off'). */
export function adaptiveSettingsForGoal(goal: GoalType): AdaptiveSettings {
  const phase = phaseForGoal(goal);
  return { ...DEFAULT_ADAPTIVE_SETTINGS, phase, targetRatePctPerWeek: PHASE_RATE_LIMITS[phase].default };
}

/** Clamp settings to safe ranges; unknown/NaN values fall back to defaults. Rate clamped to the phase limits. */
export function sanitizeAdaptiveSettings(s: AdaptiveSettings): AdaptiveSettings {
  const d = DEFAULT_ADAPTIVE_SETTINGS;
  const mode: AdaptiveMode = s.mode === 'suggest' || s.mode === 'auto' ? s.mode : 'off';
  const phase: EnergyPhase = s.phase === 'deficit' || s.phase === 'surplus' ? s.phase : 'maintenance';
  const lim = PHASE_RATE_LIMITS[phase];
  const windowDays = Math.round(clamp(finiteOr(s.windowDays, d.windowDays), 21, 91));
  return {
    mode,
    phase,
    targetRatePctPerWeek: clamp(finiteOr(s.targetRatePctPerWeek, lim.default), lim.min, lim.max),
    windowDays,
    minValidIntakeDays: Math.round(clamp(finiteOr(s.minValidIntakeDays, d.minValidIntakeDays), 7, windowDays)),
    minWeighIns: Math.round(clamp(finiteOr(s.minWeighIns, d.minWeighIns), 4, windowDays)),
    maxStepKcal: clamp(finiteOr(s.maxStepKcal, d.maxStepKcal), 50, 500),
    cooldownDays: Math.round(clamp(finiteOr(s.cooldownDays, d.cooldownDays), 7, 90)),
    energyPerKgKcal: clamp(finiteOr(s.energyPerKgKcal, d.energyPerKgKcal), 5000, 9500),
    minKcalFloor:
      typeof s.minKcalFloor === 'number' && Number.isFinite(s.minKcalFloor)
        ? clamp(s.minKcalFloor, ABSOLUTE_MIN_KCAL, 5000)
        : null,
  };
}

export function requiredValidIntakeDays(settings: AdaptiveSettings): number {
  const s = sanitizeAdaptiveSettings(settings);
  return Math.max(s.minValidIntakeDays, Math.ceil(MIN_INTAKE_COVERAGE * s.windowDays));
}

// ───────────────────────── weights ─────────────────────────

function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j]! - ys[i]!) / (xs[j]! - xs[i]!));
    }
  }
  const slope = slopes.length > 0 ? median(slopes) : 0;
  return { slope, intercept: median(ys.map((y, i) => y - slope * xs[i]!)) };
}

/**
 * Removes scale/water spikes (one-off readings, e.g. after a salty meal, travel or a misread scale).
 * Daily means are detrended with a Theil–Sen line (robust, so a real trend is never mistaken for spikes),
 * then each point is compared with the median of its neighbours in a centred rolling window of 7 points
 * (shifted at the edges, point itself left out; needs ≥ 5 points overall). A point is an outlier when
 * |residual| > 3.5 × max(1.4826·MAD, 0.3 kg), MAD taken over all residuals (modified z-score > 3.5).
 * Ordinary daily fluctuation stays in the series; it is noise for the regression, never tissue change.
 */
export function detectWeightOutliers(points: DatedPoint[]): { kept: DatedPoint[]; outliers: string[] } {
  const daily = dailyMean(points);
  const n = daily.length;
  if (n < OUTLIER_MIN_POINTS) return { kept: daily, outliers: [] };
  const xs = daily.map((p) => dayNumber(p.date));
  const ys = daily.map((p) => p.value);
  const { slope, intercept } = theilSen(xs, ys);
  const detrended = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  const size = Math.min(OUTLIER_WINDOW_POINTS, n);
  const half = Math.floor(OUTLIER_WINDOW_POINTS / 2);
  // Leave-one-out: the point itself is not part of its reference median (otherwise the residual is often
  // exactly 0, the MAD is biased low and ordinary fluctuation would be flagged).
  const residuals = detrended.map((v, i) => {
    const lo = Math.min(Math.max(0, i - half), n - size);
    const neighbours: number[] = [];
    for (let j = lo; j < lo + size; j++) if (j !== i) neighbours.push(detrended[j]!);
    return v - median(neighbours);
  });
  const scale = Math.max(MAD_TO_SD * median(residuals.map((r) => Math.abs(r))), MIN_WEIGHT_SCALE_KG);
  const kept: DatedPoint[] = [];
  const outliers: string[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(residuals[i]!) > OUTLIER_MAD_THRESHOLD * scale) outliers.push(daily[i]!.date);
    else kept.push(daily[i]!);
  }
  return { kept, outliers };
}

/**
 * OLS trend (kg/week) with its standard error. The SE is inflated by √((1+ρ)/(1−ρ)), ρ = lag-1
 * autocorrelation of the residuals clamped to [0, 0.8], because consecutive weigh-ins share water shifts.
 */
export function weightTrend(points: DatedPoint[]): { kgPerWeek: number; seKgPerWeek: number } | null {
  if (points.length < 3) return null;
  const kgPerWeek = linearTrendPerWeek(points);
  if (kgPerWeek === null) return null;
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const xs = sorted.map((p) => dayNumber(p.date));
  const ys = sorted.map((p) => p.value);
  const mx = mean(xs);
  const b = kgPerWeek / 7;
  const a = mean(ys) - b * mx;
  const res = ys.map((y, i) => y - (a + b * xs[i]!));
  const sxx = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
  const ssr = res.reduce((acc, r) => acc + r * r, 0);
  const se = Math.sqrt(ssr / (sorted.length - 2) / sxx);
  let rho = 0;
  if (ssr > 0 && res.length >= 4) {
    let lag = 0;
    for (let i = 1; i < res.length; i++) lag += res[i]! * res[i - 1]!;
    rho = clamp(lag / ssr, 0, 0.8);
  }
  return { kgPerWeek, seKgPerWeek: se * Math.sqrt((1 + rho) / (1 - rho)) * 7 };
}

// ───────────────────────── observed TDEE ─────────────────────────

function intakeExclusionReason(d: IntakeDay, kcal: number, lowKcal: number, highKcal: number): string | null {
  if (d.complete === false) return 'Marcado por ti como incompleto';
  if (kcal < 0) return 'Valor de kcal no válido';
  if (d.partial && d.complete !== true) return 'Hay alimentos sin kcal y el día no está confirmado como completo';
  if (kcal < lowKcal && d.complete !== true) {
    return `Solo ${f0(kcal)} kcal (menos de ${f0(lowKcal)}) y el día no está confirmado como completo`;
  }
  if (kcal > highKcal) return `${f0(kcal)} kcal parece un error de registro (más de ${f0(highKcal)})`;
  return null;
}

/**
 * Infers TDEE from the last `windowDays` (ending at `to`, inclusive) of intake and weigh-ins, and blends it
 * with the formula TDEE (prior SD 15 %) by inverse-variance weighting. Pure and stateless.
 */
export function estimateObservedTdee(args: {
  intake: IntakeDay[];
  weights: WeighIn[];
  to: string;
  formulaTdee: number;
  bmr: number;
  settings: AdaptiveSettings;
}): ObservedTdeeResult {
  const { intake, weights, to, formulaTdee, bmr } = args;
  assertPositive('El gasto por fórmula (kcal)', formulaTdee);
  assertPositive('La TMB (kcal)', bmr);
  const s = sanitizeAdaptiveSettings(args.settings);
  const W = s.windowDays;
  const from = addDays(to, -(W - 1));
  const inWindow = (date: string) => date >= from && date <= to;
  const E = s.energyPerKgKcal;
  const reasons: string[] = [];

  // History must reach back to the start of the window.
  let firstData: string | null = null;
  for (const d of intake) {
    if (d.entries > 0 && d.date <= to && (firstData === null || d.date < firstData)) firstData = d.date;
  }
  for (const w of weights) {
    if (isUsableWeighIn(w) && w.date <= to && (firstData === null || w.date < firstData)) firstData = w.date;
  }
  if (firstData === null) {
    reasons.push('Todavía no hay registros de comida ni de peso.');
  } else if (firstData > from) {
    reasons.push(
      `Aún no hay ${W} días de historial: los registros empiezan el ${formatDateEs(firstData)} y faltan ${daysBetween(from, firstData)} días para completar la ventana.`,
    );
  }

  // Intake: one record per date expected (if repeated, the last one wins).
  const byDate = new Map<string, IntakeDay>();
  for (const d of intake) if (inWindow(d.date)) byDate.set(d.date, d);
  const lowKcal = Math.max(800, 0.5 * bmr);
  const highKcal = Math.max(7000, 3 * formulaTdee);
  const valid: number[] = [];
  const excludedIntakeDays: { date: string; reason: string }[] = [];
  let missingIntakeDays = 0;
  for (const date of dateRange(from, to)) {
    const d = byDate.get(date);
    if (!d || !(d.entries > 0) || d.kcal === null || !Number.isFinite(d.kcal)) {
      missingIntakeDays++;
      continue;
    }
    const reason = intakeExclusionReason(d, d.kcal, lowKcal, highKcal);
    if (reason) excludedIntakeDays.push({ date, reason });
    else valid.push(d.kcal);
  }
  const required = requiredValidIntakeDays(s);
  if (valid.length < required) {
    reasons.push(
      `Solo hay ${valid.length} días con la comida completa en los últimos ${W} días; se necesitan al menos ${required}.`,
    );
  }

  // Weights: flags, daily means, spike removal.
  const usable = weights.filter((w) => inWindow(w.date) && isUsableWeighIn(w));
  const { kept, outliers } = detectWeightOutliers(usable.map((w) => ({ date: w.date, value: w.weightKg })));
  const span = kept.length > 0 ? daysBetween(kept[0]!.date, kept[kept.length - 1]!.date) : 0;
  if (kept.length < s.minWeighIns) {
    reasons.push(`Solo hay ${kept.length} días con un peso válido; se necesitan al menos ${s.minWeighIns}.`);
  }
  if (span < MIN_WEIGH_IN_SPAN_DAYS) {
    reasons.push(`Los pesos abarcan solo ${span} días; se necesitan al menos ${MIN_WEIGH_IN_SPAN_DAYS}.`);
  }

  const meanIntakeKcal = valid.length > 0 ? mean(valid) : null;
  const trend = weightTrend(kept);
  let rawImpliedTdee: number | null = null;
  let observationSe: number | null = null;
  if (meanIntakeKcal !== null && trend !== null) {
    rawImpliedTdee = meanIntakeKcal - (trend.kgPerWeek * E) / 7;
    const weightTerm = (trend.seKgPerWeek * E) / 7;
    const intakeTerm = sampleSd(valid) / Math.sqrt(valid.length);
    observationSe = Math.max(Math.sqrt(weightTerm ** 2 + intakeTerm ** 2), MIN_OBSERVATION_SE_KCAL);
  }

  const result: ObservedTdeeResult = {
    status: 'insufficient',
    reasons,
    window: { from, to, days: W },
    validIntakeDays: valid.length,
    requiredValidIntakeDays: required,
    missingIntakeDays,
    excludedIntakeDays,
    weighIns: kept.length,
    weighInSpanDays: span,
    outliersRemoved: outliers,
    meanIntakeKcal,
    trendKgPerWeek: trend?.kgPerWeek ?? null,
    trendSeKgPerWeek: trend?.seKgPerWeek ?? null,
    rawImpliedTdee,
    observedTdee: null,
    observedSe: null,
    blendedTdee: null,
    blendedSe: null,
    observationWeight: null,
    confidence: 'none',
  };
  if (reasons.length > 0 || rawImpliedTdee === null || observationSe === null || trend === null) {
    if (reasons.length === 0) reasons.push('No hay datos suficientes para calcular la tendencia del peso.');
    return result;
  }

  // Plausibility checks: an implausible result means the logs (not the metabolism) are off.
  const L = CONSISTENCY_LIMITS;
  if (rawImpliedTdee < L.minBmrFactor * bmr) {
    reasons.push(
      `El gasto calculado (${f0(rawImpliedTdee)} kcal) queda por debajo del 90 % de tu metabolismo basal estimado (${f0(bmr)} kcal); probablemente faltan comidas por registrar.`,
    );
  }
  if (rawImpliedTdee > L.maxFormulaFactor * formulaTdee) {
    reasons.push(
      `El gasto calculado (${f0(rawImpliedTdee)} kcal) es más de 1,8 veces el estimado por fórmula (${f0(formulaTdee)} kcal).`,
    );
  }
  if (Math.abs(rawImpliedTdee - formulaTdee) > L.maxFormulaDiffKcal) {
    reasons.push(
      `El gasto calculado (${f0(rawImpliedTdee)} kcal) se aleja más de ${f0(L.maxFormulaDiffKcal)} kcal del estimado por fórmula (${f0(formulaTdee)} kcal).`,
    );
  }
  const meanWeight = mean(kept.map((p) => p.value));
  const trendPct = (trend.kgPerWeek / meanWeight) * 100;
  if (Math.abs(trendPct) > L.maxTrendPctPerWeek) {
    reasons.push(
      `El peso cambia ${signedPct(trendPct)} por semana, más rápido de lo que puede cambiar el tejido; suele deberse a agua, a la báscula o a pesos mal registrados.`,
    );
  }
  const totalWeighDays = kept.length + outliers.length;
  if (outliers.length > Math.max(2, L.maxOutlierShare * totalWeighDays)) {
    reasons.push(
      `Hay demasiados pesos atípicos (${outliers.length} de ${totalWeighDays} días); revisa la báscula o los registros.`,
    );
  }
  if (reasons.length > 0) return { ...result, status: 'inconsistent' };

  const priorVar = (FORMULA_PRIOR_REL_SD * formulaTdee) ** 2;
  const obsVar = observationSe ** 2;
  const observationWeight = 1 / obsVar / (1 / obsVar + 1 / priorVar);
  const coverage = valid.length / W;
  const C = CONFIDENCE_RULES;
  const confidence: Confidence =
    observationSe <= C.high.maxSeKcal && coverage >= C.high.minCoverage
      ? 'high'
      : observationSe <= C.medium.maxSeKcal && coverage >= C.medium.minCoverage
        ? 'medium'
        : 'low';
  return {
    ...result,
    status: 'ok',
    observedTdee: rawImpliedTdee,
    observedSe: observationSe,
    blendedTdee: observationWeight * rawImpliedTdee + (1 - observationWeight) * formulaTdee,
    blendedSe: Math.sqrt(1 / (1 / obsVar + 1 / priorVar)),
    observationWeight,
    confidence,
  };
}

// ───────────────────────── targets & proposals ─────────────────────────

/**
 * Daily kcal for a desired rate of change: tdee + weightKg·(rate/100)·energyPerKg/7. Unrounded.
 * Static approximation: as weight changes, expenditure changes too; the adaptive loop corrects for that.
 */
export function targetForPhase(
  tdee: number,
  weightKg: number,
  ratePctPerWeek: number,
  energyPerKgKcal: number,
): number {
  return tdee + (weightKg * (ratePctPerWeek / 100) * energyPerKgKcal) / 7;
}

/**
 * Turns an observed-TDEE estimate into a calorie-target proposal. Precedence:
 * disabled → insufficient → inconsistent → cooldown → no_change → manual_locked → auto_apply | suggest.
 * The floor always wins over the step limit. 'auto' with low confidence is downgraded to 'suggest'.
 */
export function proposeAdjustment(args: {
  observed: ObservedTdeeResult;
  settings: AdaptiveSettings;
  currentKcal: number;
  currentWeightKg: number;
  bmr: number;
  sex: Sex;
  manualOverride: boolean;
  history: AdjustmentRecord[];
  today: string;
}): AdjustmentProposal {
  const { observed, currentKcal, currentWeightKg, bmr, sex, manualOverride, history, today } = args;
  assertPositive('Las kcal actuales', currentKcal);
  assertPositive('El peso actual (kg)', currentWeightKg);
  assertPositive('La TMB (kcal)', bmr);
  const s = sanitizeAdaptiveSettings(args.settings);
  const rateClamped = args.settings.targetRatePctPerWeek !== s.targetRatePctPerWeek;
  // Same orientative floor as the goal calculation (safetyFloorKcal in ./energy), unless set by the person.
  const floorRaw = s.minKcalFloor ?? safetyFloorKcal(sex, bmr);
  const floorKcal = Math.ceil(floorRaw / 10) * 10;
  const cur = f0(currentKcal);

  const base: AdjustmentProposal = {
    status: 'disabled',
    currentKcal,
    proposedKcal: null,
    deltaKcal: null,
    rawTargetKcal: null,
    limitedBy: [],
    nextEligibleDate: null,
    explanation: '',
    tdeeUsed: null,
    ratePctPerWeek: s.targetRatePctPerWeek,
    rateClamped,
    floorKcal,
    confidence: observed.confidence,
  };
  const out = (p: Partial<AdjustmentProposal>, text: string[]): AdjustmentProposal => ({
    ...base,
    ...p,
    explanation: [...text, DISCLAIMER].join(' '),
  });

  if (s.mode === 'off') {
    return out({ status: 'disabled' }, [`El ajuste adaptativo está desactivado; tu meta se mantiene en ${cur} kcal.`]);
  }
  if (observed.status !== 'ok' || observed.blendedTdee === null) {
    const status = observed.status === 'inconsistent' ? 'inconsistent' : 'insufficient';
    const why = observed.reasons.length > 0 ? ` ${observed.reasons.join(' ')}` : '';
    return out({ status }, [
      status === 'inconsistent'
        ? `Tus registros recientes no cuadran entre sí, así que no se propone ningún cambio.${why} Tu meta se mantiene en ${cur} kcal.`
        : `Aún no hay datos suficientes para estimar tu gasto real.${why} Mientras tanto tu meta se mantiene en ${cur} kcal.`,
    ]);
  }

  const tdee = observed.blendedTdee;
  const rate = s.targetRatePctPerWeek;
  const raw = targetForPhase(tdee, currentWeightKg, rate, s.energyPerKgKcal);
  const rawTargetKcal = round10(raw);
  const text: string[] = [
    `Con tus registros de los últimos ${s.windowDays} días, tu gasto diario estimado ronda las ${f0(round10(tdee))} kcal (confianza ${CONFIDENCE_LABELS[observed.confidence]}).`,
  ];
  if (s.phase === 'maintenance') {
    text.push(`Para mantener tu peso, la meta sería unas ${f0(rawTargetKcal)} kcal.`);
  } else {
    const kg = formatNumber((currentWeightKg * Math.abs(rate)) / 100, 2);
    const verb = s.phase === 'deficit' ? 'perder' : 'ganar';
    text.push(
      `Para ${verb} cerca de ${formatNumber(Math.abs(rate), 2)} % de tu peso por semana (≈ ${kg} kg), la meta sería unas ${f0(rawTargetKcal)} kcal.`,
    );
  }
  if (rateClamped) {
    text.push(
      `El ritmo elegido está fuera del rango seguro para la fase de ${PHASE_LABELS[s.phase].toLowerCase()}; se usa ${signedPct(rate)} por semana.`,
    );
  }

  // Cooldown: let water and glycogen settle after each change.
  const last = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1);
  if (last && daysBetween(last.date, today) < s.cooldownDays) {
    const next = addDays(last.date, s.cooldownDays);
    return out(
      { status: 'cooldown', rawTargetKcal, tdeeUsed: tdee, limitedBy: ['cooldown'], nextEligibleDate: next },
      [
        ...text,
        `Tu meta se ajustó el ${formatDateEs(last.date)}; se esperan ${s.cooldownDays} días entre ajustes para no reaccionar a cambios de agua. La próxima revisión será el ${formatDateEs(next)}.`,
      ],
    );
  }

  // Limits: floor first, then step, then floor again (floor beats step).
  const limitedBy: ('step' | 'floor' | 'cooldown')[] = [];
  let value = raw;
  if (value < floorKcal) {
    value = floorKcal;
    limitedBy.push('floor');
  }
  const lo = currentKcal - s.maxStepKcal;
  const hi = currentKcal + s.maxStepKcal;
  if (value > hi || value < lo) {
    value = clamp(value, lo, hi);
    limitedBy.push('step');
  }
  let proposed = round10(value);
  if (proposed > hi) proposed -= 10;
  if (proposed < lo) proposed += 10;
  if (proposed < floorKcal) {
    proposed = floorKcal;
    if (!limitedBy.includes('floor')) limitedBy.push('floor');
  }
  const delta = proposed - currentKcal;
  if (limitedBy.includes('step')) {
    text.push(`El cambio se limita a ${f0(s.maxStepKcal)} kcal por ajuste para que sea gradual.`);
  }
  if (limitedBy.includes('floor')) text.push(`No se baja de ${f0(floorKcal)} kcal, el mínimo de seguridad.`);

  const common = { rawTargetKcal, tdeeUsed: tdee, limitedBy };
  if (Math.abs(delta) < NO_CHANGE_THRESHOLD_KCAL && currentKcal >= floorKcal && !limitedBy.includes('step')) {
    return out({ ...common, status: 'no_change', proposedKcal: currentKcal, deltaKcal: 0 }, [
      ...text,
      `Tu meta actual de ${cur} kcal está a menos de ${NO_CHANGE_THRESHOLD_KCAL} kcal de lo calculado, así que no hace falta cambiarla.`,
    ]);
  }
  const change = `de ${cur} a ${f0(proposed)} kcal (${signedKcal(delta)})`;
  const proposal = { ...common, proposedKcal: proposed, deltaKcal: delta };
  if (manualOverride) {
    return out({ ...proposal, status: 'manual_locked' }, [
      ...text,
      `Tienes una meta manual, así que no se cambia sola; si quieres, puedes pasar ${change}.`,
    ]);
  }
  if (s.mode === 'auto' && observed.confidence !== 'low') {
    return out({ ...proposal, status: 'auto_apply' }, [...text, `Ajuste automático: tu meta pasa ${change}.`]);
  }
  const lowNote = s.mode === 'auto' ? ' La confianza es baja, así que solo se sugiere y no se aplica sola.' : '';
  return out({ ...proposal, status: 'suggest' }, [...text, `Te sugerimos pasar ${change}.${lowNote}`]);
}

/** Record to store once a proposal is applied (auto) or accepted by the user; null if nothing to apply. */
export function toAdjustmentRecord(
  p: AdjustmentProposal,
  today: string,
  applied: 'auto' | 'accepted',
): AdjustmentRecord | null {
  if (p.proposedKcal === null || p.tdeeUsed === null || p.deltaKcal === null || p.deltaKcal === 0) return null;
  if (applied === 'auto' ? p.status !== 'auto_apply' : !['suggest', 'auto_apply', 'manual_locked'].includes(p.status)) {
    return null;
  }
  return {
    date: today,
    fromKcal: p.currentKcal,
    toKcal: p.proposedKcal,
    tdee: round10(p.tdeeUsed),
    reason: `Ajuste adaptativo: gasto estimado ≈ ${f0(round10(p.tdeeUsed))} kcal, ritmo ${signedPct(p.ratePctPerWeek)} por semana (estimación a partir de registros de comida y peso).`,
    applied,
  };
}
