import { describe, expect, it } from 'vitest';
import { PROTOCOLS, SKINFOLD_SITES, bmi, brozek, computeBodyComp, ffmi, siri, whtr } from './bodycomp';
import type { SkinfoldSite } from './bodycomp';

const sf = (sites: SkinfoldSite[], each: number): Partial<Record<SkinfoldSite, number>> =>
  Object.fromEntries(sites.map((s) => [s, each]));

describe('basic indices', () => {
  it('bmi / whtr', () => {
    expect(bmi(70, 175)).toBeCloseTo(22.857, 3);
    expect(whtr(80, 160)).toBe(0.5);
  });
  it('ffmi', () => {
    const r = ffmi(80, 20, 180);
    expect(r.leanKg).toBeCloseTo(64);
    expect(r.ffmi).toBeCloseTo(19.753, 3);
    expect(r.normalized).toBeCloseTo(19.753, 3); // h = 1.8 → no correction
    const t = ffmi(80, 20, 170);
    expect(t.normalized).toBeCloseTo(64 / 1.7 ** 2 + 6.1 * 0.1, 6);
  });
  it('Siri and Brozek', () => {
    expect(siri(1.05)).toBeCloseTo(21.43, 2);
    expect(brozek(1.05)).toBeCloseTo(21.0, 1);
  });
});

describe('catalogs', () => {
  it('has 10 sites and 8 protocols', () => {
    expect(SKINFOLD_SITES).toHaveLength(10);
    expect(PROTOCOLS.map((p) => p.id)).toEqual([
      'jp7',
      'jp3_male',
      'jp3_female',
      'dw4',
      'isak7_calf',
      'isak7_thigh',
      'isak8',
      'sum_custom',
    ]);
    expect(PROTOCOLS.find((p) => p.id === 'jp7')!.sites).toHaveLength(7);
  });
});

describe('computeBodyComp', () => {
  const jp7Sites = PROTOCOLS.find((p) => p.id === 'jp7')!.sites;

  it('JP7 male S=100 mm, age 22 → D≈1.06766, 13.63 %', () => {
    // 7 sites; 100 mm total = 6 × 14 + 16
    const skinfolds = { ...sf(jp7Sites, 14), thigh: 16 };
    const r = computeBodyComp({ protocol: 'jp7', sex: 'male', ageYears: 22, skinfolds, weightKg: 80 });
    expect(r.sum).toBe(100);
    expect(r.density).toBeCloseTo(1.06766, 5);
    expect(r.bodyFatPct).toBeCloseTo(13.63, 2);
    expect(r.fatMassKg).toBeCloseTo(80 * 0.1363, 1);
    expect(r.leanMassKg).toBeCloseTo(80 - r.fatMassKg!, 6);
    expect(r.missingSites).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.method).toContain('Jackson & Pollock 7 pliegues (hombre): Σ=100 mm, edad 22 → D=1,0677');
    expect(r.method).toContain('13,6 %');
    expect(r.method).toContain('estimación');
  });

  it('JP7 female golden', () => {
    const r = computeBodyComp({ protocol: 'jp7', sex: 'female', ageYears: 30, skinfolds: sf(jp7Sites, 20) });
    // S=140: 1.097 − 0.0657594 + 0.010976 − 0.0038484 = 1.0383682
    expect(r.density).toBeCloseTo(1.0383682, 6);
    expect(r.bodyFatPct).toBeCloseTo(495 / 1.0383682 - 450, 6);
    expect(r.fatMassKg).toBeUndefined();
  });

  it('JP3 male golden (S=60, age 30)', () => {
    const r = computeBodyComp({ protocol: 'jp3_male', sex: 'male', ageYears: 30, skinfolds: sf(['chest', 'abdominal', 'thigh'], 20) });
    expect(r.sum).toBe(60);
    expect(r.density).toBeCloseTo(1.057816, 6);
  });

  it('JP3 female golden (S=60, age 30)', () => {
    const r = computeBodyComp({ protocol: 'jp3_female', sex: 'female', ageYears: 30, skinfolds: sf(['triceps', 'suprailiac', 'thigh'], 20) });
    expect(r.density).toBeCloseTo(1.0440221, 6);
  });

  it('JP3 protocol with wrong sex: warning and no estimate', () => {
    const r = computeBodyComp({ protocol: 'jp3_male', sex: 'female', ageYears: 30, skinfolds: sf(['chest', 'abdominal', 'thigh'], 20) });
    expect(r.bodyFatPct).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.sum).toBe(60);
  });

  it('DW4 male 25 y, S=40: D = 1.1631 − 0.0632·log10(40)', () => {
    const r = computeBodyComp({ protocol: 'dw4', sex: 'male', ageYears: 25, skinfolds: sf(['biceps', 'triceps', 'subscapular', 'suprailiac'], 10) });
    expect(r.density).toBeCloseTo(1.1631 - 0.0632 * Math.log10(40), 8);
    expect(r.density).toBeCloseTo(1.06185, 5);
    expect(r.bodyFatPct).toBeCloseTo(16.19, 1);
  });

  it('DW4 age brackets (women)', () => {
    const s = sf(['biceps', 'triceps', 'subscapular', 'suprailiac'], 10);
    const d = (age: number) => computeBodyComp({ protocol: 'dw4', sex: 'female', ageYears: age, skinfolds: s }).density!;
    const L = Math.log10(40);
    expect(d(18)).toBeCloseTo(1.1549 - 0.0678 * L, 8);
    expect(d(35)).toBeCloseTo(1.1423 - 0.0632 * L, 8);
    expect(d(45)).toBeCloseTo(1.1333 - 0.0612 * L, 8);
    expect(d(55)).toBeCloseTo(1.1339 - 0.0645 * L, 8);
  });

  it('age outside validity warns but still computes', () => {
    const jp = computeBodyComp({ protocol: 'jp7', sex: 'male', ageYears: 65, skinfolds: sf(jp7Sites, 10) });
    expect(jp.bodyFatPct).toBeDefined();
    expect(jp.warnings.length).toBeGreaterThan(0);
    const dw = computeBodyComp({ protocol: 'dw4', sex: 'male', ageYears: 15, skinfolds: sf(['biceps', 'triceps', 'subscapular', 'suprailiac'], 10) });
    expect(dw.bodyFatPct).toBeDefined();
    expect(dw.warnings.length).toBeGreaterThan(0);
  });

  it('missing sites: no estimate, sum null', () => {
    const r = computeBodyComp({ protocol: 'jp7', sex: 'male', ageYears: 30, skinfolds: { chest: 10, triceps: 10 } });
    expect(r.sum).toBeNull();
    expect(r.bodyFatPct).toBeUndefined();
    expect(r.missingSites).toEqual(['midaxillary', 'subscapular', 'abdominal', 'suprailiac', 'thigh']);
    expect(r.sitesUsed).toEqual(['chest', 'triceps']);
  });

  it('non-positive skinfold counts as missing', () => {
    const r = computeBodyComp({ protocol: 'jp3_male', sex: 'male', ageYears: 30, skinfolds: { chest: 10, abdominal: 0, thigh: 12 } });
    expect(r.missingSites).toEqual(['abdominal']);
  });

  it('ISAK protocols give sum only', () => {
    const sites = PROTOCOLS.find((p) => p.id === 'isak8')!.sites;
    const r = computeBodyComp({ protocol: 'isak8', sex: 'female', ageYears: 30, skinfolds: sf(sites, 7.5) });
    expect(r.sum).toBe(60);
    expect(r.equation).toBeNull();
    expect(r.bodyFatPct).toBeUndefined();
    expect(computeBodyComp({ protocol: 'isak7_calf', sex: 'male', ageYears: 30, skinfolds: { calf: 5 } }).sum).toBeNull();
  });

  it('sum_custom sums whatever is present', () => {
    const r = computeBodyComp({ protocol: 'sum_custom', sex: 'male', ageYears: 30, skinfolds: { chest: 10, calf: 5.5 } });
    expect(r.sum).toBe(15.5);
    expect(r.sitesUsed.sort()).toEqual(['calf', 'chest']);
    expect(computeBodyComp({ protocol: 'sum_custom', sex: 'male', ageYears: 30, skinfolds: {} }).sum).toBeNull();
  });
});
