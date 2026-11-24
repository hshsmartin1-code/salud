import { describe, expect, it } from 'vitest';
import { checkLabelDraft, convertLabel, type LabelDraft } from './labelConvert';

const base: LabelDraft = {
  basis: '100g',
  nutrients: {},
  servingSize: null,
  servingUnit: null,
  servingsPerPackage: null,
  packageSize: null,
  packageUnit: null,
};
const d = (over: Partial<LabelDraft>): LabelDraft => ({ ...base, ...over });

describe('convertLabel', () => {
  it('per 100 g is stored unchanged, with serving and package portions when stated', () => {
    const r = convertLabel(d({ basis: '100g', nutrients: { kcal: 400, protein: 8 }, servingSize: 30, servingUnit: 'g', packageSize: 300, packageUnit: 'g' }));
    expect(r.basis).toBe('100g');
    expect(r.nutrients).toEqual({ kcal: 400, protein: 8 });
    expect(r.portions).toEqual([
      ['1 porción', 30],
      ['Envase completo', 300],
    ]);
  });

  it('per 100 ml keeps ml portions and refuses to mix a gram serving', () => {
    const r = convertLabel(d({ basis: '100ml', nutrients: { kcal: 42 }, servingSize: 200, servingUnit: 'g' }));
    expect(r.basis).toBe('100ml');
    expect(r.portions).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/no se convierte entre peso y volumen/);
  });

  it('per serving with known weight converts to per 100 g exactly', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 120, protein: 8, sodium: 150 }, servingSize: 30, servingUnit: 'g' }));
    expect(r.basis).toBe('100g');
    expect(r.nutrients.kcal).toBeCloseTo(400, 6);
    expect(r.nutrients.protein).toBeCloseTo(26.6667, 3);
    expect(r.nutrients.sodium).toBeCloseTo(500, 6);
    expect(r.portions).toEqual([['1 porción', 30]]);
    expect(r.servingSize).toBe(30);
  });

  it('per serving with known volume converts to per 100 ml', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 90 }, servingSize: 250, servingUnit: 'ml' }));
    expect(r.basis).toBe('100ml');
    expect(r.nutrients.kcal).toBeCloseTo(36, 6);
  });

  it('per serving without weight stays per serving: no grams, no per 100 g', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 150 } }));
    expect(r.basis).toBe('serving');
    expect(r.nutrients).toEqual({ kcal: 150 });
    expect(r.portions).toEqual([]);
    expect(r.servingSize).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/solo se podrá registrar por porciones/);
  });

  it('per serving: package portion from serving size × servings per package', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 100 }, servingSize: 25, servingUnit: 'g', servingsPerPackage: 8 }));
    expect(r.portions).toEqual([
      ['1 porción', 25],
      ['Envase completo', 200],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('approximate servings per package are flagged when used for the package size', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 100 }, servingSize: 25, servingUnit: 'g', servingsPerPackage: 8, servingsPerPackageApprox: true }));
    expect(r.warnings.join(' ')).toMatch(/aproximadas/);
  });

  it('per package with package weight converts to per 100 g', () => {
    const r = convertLabel(d({ basis: 'package', nutrients: { kcal: 600, fat: 30 }, packageSize: 150, packageUnit: 'g' }));
    expect(r.basis).toBe('100g');
    expect(r.nutrients.kcal).toBeCloseTo(400, 6);
    expect(r.nutrients.fat).toBeCloseTo(20, 6);
    expect(r.portions).toEqual([['Envase completo', 150]]);
  });

  it('per package without weight but exact servings divides explicitly', () => {
    const r = convertLabel(d({ basis: 'package', nutrients: { kcal: 600 }, servingsPerPackage: 4 }));
    expect(r.basis).toBe('serving');
    expect(r.nutrients.kcal).toBeCloseTo(150, 6);
    expect(r.warnings.join(' ')).toMatch(/envase ÷ 4 porciones/);
  });

  it('per package with approximate servings is not divided: one serving = whole package', () => {
    const r = convertLabel(d({ basis: 'package', nutrients: { kcal: 600 }, servingsPerPackage: 4, servingsPerPackageApprox: true }));
    expect(r.basis).toBe('serving');
    expect(r.nutrients.kcal).toBe(600);
    expect(r.servingLabel).toBe('envase completo');
  });

  it('per package with nothing else: logged as whole package', () => {
    const r = convertLabel(d({ basis: 'package', nutrients: { kcal: 250 } }));
    expect(r.basis).toBe('serving');
    expect(r.servingLabel).toBe('envase completo');
    expect(r.nutrients.kcal).toBe(250);
  });

  it('missing nutrients stay missing after conversion (never 0)', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 120 }, servingSize: 30, servingUnit: 'g' }));
    expect('protein' in r.nutrients).toBe(false);
    expect('fiber' in r.nutrients).toBe(false);
  });

  it('a stated zero survives conversion as zero', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 120, transFat: 0 }, servingSize: 30, servingUnit: 'g' }));
    expect(r.nutrients.transFat).toBe(0);
  });

  it('keeps a custom serving label', () => {
    const r = convertLabel(d({ basis: 'serving', nutrients: { kcal: 60 }, servingSize: 12, servingUnit: 'g', servingLabel: '2 galletas' }));
    expect(r.portions[0]).toEqual(['2 galletas', 12]);
  });
});

describe('checkLabelDraft', () => {
  it('requires kcal', () => {
    expect(checkLabelDraft(d({ nutrients: { protein: 5 } })).errors).toContain('Falta la energía (kcal)');
  });
  it('rejects negative values', () => {
    expect(checkLabelDraft(d({ nutrients: { kcal: 10, fat: -1 } })).errors.length).toBe(1);
  });
  it('warns when macros exceed the basis (per-100 vs per-serving confusion)', () => {
    const w = checkLabelDraft(d({ basis: 'serving', nutrients: { kcal: 400, protein: 20, carbs: 60, fat: 15 }, servingSize: 30, servingUnit: 'g' })).warnings;
    expect(w.join(' ')).toMatch(/supera la base de 30/);
  });
  it('warns when kcal and kJ disagree (swapped units)', () => {
    const w = checkLabelDraft(d({ nutrients: { kcal: 502, kj: 120 } })).warnings;
    expect(w.join(' ')).toMatch(/kcal y los kJ no coinciden/);
  });
  it('accepts consistent kcal and kJ', () => {
    const w = checkLabelDraft(d({ nutrients: { kcal: 120, kj: 502, protein: 8, carbs: 15, fat: 3 } })).warnings;
    expect(w.join(' ')).not.toMatch(/kJ/);
  });
  it('warns when sodium looks like grams were read as milligrams', () => {
    const w = checkLabelDraft(d({ basis: 'serving', nutrients: { kcal: 100, sodium: 150000 }, servingSize: 30, servingUnit: 'g' })).warnings;
    expect(w.join(' ')).toMatch(/sodio parece demasiado alto/);
  });
  it('flags trans fat larger than total fat (mg vs g)', () => {
    const w = checkLabelDraft(d({ nutrients: { kcal: 100, fat: 2, transFat: 50 } })).warnings;
    expect(w.join(' ')).toMatch(/estaba en mg/);
  });
  it('kcal check uses available carbohydrate and fibre (no false warning on a high-fibre label)', () => {
    // Wheat-bran-like label per 100 g: the old 4·C(total) rule expected 358 kcal (−40 %).
    const bran = checkLabelDraft(d({ nutrients: { kcal: 216, protein: 15.55, fat: 4.25, carbs: 64.51, fiber: 42.8 } })).warnings;
    expect(bran.join(' ')).not.toMatch(/no coinciden con los macronutrientes/);
    const wrong = checkLabelDraft(d({ nutrients: { kcal: 500, protein: 15.55, fat: 4.25, carbs: 64.51, fiber: 42.8 } })).warnings;
    expect(wrong.join(' ')).toMatch(/esperadas ≈ 273 kcal/);
    // Missing macros still count as 0 on a label (existing rule), and tiny energies are not checked.
    expect(checkLabelDraft(d({ nutrients: { kcal: 300, protein: 10 } })).warnings.join(' ')).toMatch(/esperadas ≈ 40 kcal/);
    expect(checkLabelDraft(d({ nutrients: { kcal: 40, protein: 2 } })).warnings.join(' ')).not.toMatch(/no coinciden con los macronutrientes/);
  });
  it('flags available carbs above total carbs', () => {
    const w = checkLabelDraft(d({ nutrients: { kcal: 100, carbs: 10, carbsAvail: 12 } })).warnings;
    expect(w.join(' ')).toMatch(/disponibles superan/);
  });
});
