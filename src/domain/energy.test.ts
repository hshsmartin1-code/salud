import { describe, expect, it } from 'vitest';
import { ACTIVITY_LEVELS, GOAL_LABELS, ageFromBirthDate, computeTargets, mifflinStJeor } from './energy';

describe('mifflinStJeor', () => {
  it('male 70 kg / 170 cm / 30 y', () => {
    expect(mifflinStJeor({ weightKg: 70, heightCm: 170, ageYears: 30, sex: 'male' })).toBe(1617.5);
  });
  it('female 60 kg / 165 cm / 25 y', () => {
    expect(mifflinStJeor({ weightKg: 60, heightCm: 165, ageYears: 25, sex: 'female' })).toBe(1345.25);
  });
});

describe('constants', () => {
  it('activity levels and goal labels', () => {
    expect(ACTIVITY_LEVELS.map((l) => l.factor)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
    expect(ACTIVITY_LEVELS[2]!.es).toBe('Moderada');
    expect(GOAL_LABELS.recomp).toBe('Recomposición');
  });
});

describe('ageFromBirthDate', () => {
  it('counts completed years', () => {
    expect(ageFromBirthDate('1996-11-14', '2026-11-14')).toBe(30);
    expect(ageFromBirthDate('1996-11-15', '2026-11-14')).toBe(29);
    expect(ageFromBirthDate('1996-12-01', '2026-11-14')).toBe(29);
    expect(ageFromBirthDate('2000-02-29', '2026-02-28')).toBe(25);
  });
});

describe('computeTargets', () => {
  const base = { weightKg: 70, heightCm: 170, ageYears: 30, sex: 'male', activity: 'moderate' } as const;

  it('lose: golden numbers', () => {
    const t = computeTargets({ ...base, goal: 'lose' });
    expect(t.bmr).toBe(1617.5);
    expect(t.tdee).toBeCloseTo(2507.125);
    expect(t.kcal).toBe(2107);
    expect(t.protein).toBe(126);
    expect(t.fat).toBe(63); // 2107*.27/9 = 63.2
    expect(t.carbs).toBe(Math.round((2107 - 4 * 126 - 9 * 63) / 4));
    expect(t.fiber).toBe(29);
    expect(t.warnings).toEqual([]);
    expect(t.inputs.deficitKcal).toBe(400);
    expect(t.method).toContain('TMB (Mifflin-St Jeor, hombre): 10×70 + 6,25×170 − 5×30 + 5 = 1.618 kcal');
    expect(t.method).toContain('Gasto total: 1.618 × 1,55 (Moderada) = 2.507 kcal');
    expect(t.method).toContain('Objetivo (Perder grasa): 2.507 − 400 = 2.107 kcal');
    expect(t.method).toContain('Proteína: 1,8 g/kg × 70 kg = 126 g');
    expect(t.method).toContain('Grasa: 27 % de las kcal = 63 g');
    expect(t.method).toContain('Carbohidratos: resto');
    expect(t.method).toContain('Fibra: 14 g por cada 1000 kcal = 29 g');
  });

  it('gain adds surplus, maintain/recomp use tdee', () => {
    expect(computeTargets({ ...base, goal: 'gain' }).kcal).toBe(Math.round(2507.125 + 250));
    expect(computeTargets({ ...base, goal: 'maintain' }).kcal).toBe(2507);
    const r = computeTargets({ ...base, goal: 'recomp' });
    expect(r.kcal).toBe(2507);
    expect(r.protein).toBe(140); // 2.0 g/kg default
  });

  it('female sex formula in method', () => {
    const t = computeTargets({ weightKg: 60, heightCm: 165, ageYears: 25, sex: 'female', activity: 'light', goal: 'maintain' });
    expect(t.bmr).toBe(1345.25);
    expect(t.method).toContain('mujer');
    expect(t.method).toContain('− 161');
  });

  it('clamps to BMR with a warning', () => {
    const t = computeTargets({ ...base, activity: 'sedentary', goal: 'lose', deficitKcal: 900 });
    // tdee = 1941; 1941 − 900 = 1041 < bmr
    expect(t.kcal).toBe(Math.round(1617.5));
    expect(t.warnings).toContain('El objetivo quedó por debajo del metabolismo basal; se ajustó a la TMB.');
  });

  it('carbs never negative', () => {
    const t = computeTargets({ ...base, goal: 'lose', proteinGPerKg: 4, fatPct: 0.6, deficitKcal: 1000 });
    expect(t.carbs).toBe(0);
    expect(t.warnings.some((w) => w.includes('carbohidratos'))).toBe(true);
  });

  it('respects overrides', () => {
    const t = computeTargets({ ...base, goal: 'maintain', proteinGPerKg: 2.2, fatPct: 0.3, fiberPer1000: 10 });
    expect(t.protein).toBe(154);
    expect(t.inputs.fatPct).toBe(0.3);
    expect(t.fiber).toBe(25);
  });

  it('validates inputs in Spanish', () => {
    expect(() => computeTargets({ ...base, weightKg: 0, goal: 'lose' })).toThrow(/peso/);
    expect(() => computeTargets({ ...base, heightCm: 50, goal: 'lose' })).toThrow(/estatura/);
    expect(() => computeTargets({ ...base, ageYears: NaN, goal: 'lose' })).toThrow(/edad/);
    expect(() => computeTargets({ ...base, goal: 'lose', deficitKcal: -5 })).toThrow(/déficit/);
  });
});
