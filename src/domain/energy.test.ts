import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LEVELS,
  GOAL_LABELS,
  PAL_BANDS,
  ageFromBirthDate,
  computeTargets,
  energyRestriction,
  macroAdvisories,
  mifflinStJeor,
  safetyFloorKcal,
  schofieldBmr,
} from './energy';

describe('schofieldBmr (FAO/OMS/UNU 2004, Table 5.2; RIEN)', () => {
  it('uses the coefficients of each sex and age band', () => {
    expect(schofieldBmr({ weightKg: 70, ageYears: 25, sex: 'male' })).toBeCloseTo(15.057 * 70 + 692.2, 6);
    expect(schofieldBmr({ weightKg: 70, ageYears: 30, sex: 'male' })).toBeCloseTo(11.472 * 70 + 873.1, 6);
    expect(schofieldBmr({ weightKg: 70, ageYears: 59, sex: 'male' })).toBeCloseTo(11.472 * 70 + 873.1, 6);
    expect(schofieldBmr({ weightKg: 70, ageYears: 60, sex: 'male' })).toBeCloseTo(11.711 * 70 + 587.7, 6);
    expect(schofieldBmr({ weightKg: 60, ageYears: 25, sex: 'female' })).toBeCloseTo(14.818 * 60 + 486.6, 6); // 1375,7
    expect(schofieldBmr({ weightKg: 60, ageYears: 45, sex: 'female' })).toBeCloseTo(8.126 * 60 + 845.6, 6);
    expect(schofieldBmr({ weightKg: 60, ageYears: 70, sex: 'female' })).toBeCloseTo(9.082 * 60 + 658.5, 6);
    expect(() => schofieldBmr({ weightKg: 60, ageYears: 17, sex: 'female' })).toThrow();
  });
});

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
    expect(t.method).toContain('Gasto energético total estimado (GET): 1.618 × 1,55 (Moderada) = 2.507 kcal');
    expect(t.inputs.method).toBe('mifflin');
    expect(t.inputs.pal).toBe(1.55);
    expect(t.method).toContain('Mifflin y cols. 1990');
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

  it('clamps to the shared safety floor with a warning', () => {
    const t = computeTargets({ ...base, activity: 'sedentary', goal: 'lose', deficitKcal: 900 });
    // tdee = 1941; 1941 − 900 = 1041 < floor = max(BMR 1617,5, 1500) = 1617,5
    expect(t.kcal).toBe(Math.round(1617.5));
    expect(t.warnings.some((w) => w.startsWith('El objetivo quedó por debajo del mínimo de seguridad orientativo (1.618 kcal)'))).toBe(true);
  });

  it('safety floor: 1200 kcal for a small woman (previously only her BMR of 1044)', () => {
    // 45 y, 48 kg, 152 cm, sedentary: BMR 1044, TDEE 1252,8, − 400 = 852,8.
    const t = computeTargets({ weightKg: 48, heightCm: 152, ageYears: 45, sex: 'female', activity: 'sedentary', goal: 'lose' });
    expect(t.bmr).toBe(1044);
    expect(t.kcal).toBe(1200);
    expect(safetyFloorKcal('female', 1044)).toBe(1200);
    expect(safetyFloorKcal('male', 1617.5)).toBe(1617.5);
    expect(safetyFloorKcal('male', 900)).toBe(1500);
  });

  it('the floor never pushes a target above the estimated expenditure', () => {
    // 75 y, 50 kg, 160 cm, sedentary man: BMR 1130, TDEE 1356 < 1500.
    const keep = computeTargets({ weightKg: 50, heightCm: 160, ageYears: 75, sex: 'male', activity: 'sedentary', goal: 'maintain' });
    expect(keep.kcal).toBe(1356);
    const lose = computeTargets({ weightKg: 50, heightCm: 160, ageYears: 75, sex: 'male', activity: 'sedentary', goal: 'lose' });
    expect(lose.kcal).toBe(1356);
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

  it('RIEN Colombia: Schofield × PAL (FAO/OMS/UNU 2004), band midpoint', () => {
    const t = computeTargets({ weightKg: 70, heightCm: 170, ageYears: 25, sex: 'male', method: 'rien', palBand: 'light', goal: 'maintain' });
    expect(t.bmr).toBeCloseTo(15.057 * 70 + 692.2, 6); // 1746,19
    expect(t.tdee).toBeCloseTo((15.057 * 70 + 692.2) * 1.55, 6);
    expect(t.kcal).toBe(Math.round((15.057 * 70 + 692.2) * 1.55)); // 2707
    expect(t.inputs).toMatchObject({ method: 'rien', palBand: 'light', pal: 1.55, activity: 'moderate' });
    expect(t.method).toContain('TMB (Schofield, FAO/OMS/UNU; RIEN Res. 3803/2016, hombre de 18–30 años): 15,057×70 + 692,2 = 1.746 kcal');
    expect(t.method).toContain('PAL ligera o sedentaria, punto medio de 1,40–1,69');
    // Mifflin stays the default and is unchanged.
    expect(computeTargets({ ...base, goal: 'maintain' }).kcal).toBe(2507);
  });

  it('RIEN needs an adult and a PAL band', () => {
    expect(() => computeTargets({ weightKg: 55, heightCm: 160, ageYears: 16, sex: 'female', method: 'rien', palBand: 'light', goal: 'maintain' })).toThrow(/18 años/);
    expect(() => computeTargets({ weightKg: 55, heightCm: 160, ageYears: 30, sex: 'female', method: 'rien', goal: 'maintain' })).toThrow(/PAL/);
    expect(PAL_BANDS.map((b) => [b.min, b.max, b.pal])).toEqual([
      [1.4, 1.69, 1.55],
      [1.7, 1.99, 1.85],
      [2.0, 2.4, 2.2],
    ]);
  });

  it('under 18, pregnancy and lactation: no deficit, with the reason', () => {
    const teen = computeTargets({ weightKg: 55, heightCm: 160, ageYears: 16, sex: 'female', activity: 'light', goal: 'lose' });
    expect(teen.kcal).toBe(Math.round(teen.tdee));
    expect(teen.warnings.some((w) => /Menor de 18 años/.test(w))).toBe(true);
    const preg = computeTargets({ weightKg: 62, heightCm: 160, ageYears: 30, sex: 'female', activity: 'light', goal: 'lose', physiologicalState: 'pregnant' });
    expect(preg.kcal).toBe(Math.round(preg.tdee));
    expect(preg.method).toContain('sin déficit (embarazo)');
    expect(preg.warnings[0]).toMatch(/^Embarazo:/);
    const lact = computeTargets({ weightKg: 62, heightCm: 160, ageYears: 30, sex: 'female', activity: 'light', goal: 'maintain', physiologicalState: 'lactating' });
    expect(lact.warnings[0]).toMatch(/^Lactancia:/);
    expect(computeTargets({ weightKg: 62, heightCm: 160, ageYears: 30, sex: 'female', activity: 'light', goal: 'lose', physiologicalState: 'none' }).kcal).toBe(Math.round(preg.tdee - 400));
    expect(energyRestriction({ ageYears: 18 })).toBeNull();
    expect(energyRestriction({ ageYears: 17 })?.key).toBe('minor');
    expect(energyRestriction({ ageYears: null, physiologicalState: 'lactating' })?.key).toBe('lactating');
  });

  it('non-blocking advisories: RDA protein, fat AMDR, carbohydrate RDA, reference weight with BMI ≥ 30', () => {
    const low = computeTargets({ ...base, goal: 'maintain', proteinGPerKg: 0.6, fatPct: 0.15 });
    expect(low.protein).toBe(42);
    expect(low.warnings.some((w) => /RDA para adultos: 0,8 g\/kg/.test(w))).toBe(true);
    expect(low.warnings.some((w) => /grasa aporta 15 %/.test(w))).toBe(true);
    const high = macroAdvisories({ kcal: 2000, protein: 120, fat: 89, carbs: 120, weightKg: 70, heightCm: 170 });
    expect(high.some((w) => /grasa aporta 40 %/.test(w))).toBe(true);
    expect(high.some((w) => /Los carbohidratos \(120 g\)/.test(w))).toBe(true);
    // 120 kg, 170 cm: BMI 41,5 → reference weight 25 × 1,7² = 72,25 kg.
    const obese = computeTargets({ weightKg: 120, heightCm: 170, ageYears: 40, sex: 'male', activity: 'light', goal: 'maintain' });
    expect(obese.protein).toBe(216); // never changed silently
    expect(obese.warnings.some((w) => /IMC 41,5/.test(w) && /72,3 kg/.test(w) && /≈ 130 g/.test(w))).toBe(true);
    // Defaults in a normal case: no advisory at all.
    expect(macroAdvisories({ kcal: 2507, protein: 126, fat: 75, carbs: 332, weightKg: 70, heightCm: 170 })).toEqual([]);
  });

  it('validates inputs in Spanish', () => {
    expect(() => computeTargets({ ...base, weightKg: 0, goal: 'lose' })).toThrow(/peso/);
    expect(() => computeTargets({ ...base, heightCm: 50, goal: 'lose' })).toThrow(/estatura/);
    expect(() => computeTargets({ ...base, ageYears: NaN, goal: 'lose' })).toThrow(/edad/);
    expect(() => computeTargets({ ...base, goal: 'lose', deficitKcal: -5 })).toThrow(/déficit/);
  });
});
