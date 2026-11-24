import type { NutrientCode } from '../db/catalogTypes';
import { ageFromBirthDate, type Sex } from './energy';

/**
 * Dietary Reference Intakes (DRI) for healthy people, National Academies (NASEM/IOM) summary tables, with the 2019
 * update for sodium and potassium. Population reference values: not a diagnosis and not an individual prescription.
 * Pregnancy and lactation are not modelled. Fiber follows 14 g per 1000 kcal; saturated fat and added sugars use the
 * Dietary Guidelines for Americans 2020-2025 limit (< 10 % of energy, also the WHO limit for free sugars).
 */

export const AGE_GROUPS = ['14-18', '19-30', '31-50', '51-70', '>70'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/**
 * Which published table the values come from. Only NASEM/IOM is implemented; the Colombian RIEN (Resolución 3803 de 2016,
 * MinSalud) can be added as another set by supplying its own `DEFS` without touching the evaluation code.
 */
export type ReferenceSet = 'nasem';
export const REFERENCE_SETS: Record<ReferenceSet, string> = { nasem: 'NASEM/IOM (EE. UU.)' };

export type RefKind = 'RDA' | 'AI' | 'CDRR' | 'limit-energy' | 'none';

export interface Reference {
  code: NutrientCode;
  kind: RefKind;
  unit: string;
  /** Point value (RDA / AI / CDRR). Null when none applies or when sex is unknown and the two values differ. */
  value: number | null;
  /** Min and max across sexes when the profile has no sex and the values differ. */
  range: [number, number] | null;
  /** Tolerable Upper Intake Level (UL), when one exists. */
  ul: number | null;
  /** The UL applies only to supplements / fortificants: food intake above it is not flagged as excess. */
  ulSupplementOnly: boolean;
  /** Secondary value: AI under a CDRR (sodium) or the absolute AI next to a per-1000-kcal fiber target. */
  alt: { label: string; value: number } | null;
  /** Limits as % of energy (limit-energy). */
  pctEnergyMax: number | null;
  /** Shown as information only, no status (food water). */
  informational: boolean;
  source: string;
  note?: string;
}

export interface Amdr {
  protein: [number, number];
  carbs: [number, number];
  fat: [number, number];
}

export interface DriSet {
  referenceSet: ReferenceSet;
  sex: Sex | null;
  age: number | null;
  ageGroup: AgeGroup | null;
  /** True when the age group was assumed (no birth date): adult 31-50. */
  ageAssumed: boolean;
  /** True when the age is below 14 (values not modelled). */
  outOfScope: boolean;
  amdr: Amdr | null;
  refs: Record<NutrientCode, Reference>;
  /** Notes about the quality of the reference (missing sex, assumed age...). Spanish. */
  notes: string[];
}

export function ageGroupFor(age: number): AgeGroup | null {
  if (!Number.isFinite(age) || age < 14) return null;
  if (age <= 18) return '14-18';
  if (age <= 30) return '19-30';
  if (age <= 50) return '31-50';
  if (age <= 70) return '51-70';
  return '>70';
}

type Row5 = readonly [number, number, number, number, number];
const same = (n: number): Row5 => [n, n, n, n, n];

interface Def {
  kind: RefKind;
  unit: string;
  M: Row5;
  F: Row5;
  ul?: Row5;
  ulSupplementOnly?: boolean;
  source: string;
  note?: string;
  informational?: boolean;
}

const DRI_MINERALS = 'NASEM, DRI calcio y vitamina D (2011), hierro, zinc, magnesio y fósforo';
// Groups: 14-18, 19-30, 31-50, 51-70, >70.
const DEFS: Partial<Record<NutrientCode, Def>> = {
  protein: { kind: 'RDA', unit: 'g', M: [52, 56, 56, 56, 56], F: same(46), source: 'NASEM, DRI macronutrientes (2005)' },
  carbs: {
    kind: 'RDA', unit: 'g', M: same(130), F: same(130), source: 'NASEM, DRI macronutrientes (2005)',
    note: 'La RDA de 130 g es el mínimo para el cerebro, no una meta; el rango útil es el AMDR.',
  },
  calcium: { kind: 'RDA', unit: 'mg', M: [1300, 1000, 1000, 1000, 1200], F: [1300, 1000, 1000, 1200, 1200], ul: [3000, 2500, 2500, 2000, 2000], source: DRI_MINERALS },
  iron: {
    kind: 'RDA', unit: 'mg', M: [11, 8, 8, 8, 8], F: [15, 18, 18, 8, 8], ul: same(45), source: DRI_MINERALS,
    note: 'Supone una dieta mixta (10 % de absorción); con dietas vegetarianas la necesidad es hasta 1,8 veces mayor.',
  },
  magnesium: {
    kind: 'RDA', unit: 'mg', M: [410, 400, 420, 420, 420], F: [360, 310, 320, 320, 320], ul: same(350), ulSupplementOnly: true, source: DRI_MINERALS,
    note: 'El UL de 350 mg aplica solo a suplementos y medicamentos, no al magnesio de los alimentos.',
  },
  phosphorus: { kind: 'RDA', unit: 'mg', M: [1250, 700, 700, 700, 700], F: [1250, 700, 700, 700, 700], ul: [4000, 4000, 4000, 4000, 3000], source: DRI_MINERALS },
  zinc: { kind: 'RDA', unit: 'mg', M: same(11), F: [9, 8, 8, 8, 8], ul: [34, 40, 40, 40, 40], source: DRI_MINERALS },
  potassium: { kind: 'AI', unit: 'mg', M: [3000, 3400, 3400, 3400, 3400], F: [2300, 2600, 2600, 2600, 2600], source: 'NASEM, DRI sodio y potasio (2019)' },
  vitA: {
    kind: 'RDA', unit: 'µg', M: same(900), F: same(700), ul: [2800, 3000, 3000, 3000, 3000], ulSupplementOnly: true,
    source: 'NASEM, DRI vitamina A (2001)',
    note: 'El UL de 3000 µg aplica solo a retinol preformado (suplementos, hígado), no a los carotenoides.',
  },
  vitC: { kind: 'RDA', unit: 'mg', M: [75, 90, 90, 90, 90], F: [65, 75, 75, 75, 75], ul: [1800, 2000, 2000, 2000, 2000], source: 'NASEM, DRI vitamina C (2000)', note: 'En fumadores la necesidad aumenta 35 mg.' },
  vitD: { kind: 'RDA', unit: 'µg', M: [15, 15, 15, 15, 20], F: [15, 15, 15, 15, 20], ul: same(100), source: 'NASEM, DRI calcio y vitamina D (2011)', note: 'La RDA supone exposición solar mínima.' },
  vitE: {
    kind: 'RDA', unit: 'mg', M: same(15), F: same(15), ul: [800, 1000, 1000, 1000, 1000], ulSupplementOnly: true, source: 'NASEM, DRI vitamina E (2000)',
    note: 'El UL aplica solo a α-tocoferol de suplementos.',
  },
  vitB12: { kind: 'RDA', unit: 'µg', M: same(2.4), F: same(2.4), source: 'NASEM, DRI vitaminas del complejo B (1998)', note: 'Desde los 51 años se recomienda cubrirla con alimentos fortificados o suplemento.' },
  folate: {
    kind: 'RDA', unit: 'µg', M: same(400), F: same(400), ul: [800, 1000, 1000, 1000, 1000], ulSupplementOnly: true, source: 'NASEM, DRI vitaminas del complejo B (1998)',
    note: 'La RDA se expresa en DFE y el catálogo trae folato total de los alimentos: con alimentos fortificados el DFE real es mayor. El UL aplica solo a ácido fólico sintético.',
  },
  sodium: {
    kind: 'CDRR', unit: 'mg', M: same(2300), F: same(2300), source: 'NASEM, DRI sodio y potasio (2019)',
    note: 'CDRR: umbral sobre el cual reducir el sodio disminuye el riesgo crónico. La AI es 1500 mg. La OMS (2012) recomienda menos de 2000 mg al día para adultos.',
  },
  water: {
    kind: 'AI', unit: 'g', M: [3300, 3700, 3700, 3700, 3700], F: [2300, 2700, 2700, 2700, 2700], informational: true, source: 'NASEM, DRI agua (2005)',
    note: 'La AI es de agua total (bebidas y humedad de los alimentos). Aquí solo se suma la humedad de los alimentos; el agua que bebes está en Hidratación.',
  },
};

const SODIUM_AI = 1500;
const FIBER_PER_1000 = 14;
const FIBER_ABS: { M: Row5; F: Row5 } = { M: [38, 38, 38, 30, 30], F: [26, 25, 25, 21, 21] };

export function amdrFor(group: AgeGroup): Amdr {
  return group === '14-18'
    ? { protein: [10, 30], carbs: [45, 65], fat: [25, 35] }
    : { protein: [10, 35], carbs: [45, 65], fat: [20, 35] };
}

const ALL_CODES: readonly NutrientCode[] = [
  'kcal', 'kj', 'protein', 'carbs', 'carbsAvail', 'fat', 'satFat', 'monoFat', 'polyFat', 'transFat', 'fiber', 'sugars',
  'addedSugars', 'sodium', 'cholesterol', 'potassium', 'calcium', 'iron', 'magnesium', 'phosphorus', 'zinc', 'vitA', 'vitC',
  'vitD', 'vitE', 'vitB12', 'folate', 'water',
];
const UNIT: Partial<Record<NutrientCode, string>> = {
  kcal: 'kcal', kj: 'kJ', sodium: 'mg', cholesterol: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg', magnesium: 'mg',
  phosphorus: 'mg', zinc: 'mg', vitA: 'µg', vitC: 'mg', vitD: 'µg', vitE: 'mg', vitB12: 'µg', folate: 'µg',
};

function blank(code: NutrientCode, source = '', note?: string): Reference {
  return {
    code, kind: 'none', unit: UNIT[code] ?? 'g', value: null, range: null, ul: null, ulSupplementOnly: false, alt: null,
    pctEnergyMax: null, informational: false, source, ...(note ? { note } : {}),
  };
}

export interface DriOptions {
  /** Reference table to use (default 'nasem'). */
  referenceSet?: ReferenceSet;
  sex: Sex | null | undefined;
  /** Birth date 'YYYY-MM-DD' (local). */
  birthDate: string | null | undefined;
  /** The day the reference is for 'YYYY-MM-DD' (local); the age is counted on this day. */
  on: string;
  /** Energy goal in kcal: derives the fiber target (14 g / 1000 kcal). */
  energyKcal?: number | null;
}

function pick(def: Def, idx: number, sex: Sex | null): { value: number | null; range: [number, number] | null } {
  const m = def.M[idx]!;
  const f = def.F[idx]!;
  if (sex === 'male') return { value: m, range: null };
  if (sex === 'female') return { value: f, range: null };
  return m === f ? { value: m, range: null } : { value: null, range: [Math.min(m, f), Math.max(m, f)] };
}

/** Reference values for a person on a given day. Missing sex gives ranges; missing birth date assumes adult 31-50. */
export function getDri(o: DriOptions): DriSet {
  const sex: Sex | null = o.sex === 'male' || o.sex === 'female' ? o.sex : null;
  let age: number | null = null;
  if (o.birthDate) {
    try {
      const a = ageFromBirthDate(o.birthDate, o.on);
      age = a >= 0 ? a : null;
    } catch {
      age = null;
    }
  }
  const ageAssumed = age === null;
  const referenceSet: ReferenceSet = o.referenceSet ?? 'nasem';
  const group: AgeGroup | null = age === null ? '31-50' : ageGroupFor(age);
  const notes: string[] = [];
  const refs = {} as Record<NutrientCode, Reference>;
  for (const c of ALL_CODES) refs[c] = blank(c);
  if (group === null) {
    notes.push('Los valores de referencia cubren desde los 14 años; con la edad del perfil no se muestran.');
    return { referenceSet, sex, age, ageGroup: null, ageAssumed: false, outOfScope: true, amdr: null, refs, notes };
  }
  const idx = AGE_GROUPS.indexOf(group);
  if (sex === null) notes.push('Completa el sexo en el perfil para ver un valor único; mientras tanto se muestran rangos y no se evalúa.');
  if (ageAssumed) notes.push('Sin fecha de nacimiento en el perfil: se usan los valores de adulto de 31 a 50 años.');

  for (const [code, def] of Object.entries(DEFS) as [NutrientCode, Def][]) {
    const { value, range } = pick(def, idx, sex);
    refs[code] = {
      ...blank(code, def.source, def.note),
      unit: def.unit,
      kind: def.kind,
      value,
      range,
      ul: def.ul?.[idx] ?? null,
      ulSupplementOnly: def.ulSupplementOnly === true,
      informational: def.informational === true,
    };
  }
  refs.sodium.alt = { label: 'AI', value: SODIUM_AI };

  // Fiber: 14 g / 1000 kcal against the energy goal; the absolute AI is shown beside it.
  const fAbsM = FIBER_ABS.M[idx]!;
  const fAbsF = FIBER_ABS.F[idx]!;
  const fAbs = sex === 'male' ? fAbsM : sex === 'female' ? fAbsF : null;
  const kcal = o.energyKcal && o.energyKcal > 0 ? o.energyKcal : null;
  const derived = kcal === null ? null : Math.round((kcal / 1000) * FIBER_PER_1000 * 10) / 10;
  refs.fiber = {
    ...blank('fiber', 'NASEM, DRI macronutrientes (2005)', 'AI de 14 g por 1000 kcal. Con tu meta de energía se deriva el objetivo; la AI absoluta se muestra aparte.'),
    kind: 'AI',
    value: derived ?? fAbs,
    range: derived === null && fAbs === null ? [Math.min(fAbsM, fAbsF), Math.max(fAbsM, fAbsF)] : null,
    alt: derived !== null && fAbs !== null ? { label: 'AI absoluta', value: fAbs } : null,
  };
  refs.satFat = { ...blank('satFat', 'Guías Alimentarias de EE. UU. 2020-2025; OMS 2023', 'Menos del 10 % de la energía (OMS 2023, DGA 2020-2025).'), kind: 'limit-energy', pctEnergyMax: 10 };
  refs.addedSugars = {
    ...blank('addedSugars', 'Guías Alimentarias de EE. UU. 2020-2025; OMS 2015', 'Menos del 10 % de la energía (OMS 2015, DGA 2020-2025); la OMS sugiere idealmente menos del 5 %.'),
    kind: 'limit-energy',
    pctEnergyMax: 10,
  };
  refs.transFat = blank('transFat', 'OMS; NASEM 2005', 'Lo más bajo posible: sin valor numérico de referencia.');
  refs.cholesterol = blank('cholesterol', 'Guías Alimentarias de EE. UU. 2015-2020', 'Sin valor de referencia numérico: las DRI no fijaron UL y las guías de 2015 retiraron el límite de 300 mg.');
  refs.sugars = blank('sugars', '', 'Sin valor de referencia para azúcares totales; el límite aplica a azúcares añadidos.');
  refs.kcal = blank('kcal', '', 'La necesidad de energía es individual: se compara con tu meta, no con una DRI.');
  return { referenceSet, sex, age, ageGroup: group, ageAssumed, outOfScope: false, amdr: amdrFor(group), refs, notes };
}

// ───────────── Evaluation ─────────────

export type Tone = 'good' | 'warn' | 'bad' | 'muted';
export interface Status {
  text: string;
  tone: Tone;
  /** Percentage of the reference (or of the limit), when it applies. */
  pct: number | null;
  /** Intake exceeds a UL that applies to food. */
  overUl: boolean;
}

const pctText = (p: number) => `${Math.round(p)} %`;

/**
 * Status of an intake against its reference. `energyPct` = share of energy supplied by the nutrient (percent), needed
 * for limits expressed as % of energy. Unknown intake (null) is "Sin dato", never zero.
 */
export function evaluateIntake(ref: Reference, amount: number | null, energyPct: number | null = null): Status {
  const no = (text: string): Status => ({ text, tone: 'muted', pct: null, overUl: false });
  if (amount === null) return no('Sin dato');
  if (ref.informational) return no('Informativo');
  if (ref.kind === 'none') return no('Sin referencia');
  if (ref.kind === 'limit-energy') {
    if (energyPct === null || ref.pctEnergyMax === null) return no('Sin dato');
    const pct = (energyPct / ref.pctEnergyMax) * 100;
    return energyPct > ref.pctEnergyMax
      ? { text: 'Por encima del límite', tone: 'bad', pct, overUl: false }
      : { text: `${pctText(pct)} del límite`, tone: 'good', pct, overUl: false };
  }
  if (ref.value === null) return no('Falta el sexo en el perfil');
  const pct = (amount / ref.value) * 100;
  if (ref.kind === 'CDRR') {
    return amount > ref.value
      ? { text: 'Por encima del CDRR', tone: 'warn', pct, overUl: false }
      : { text: `${pctText(pct)} del CDRR`, tone: 'good', pct, overUl: false };
  }
  if (ref.ul !== null && !ref.ulSupplementOnly && amount > ref.ul) return { text: 'Por encima del UL', tone: 'bad', pct, overUl: true };
  return { text: pctText(pct), tone: pct >= 100 ? 'good' : pct >= 67 ? 'muted' : 'warn', pct, overUl: false };
}

export type AmdrState = 'below' | 'within' | 'above';
export function evaluateAmdr(pct: number, range: [number, number]): AmdrState {
  return pct < range[0] ? 'below' : pct > range[1] ? 'above' : 'within';
}
