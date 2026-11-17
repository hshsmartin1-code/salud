import { describe, expect, it } from 'vitest';
import type { NutrientCode } from '../db/catalogTypes';
import { parseLabelText } from './labelText';
import type { LabelColumnBasis, ParsedLabel, ParsedNutrient } from './labelText';
import evaluationFixtures from '../../scripts/fixtures/ocr-text-evaluation.json';

function get(p: ParsedLabel, code: NutrientCode, basis?: LabelColumnBasis): ParsedNutrient | undefined {
  return p.nutrients.find((n) => n.code === code && (basis === undefined || n.basis === basis));
}

const hasWarning = (p: ParsedLabel, re: RegExp): boolean => p.warnings.some((w) => re.test(w));

describe('parseLabelText: ejemplo simple (sin encabezado de columnas)', () => {
  const p = parseLabelText(`Información nutricional
Tamaño de porción: 30 g
Calorías: 120 kcal
Proteína: 8 g
Carbohidratos: 15 g
Grasas totales: 3 g
Fibra: 2 g
Sodio: 150 mg`);

  it('infers the serving basis and warns about it', () => {
    expect(p.columns).toEqual(['serving']);
    expect(p.basisInferred).toBe(true);
    expect(hasWarning(p, /encabezado de columnas.*por porción/)).toBe(true);
  });
  it('reads the serving size', () => {
    expect(p.servingSize).toBe(30);
    expect(p.servingUnit).toBe('g');
    expect(p.servingLabel).toBe('30 g');
    expect(p.servingsPerPackage).toBeNull();
    expect(p.packageSize).toBeNull();
  });
  it('reads exactly the printed nutrients, nothing else', () => {
    expect(p.byBasis).toEqual({ serving: { kcal: 120, protein: 8, carbs: 15, fat: 3, fiber: 2, sodium: 150 } });
    expect(p.nutrients).toHaveLength(6);
    expect(p.unrecognizedLines).toEqual([]);
  });
  it('flags plain "Carbohidratos" (total vs available unknown) but not the rest', () => {
    const carbs = get(p, 'carbs')!;
    expect(carbs.uncertain).toBe(true);
    expect(carbs.note).toMatch(/totales o disponibles/);
    expect(get(p, 'carbsAvail')).toBeUndefined();
    for (const code of ['kcal', 'protein', 'fat', 'fiber', 'sodium'] as const) {
      expect(get(p, code)?.uncertain).toBe(false);
    }
  });
  it('keeps source text and printed unit', () => {
    const na = get(p, 'sodium')!;
    expect(na).toMatchObject({ basis: 'serving', sourceText: 'Sodio: 150 mg', sourceUnit: 'mg', converted: false });
    expect(get(p, 'kcal')?.sourceUnit).toBe('kcal');
  });
});

describe('parseLabelText: etiqueta colombiana (Res. 810) de dos columnas', () => {
  const p = parseLabelText(`Información Nutricional
Tamaño de porción: 1 unidad (30 g)
Número de porciones por envase: aprox. 10
                      Por 100 g     Por porción
Calorías (kcal)       450           135
Grasa total           20 g          6 g
Grasa saturada        8 g           2,4 g
Grasas trans          150 mg        45 mg
Carbohidratos totales 60 g          18 g
Fibra dietaria        3 g           0,9 g
Azúcares totales      25 g          7,5 g
Azúcares añadidos     20 g          6 g
Proteína              6 g           1,8 g
Sodio                 300 mg        90 mg`);

  it('detects both columns in printed order', () => {
    expect(p.columns).toEqual(['100g', 'serving']);
    expect(p.basisInferred).toBe(false);
  });
  it('reads serving metadata, including approximate servings per package', () => {
    expect(p.servingSize).toBe(30);
    expect(p.servingUnit).toBe('g');
    expect(p.servingLabel).toBe('1 unidad (30 g)');
    expect(p.servingsPerPackage).toBe(10);
    expect(p.servingsPerPackageApprox).toBe(true);
  });
  it('assigns every value to its own column', () => {
    expect(p.byBasis['100g']).toEqual({
      kcal: 450,
      fat: 20,
      satFat: 8,
      transFat: 0.15,
      carbs: 60,
      fiber: 3,
      sugars: 25,
      addedSugars: 20,
      protein: 6,
      sodium: 300,
    });
    expect(p.byBasis.serving).toEqual({
      kcal: 135,
      fat: 6,
      satFat: 2.4,
      transFat: 0.045,
      carbs: 18,
      fiber: 0.9,
      sugars: 7.5,
      addedSugars: 6,
      protein: 1.8,
      sodium: 90,
    });
    expect(p.unrecognizedLines).toEqual([]);
  });
  it('converts trans fat from mg to g', () => {
    const trans = get(p, 'transFat', '100g')!;
    expect(trans).toMatchObject({ value: 0.15, sourceUnit: 'mg', converted: true, uncertain: false });
    expect(trans.note).toMatch(/Convertido/);
  });
  it('uses the header unit "(kcal)" and does not flag "Carbohidratos totales"', () => {
    expect(get(p, 'kcal', 'serving')).toMatchObject({ value: 135, sourceUnit: 'kcal', uncertain: false });
    expect(get(p, 'carbs', '100g')?.uncertain).toBe(false);
  });
});

describe('parseLabelText: etiqueta estilo EE. UU. traducida, con %VD', () => {
  const p = parseLabelText(`Datos de Nutrición
8 porciones por envase
Tamaño por porción 2/3 de taza (55 g)
Cantidad por porción
Calorías 230
% Valor Diario*
Grasa Total 8 g 10%
Grasa Saturada 1 g 5%
Grasas Trans 0 g
Colesterol 0 mg 0%
Sodio 160 mg 7%
Carbohidratos Totales 37 g 13%
Fibra Dietética 4 g 14%
Azúcares Totales 12 g
Incluye 10 g de azúcares añadidos 20%
Proteína 3 g
Vitamina D 2 mcg 10%
Calcio 260 mg 20%
Hierro 8 mg 45%
Potasio 240 mg 6%
* El % de Valor Diario (VD) le indica cuánto contribuye un nutriente de una porción de alimento a una dieta diaria. 2.000 calorías al día se utilizan para asesoría general de nutrición.`);

  it('reads the per-serving column and serving metadata', () => {
    expect(p.columns).toEqual(['serving']);
    expect(p.basisInferred).toBe(false);
    expect(p.servingsPerPackage).toBe(8);
    expect(p.servingsPerPackageApprox).toBe(false);
    expect(p.servingSize).toBe(55);
    expect(p.servingLabel).toBe('2/3 de taza (55 g)');
  });
  it('never reads %VD as an amount', () => {
    expect(p.byBasis.serving).toEqual({
      kcal: 230,
      fat: 8,
      satFat: 1,
      transFat: 0,
      cholesterol: 0,
      sodium: 160,
      carbs: 37,
      fiber: 4,
      sugars: 12,
      addedSugars: 10,
      protein: 3,
      vitD: 2,
      calcium: 260,
      iron: 8,
      potassium: 240,
    });
    expect(p.unrecognizedLines).toEqual([]);
  });
  it('"Calorías" implies kcal; "mcg" is µg', () => {
    expect(get(p, 'kcal')).toMatchObject({ value: 230, sourceUnit: null, uncertain: false });
    expect(get(p, 'vitD')).toMatchObject({ value: 2, sourceUnit: 'mcg', converted: false });
  });
});

describe('parseLabelText: etiqueta europea', () => {
  const p = parseLabelText(`Información nutricional
Valores medios por 100 g
Valor energético 1046 kJ / 250 kcal
Grasas 10 g
de las cuales saturadas 3,2 g
Hidratos de carbono 30 g
de los cuales azúcares 12 g
Fibra alimentaria 2,5 g
Proteínas 8 g
Sal 0,75 g`);

  it('reads kJ and kcal from the same line without converting either', () => {
    expect(get(p, 'kj')).toMatchObject({ value: 1046, sourceUnit: 'kJ', converted: false, uncertain: false });
    expect(get(p, 'kcal')).toMatchObject({ value: 250, sourceUnit: 'kcal', converted: false, uncertain: false });
    expect(hasWarning(p, /solo aparece en kJ/)).toBe(false);
  });
  it('reads sub-rows ("de las cuales", "de los cuales") and derives sodium from salt', () => {
    expect(p.columns).toEqual(['100g']);
    expect(p.byBasis['100g']).toEqual({
      kj: 1046,
      kcal: 250,
      fat: 10,
      satFat: 3.2,
      carbs: 30,
      sugars: 12,
      fiber: 2.5,
      protein: 8,
      sodium: 300,
    });
    expect(p.unrecognizedLines).toEqual([]);
  });
  it('"Hidratos de carbono" → carbs, uncertain, never carbsAvail', () => {
    expect(get(p, 'carbs')).toMatchObject({ value: 30, uncertain: true });
    expect(get(p, 'carbs')?.note).toMatch(/disponibles/);
    expect(get(p, 'carbsAvail')).toBeUndefined();
  });
  it('marks salt-derived sodium as converted and uncertain', () => {
    const na = get(p, 'sodium')!;
    expect(na).toMatchObject({ value: 300, converted: true, uncertain: true, sourceText: 'Sal 0,75 g', sourceUnit: 'g' });
    expect(na.note).toMatch(/sal/i);
    expect(hasWarning(p, /sodio se calculó a partir de la sal/)).toBe(true);
  });
  it('keeps printed sodium when both salt and sodium appear', () => {
    const q = parseLabelText('Por 100 g\nSodio 280 mg\nSal 0,75 g');
    expect(q.byBasis['100g']).toEqual({ sodium: 280 });
    expect(q.nutrients).toHaveLength(1);
  });
  it('handles "Grasas 10 g, de las cuales saturadas 3 g" on one line', () => {
    const q = parseLabelText('Por 100 g\nGrasas 10 g, de las cuales saturadas 3 g');
    expect(q.byBasis['100g']).toEqual({ fat: 10, satFat: 3 });
  });
  it('two columns with kJ and kcal on separate lines', () => {
    const q = parseLabelText(`Por 100 g    Por porción (30 g)
Valor energético    1046 kJ    314 kJ
250 kcal    75 kcal
Grasas    10 g    3 g`);
    expect(q.columns).toEqual(['100g', 'serving']);
    expect(q.servingSize).toBe(30);
    expect(q.byBasis['100g']).toEqual({ kj: 1046, kcal: 250, fat: 10 });
    expect(q.byBasis.serving).toEqual({ kj: 314, kcal: 75, fat: 3 });
  });
});

describe('parseLabelText: bases de columna', () => {
  it('per package only', () => {
    const p = parseLabelText(`Información nutricional
Por envase (250 ml)
Energía 110 kcal
Proteína 3 g
Azúcares totales 20 g
Sodio 50 mg`);
    expect(p.columns).toEqual(['package']);
    expect(p.basisInferred).toBe(false);
    expect(p.packageSize).toBe(250);
    expect(p.packageUnit).toBe('ml');
    expect(p.byBasis).toEqual({ package: { kcal: 110, protein: 3, sugars: 20, sodium: 50 } });
  });
  it('per 100 ml, with net content in litres', () => {
    const p = parseLabelText('Contenido neto: 1 L\nPor 100 ml\nEnergía 42 kcal\nAzúcares 10,6 g');
    expect(p.packageSize).toBe(1000);
    expect(p.packageUnit).toBe('ml');
    expect(p.columns).toEqual(['100ml']);
    expect(p.byBasis['100ml']).toEqual({ kcal: 42, sugars: 10.6 });
  });
  it('net content in grams', () => {
    const p = parseLabelText('Contenido neto: 500 g\nPor 100 g\nProteína 8 g');
    expect(p.packageSize).toBe(500);
    expect(p.packageUnit).toBe('g');
  });
  it('no header and no serving size → per 100 g with a warning', () => {
    const p = parseLabelText('Proteína 8 g\nGrasa total 3 g');
    expect(p.columns).toEqual(['100g']);
    expect(p.basisInferred).toBe(true);
    expect(hasWarning(p, /por 100 g/)).toBe(true);
    expect(p.byBasis['100g']).toEqual({ protein: 8, fat: 3 });
  });
  it('no header but several values per row → nothing imported (never mix columns)', () => {
    const p = parseLabelText('Proteína 8 g 2,4 g\nGrasa total 3 g 1 g');
    expect(p.nutrients).toEqual([]);
    expect(p.unrecognizedLines).toEqual(['Proteína 8 g 2,4 g', 'Grasa total 3 g 1 g']);
    expect(hasWarning(p, /varios valores/)).toBe(true);
  });
  it('a row with fewer values than columns is not imported', () => {
    const p = parseLabelText('Por 100 g | Por porción\nProteína 8 g\nGrasa total 3 g | 1 g');
    expect(get(p, 'protein')).toBeUndefined();
    expect(p.unrecognizedLines).toEqual(['Proteína 8 g']);
    expect(hasWarning(p, /1 valor para 2 columnas/)).toBe(true);
    expect(p.byBasis).toEqual({ '100g': { fat: 3 }, serving: { fat: 1 } });
  });
  it('"Por porción de 30 g" gives the serving size', () => {
    const p = parseLabelText('Por 100 g | Por porción de 30 g\nProteína | 10 g | 3 g');
    expect(p.servingSize).toBe(30);
    expect(p.servingUnit).toBe('g');
    expect(p.byBasis).toEqual({ '100g': { protein: 10 }, serving: { protein: 3 } });
  });
  it('tab-separated cells', () => {
    const p = parseLabelText('Nutriente\tPor 100 g\tPor porción\nProteína\t8 g\t2,4 g');
    expect(p.byBasis).toEqual({ '100g': { protein: 8 }, serving: { protein: 2.4 } });
  });
  it('a header split over two lines ("Por 100 g" / "Porción 30 g")', () => {
    const p = parseLabelText('Por 100 g\nPorción 30 g\nProteína 10 g 3 g');
    expect(p.columns).toEqual(['100g', 'serving']);
    expect(p.servingSize).toBe(30);
    expect(p.byBasis).toEqual({ '100g': { protein: 10 }, serving: { protein: 3 } });
  });
  it('a basis printed in the row wins over the table columns', () => {
    const p = parseLabelText('Por 100 g\nProteína 8 g\nCalorías por porción 120');
    expect(p.byBasis).toEqual({ '100g': { protein: 8 }, serving: { kcal: 120 } });
    expect(p.columns).toEqual(['100g', 'serving']);
  });
  it('"Por porción: 120 kcal" is not mistaken for a column header', () => {
    const p = parseLabelText('Por porción: 120 kcal\nProteína 8 g');
    expect(p.unrecognizedLines).toEqual(['Por porción: 120 kcal']);
    expect(p.basisInferred).toBe(true);
  });
  it('"Por 100 g o 100 ml" resolves with the package unit and warns', () => {
    const p = parseLabelText('Contenido neto 350 ml\nPor 100 g o 100 ml | Por porción (250 ml)\nEnergía 42 kcal 105 kcal');
    expect(p.columns).toEqual(['100ml', 'serving']);
    expect(p.servingSize).toBe(250);
    expect(p.servingUnit).toBe('ml');
    expect(p.byBasis).toEqual({ '100ml': { kcal: 42 }, serving: { kcal: 105 } });
    expect(hasWarning(p, /100 g o 100 ml/)).toBe(true);
  });
  it('"por unidad" is taken as a serving, with a warning', () => {
    const p = parseLabelText('Por unidad (25 g)\nProteína 2 g');
    expect(p.columns).toEqual(['serving']);
    expect(p.servingSize).toBe(25);
    expect(hasWarning(p, /por unidad/)).toBe(true);
  });
});

describe('parseLabelText: energía', () => {
  it('only kJ printed → kj only, plus a warning to confirm kcal', () => {
    const p = parseLabelText('Por 100 g\nEnergía 1046 kJ\nGrasas 10 g');
    expect(p.byBasis['100g']).toEqual({ kj: 1046, fat: 10 });
    expect(get(p, 'kcal')).toBeUndefined();
    expect(hasWarning(p, /solo aparece en kJ.*kcal/)).toBe(true);
    expect(hasWarning(p, /4,184/)).toBe(true);
  });
  it('energy without a printed unit → kcal assumed, uncertain', () => {
    const p = parseLabelText('Por 100 g\nEnergía 120');
    expect(get(p, 'kcal')).toMatchObject({ value: 120, uncertain: true, sourceUnit: null });
    expect(get(p, 'kcal')?.note).toMatch(/kJ/);
  });
  it('kcal first, kJ in parentheses', () => {
    const p = parseLabelText('Por porción\nCalorías 120 kcal (502 kJ)');
    expect(p.byBasis.serving).toEqual({ kcal: 120, kj: 502 });
  });
  it('"(kJ/kcal)" header unit with "1046/250" pairs in two columns', () => {
    const p = parseLabelText('Por 100 g | Por porción\nEnergía (kJ/kcal) 1046/250 314/75');
    expect(p.byBasis).toEqual({ '100g': { kj: 1046, kcal: 250 }, serving: { kj: 314, kcal: 75 } });
  });
  it('one kJ/kcal pair for two columns is not guessed', () => {
    const p = parseLabelText('Por 100 g | Por porción\nEnergía 1046 kJ / 250 kcal');
    expect(p.nutrients).toEqual([]);
    expect(p.unrecognizedLines).toEqual(['Energía 1046 kJ / 250 kcal']);
  });
  it('"Calorías de grasa" is not total energy', () => {
    const p = parseLabelText('Por porción\nCalorías 120\nCalorías de grasa 45');
    expect(p.byBasis.serving).toEqual({ kcal: 120 });
    expect(p.unrecognizedLines).toEqual([]);
  });
});

describe('parseLabelText: formatos de número', () => {
  it('decimal comma, decimal point and thousands separators', () => {
    const p = parseLabelText(`Por 100 g
Proteína 2,5 g
Grasa total 2.5 g
Sodio 1.250 mg
Energía 1 250 kJ / 299 kcal`);
    expect(p.byBasis['100g']).toEqual({ protein: 2.5, fat: 2.5, sodium: 1250, kj: 1250, kcal: 299 });
  });
  it('dot thousands with mg/µg/kJ/kcal are not uncertain; comma thousands need confirmation', () => {
    const p = parseLabelText('Por 100 g\nSodio 1.250 mg\nPotasio 1,200 mg\nEnergía 1.046 kJ');
    expect(get(p, 'sodium')).toMatchObject({ value: 1250, uncertain: false });
    // A manual "1,200" is 1,2 (comma = decimal): the OCR keeps 1200 but asks the person to confirm.
    expect(get(p, 'potassium')).toMatchObject({ value: 1200, uncertain: true });
    expect(get(p, 'potassium')?.note).toMatch(/Confírmalo/);
    expect(get(p, 'kj')).toMatchObject({ value: 1046, uncertain: false });
  });
  it('a comma read as thousands is uncertain when the label uses decimal commas elsewhere', () => {
    const p = parseLabelText('Por 100 g\nProteína 2,5 g\nPotasio 1,250 mg');
    expect(get(p, 'potassium')).toMatchObject({ value: 1250, uncertain: true });
    expect(get(p, 'potassium')?.note).toMatch(/miles/);
  });
  it('separator + 3 digits with g is ambiguous: plausible decimal reading, uncertain', () => {
    const p = parseLabelText('Por 100 g\nCarbohidratos totales 1.250 g');
    expect(get(p, 'carbs')).toMatchObject({ value: 1.25, uncertain: true });
    expect(get(p, 'carbs')?.note).toMatch(/ambiguo/);
  });
  it('"0,250 g" is a plain decimal', () => {
    const p = parseLabelText('Por 100 g\nGrasa trans 0,250 g');
    expect(get(p, 'transFat')).toMatchObject({ value: 0.25, uncertain: false });
  });
  it('sodium printed in g is converted to mg', () => {
    const p = parseLabelText('Por 100 g\nSodio 0,15 g');
    expect(get(p, 'sodium')).toMatchObject({ value: 150, sourceUnit: 'g', converted: true, uncertain: false });
  });
  it('µg / ug / mcg', () => {
    const p = parseLabelText('Por 100 g\nVitamina B12 0,9 µg\nVitamina D 5 ug\nFolato 0,2 mg');
    expect(get(p, 'vitB12')).toMatchObject({ value: 0.9, sourceUnit: 'µg', converted: false });
    expect(get(p, 'vitD')).toMatchObject({ value: 5, sourceUnit: 'µg' });
    expect(get(p, 'folate')).toMatchObject({ value: 200, sourceUnit: 'mg', converted: true });
  });
});

describe('parseLabelText: menor que, trazas, ceros y ausentes', () => {
  const p = parseLabelText(`Por 100 g
Grasa trans <0,5 g
Azúcares menos de 1 g
Fibra trazas
Colesterol tr`);

  it('"<0,5 g" / "menos de 1 g" store the number, uncertain', () => {
    expect(get(p, 'transFat')).toMatchObject({ value: 0.5, uncertain: true, qualifier: 'lessThan' });
    expect(get(p, 'transFat')?.note).toMatch(/menor que/);
    expect(get(p, 'sugars')).toMatchObject({ value: 1, uncertain: true, qualifier: 'lessThan' });
  });
  it('"trazas" / "tr" → 0, uncertain', () => {
    expect(get(p, 'fiber')).toMatchObject({ value: 0, uncertain: true, qualifier: 'traces' });
    expect(get(p, 'cholesterol')).toMatchObject({ value: 0, uncertain: true, qualifier: 'traces' });
  });
  it('explicit "0 g" is a real zero; missing nutrients stay absent', () => {
    const q = parseLabelText('Por porción\nCalorías 90 kcal\nGrasa total 0 g\nProteína 0 g');
    expect(q.byBasis).toEqual({ serving: { kcal: 90, fat: 0, protein: 0 } });
    expect(get(q, 'fat')).toMatchObject({ value: 0, uncertain: false });
    expect(q.byBasis.serving).not.toHaveProperty('carbs');
    expect(q.byBasis.serving).not.toHaveProperty('sodium');
    expect(q.nutrients).toHaveLength(3);
  });
  it('"No contiene" / "N.D." are not turned into 0', () => {
    const q = parseLabelText('Por 100 g\nGrasa trans: No contiene\nFibra N.D.\nProteína 4 g');
    expect(q.byBasis['100g']).toEqual({ protein: 4 });
  });
  it('a nutrient declared only as %VD is not imported, with a warning', () => {
    const q = parseLabelText('Por porción\nProteína 3 g\nVitamina A 10%');
    expect(q.byBasis.serving).toEqual({ protein: 3 });
    expect(hasWarning(q, /% del valor diario.*Vitamina A/)).toBe(true);
  });
});

describe('parseLabelText: unidades', () => {
  it('header-unit style "Sodio (mg) 150"', () => {
    const p = parseLabelText('Por 100 g\nSodio (mg) 150\nGrasa total (g) 3\nEnergía (kcal) 120');
    expect(get(p, 'sodium')).toMatchObject({ value: 150, sourceUnit: 'mg', uncertain: false, converted: false });
    expect(get(p, 'fat')).toMatchObject({ value: 3, sourceUnit: 'g', uncertain: false });
    expect(get(p, 'kcal')).toMatchObject({ value: 120, sourceUnit: 'kcal', uncertain: false });
  });
  it('no unit anywhere → conventional unit, uncertain', () => {
    const p = parseLabelText('Por 100 g\nProteína 8\nSodio 150');
    expect(get(p, 'protein')).toMatchObject({ value: 8, uncertain: true, sourceUnit: null });
    expect(get(p, 'sodium')).toMatchObject({ value: 150, uncertain: true });
    expect(get(p, 'protein')?.note).toMatch(/se asumió g/);
  });
  it('micronutrients are never imported without a unit; UI is rejected', () => {
    const p = parseLabelText('Por 100 g\nCalcio 120\nVitamina A 500 UI\nHierro 2 mg');
    expect(p.byBasis['100g']).toEqual({ iron: 2 });
    expect(p.unrecognizedLines).toEqual(['Calcio 120', 'Vitamina A 500 UI']);
    expect(hasWarning(p, /falta la unidad/)).toBe(true);
    expect(hasWarning(p, /UI/)).toBe(true);
  });
  it('a mass unit on the energy row is rejected', () => {
    const p = parseLabelText('Por 100 g\nEnergía 120 g');
    expect(p.nutrients).toEqual([]);
    expect(p.unrecognizedLines).toEqual(['Energía 120 g']);
  });
  it('"Carbohidratos disponibles" → carbsAvail; "totales" → carbs', () => {
    const p = parseLabelText('Por 100 g\nCarbohidratos disponibles 45 g\nCarbohidratos totales 50 g');
    expect(get(p, 'carbsAvail')).toMatchObject({ value: 45, uncertain: false });
    expect(get(p, 'carbs')).toMatchObject({ value: 50, uncertain: false });
  });
  it('"15 9" → g only when the row header unit says g', () => {
    const withHeader = parseLabelText('Por porción\nProteína (g) 15 9');
    expect(get(withHeader, 'protein')).toMatchObject({ value: 15, uncertain: true });
    expect(get(withHeader, 'protein')?.note).toMatch(/«9»/);
    const without = parseLabelText('Por porción\nProteína 15 9');
    expect(get(without, 'protein')).toBeUndefined();
    expect(without.unrecognizedLines).toEqual(['Proteína 15 9']);
  });
});

describe('parseLabelText: texto de OCR', () => {
  const p = parseLabelText(`lnformación nutricional
Tamaño de porción: 3O g
| Calorías | 12O kcal |
|Proteína8g
Grasa total: 1O g
Sodio. . . . 15O mg
Carbohidratos totales: l5 g
Fibra:   2 g  |`);

  it('fixes O→0 and l→1 inside numbers and flags them', () => {
    expect(p.servingSize).toBe(30);
    expect(hasWarning(p, /OCR/)).toBe(true);
    expect(get(p, 'kcal')).toMatchObject({ value: 120, uncertain: true });
    expect(get(p, 'kcal')?.note).toMatch(/OCR/);
    expect(get(p, 'fat')).toMatchObject({ value: 10, uncertain: true });
    expect(get(p, 'sodium')).toMatchObject({ value: 150, uncertain: true });
    expect(get(p, 'carbs')).toMatchObject({ value: 15, uncertain: true });
  });
  it('tolerates stray pipes, leaders, missing and extra spaces', () => {
    expect(get(p, 'protein')).toMatchObject({ value: 8, uncertain: false });
    expect(get(p, 'fiber')).toMatchObject({ value: 2, uncertain: false });
    expect(p.byBasis).toEqual({ serving: { kcal: 120, protein: 8, fat: 10, sodium: 150, carbs: 15, fiber: 2 } });
    expect(p.unrecognizedLines).toEqual([]);
  });
  it('upper case, glued units and bullet-separated minerals', () => {
    const q = parseLabelText('POR PORCIÓN\nPROTEÍNA 8G\nVitamina D 2 mcg 10% • Calcio 260 mg 20% • Hierro 8 mg 45%');
    expect(q.byBasis).toEqual({ serving: { protein: 8, vitD: 2, calcium: 260, iron: 8 } });
  });
  it('joins a label and its value split over two lines', () => {
    const q = parseLabelText('Por 100 g\nProteína\n8 g\nGrasa total (g)\n3');
    expect(q.byBasis['100g']).toEqual({ protein: 8, fat: 3 });
    expect(get(q, 'protein')?.sourceText).toBe('Proteína 8 g');
  });
  it('does not join a label with a value that is not alone on its line', () => {
    const q = parseLabelText('Por 100 g\nProteína\nLactosa 5 g');
    expect(q.nutrients).toEqual([]);
    expect(q.unrecognizedLines).toEqual(['Lactosa 5 g']);
  });
});

describe('parseLabelText: líneas no reconocidas y entrada no confiable', () => {
  it('a value with no recognisable nutrient goes to unrecognizedLines', () => {
    const p = parseLabelText('Por 100 g\nProteína 8 g\nLactosa 4,5 g\nGrasa insaturada 5 g');
    expect(p.byBasis['100g']).toEqual({ protein: 8 });
    expect(p.unrecognizedLines).toEqual(['Lactosa 4,5 g', 'Grasa insaturada 5 g']);
  });
  it('ignores footnotes and lines without numbers', () => {
    const p = parseLabelText(
      'Por porción\nProteína 3 g\n* Los porcentajes de valores diarios están basados en una dieta de 2.000 calorías.\nNo es fuente significativa de vitamina C',
    );
    expect(p.unrecognizedLines).toEqual([]);
    expect(p.byBasis).toEqual({ serving: { protein: 3 } });
  });
  it('empty input', () => {
    const p = parseLabelText('   \n  ');
    expect(p.nutrients).toEqual([]);
    expect(p.columns).toEqual([]);
    expect(p.byBasis).toEqual({});
    expect(p.warnings.length).toBeGreaterThan(0);
  });
  it('no recognised nutrient → warning', () => {
    const p = parseLabelText('Hola mundo 123');
    expect(p.nutrients).toEqual([]);
    expect(p.unrecognizedLines).toEqual(['Hola mundo 123']);
    expect(hasWarning(p, /ningún nutriente/)).toBe(true);
  });
  it('prototype-like words are just unrecognised', () => {
    const p = parseLabelText('Por 100 g\nconstructor 5 g\n__proto__ 3 g\nhasOwnProperty 1 mg');
    expect(p.nutrients).toEqual([]);
    expect(Object.keys(p.byBasis)).toEqual([]);
    expect(p.unrecognizedLines).toEqual(['constructor 5 g', '__proto__ 3 g', 'hasOwnProperty 1 mg']);
    expect(({} as Record<string, unknown>).g).toBeUndefined();
  });
  it('unknown text after a value keeps the value but flags it', () => {
    const p = parseLabelText('Por 100 g\nProteína 2 g toString');
    expect(get(p, 'protein')).toMatchObject({ value: 2, uncertain: true });
    expect(get(p, 'protein')?.note).toMatch(/no se reconoció/);
  });
  it('huge input is truncated with a warning and does not hang', () => {
    const big = 'Por 100 g\n' + 'Proteína 8 g 2,5 g 1.250 mg <1 g trazas | | | 9 9 9\n'.repeat(2000);
    const t0 = Date.now();
    const p = parseLabelText(big);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(hasWarning(p, /muy largo/)).toBe(true);
  });
  it('a pathological single line does not hang', () => {
    const t0 = Date.now();
    parseLabelText('Proteína ' + '1.'.repeat(5000) + ' g');
    parseLabelText('a'.repeat(399) + '\n' + 'grasa '.repeat(60));
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('reproducible synthetic label text evaluation', () => {
  it('reports field results and fails closed on known ambiguities', () => {
    let expectedFields = 0
    let exactFields = 0
    let missingFields = 0
    let wrongFields = 0
    let extraFields = 0
    let rejectedAmbiguousFields = 0
    let silentlyAcceptedAmbiguousFields = 0
    let elapsedMs = 0
    const byCase = [] as { id: string; kind: string; expected: number; exact: number; missing: number; wrong: number; extra: number; elapsedMs: number }[]

    for (const fixture of evaluationFixtures) {
      const start = performance.now()
      const parsed = parseLabelText(fixture.text)
      const ms = performance.now() - start
      elapsedMs += ms
      const found = new Map(parsed.nutrients.map((n) => [`${n.basis}:${n.code}`, n]))
      const expected = Object.entries(fixture.expected)
      let exact = 0, missing = 0, wrong = 0
      for (const [key, truth] of expected) {
        const actual = found.get(key)
        if (!actual) missing++
        else if (actual.value === truth.value && actual.sourceUnit === truth.sourceUnit &&
          (!('uncertain' in truth) || actual.uncertain === truth.uncertain)) exact++
        else wrong++
      }
      const extra = [...found.keys()].filter((key) => !(key in fixture.expected)).length
      expectedFields += expected.length
      exactFields += exact
      missingFields += missing
      wrongFields += wrong
      extraFields += extra
      byCase.push({ id: fixture.id, kind: fixture.kind, expected: expected.length, exact, missing, wrong, extra, elapsedMs: Number(ms.toFixed(2)) })

      if ('expectedServingSize' in fixture) {
        expect(parsed.servingSize, fixture.id).toBe(fixture.expectedServingSize)
        expect(parsed.servingUnit, fixture.id).toBe(fixture.expectedServingUnit)
      }
      if (fixture.mustReject) for (const key of fixture.mustReject) {
        if (found.has(key)) silentlyAcceptedAmbiguousFields++
        else rejectedAmbiguousFields++
        expect(found.has(key), `${fixture.id}: ${key} must not be imported`).toBe(false)
      }
      if ('mustWarn' in fixture) expect(
        [...parsed.warnings, ...parsed.nutrients.map((n) => n.note ?? '')].join(' '), fixture.id,
      ).toContain(fixture.mustWarn)
      if (fixture.id === 'ambiguous-gram-thousands') {
        expect(found.get('100g:carbs')?.uncertain).toBe(true)
      }
    }

    const report = {
      corpus: 'synthetic transcriptions only; no photographs', photoCorpusCount: 0,
      photoFieldAccuracy: 'N/A', photoCorrectionTimeMs: 'N/A', photoOcrTimeMs: 'N/A',
      textCaseCount: evaluationFixtures.length, expectedFields, exactFields, missingFields, wrongFields, extraFields,
      exactFieldRate: exactFields / expectedFields, rejectedAmbiguousFields, silentlyAcceptedAmbiguousFields,
      textParseElapsedMs: Number(elapsedMs.toFixed(2)), correctionTimeMs: 'N/A', byCase,
    }
    console.log('OCR_TEXT_EVALUATION ' + JSON.stringify(report))
    expect(exactFields).toBe(expectedFields)
    expect(missingFields + wrongFields + extraFields).toBe(0)
    expect(silentlyAcceptedAmbiguousFields).toBe(0)
  })
})
