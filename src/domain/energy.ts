import { formatNumber } from './units';

export type Sex = 'male' | 'female';
export type ActivityKey = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain' | 'recomp';
/** 'mifflin' = Mifflin-St Jeor × activity factor (default); 'rien' = Schofield × PAL (RIEN Colombia). */
export type EnergyMethod = 'mifflin' | 'rien';
export type PalBand = 'light' | 'moderate' | 'vigorous';
/** Optional profile field: pregnancy and lactation turn off deficits and adaptive changes. */
export type PhysiologicalState = 'none' | 'pregnant' | 'lactating';

/**
 * Activity factors of the default method (× Mifflin-St Jeor). Source: the 1,2–1,9 multipliers spread by
 * exercise-physiology textbooks (McArdle, Katch & Katch) and most online calculators. They were NOT derived
 * from doubly labelled water; 1,2 sits below the FAO/WHO/UNU 2004 and RIEN sedentary PAL range (1,40–1,69),
 * so the initial target may be low for desk workers. Kept as the default so existing goals never change;
 * the RIEN method (PAL_BANDS) is offered as an alternative.
 */
export const ACTIVITY_LEVELS: readonly { key: ActivityKey; factor: number; es: string; description: string }[] = [
  { key: 'sedentary', factor: 1.2, es: 'Sedentaria', description: 'Sin ejercicio y casi siempre sentada/o (p. ej., < 5000 pasos al día).' },
  { key: 'light', factor: 1.375, es: 'Ligera', description: 'Ejercicio ligero 1–3 días por semana.' },
  { key: 'moderate', factor: 1.55, es: 'Moderada', description: 'Ejercicio moderado 3–5 días por semana.' },
  { key: 'active', factor: 1.725, es: 'Alta', description: 'Ejercicio intenso 6–7 días por semana.' },
  {
    key: 'very_active',
    factor: 1.9,
    es: 'Muy alta',
    description: 'Entrenamiento muy intenso o trabajo físico exigente todo el día.',
  },
];

/**
 * Physical activity level (PAL = TEE / BMR) bands of FAO/WHO/UNU 2004 (Human Energy Requirements, Table 5.3),
 * the ones used by the Colombian RIEN (Res. 3803/2016) for adults. The band midpoint is used as the PAL.
 * `legacyActivity` is stored next to it only for older app versions that ignore `method` (closest factor).
 */
export const PAL_BANDS: readonly { key: PalBand; es: string; min: number; max: number; pal: number; description: string; legacyActivity: ActivityKey }[] = [
  { key: 'light', es: 'Ligera o sedentaria', min: 1.4, max: 1.69, pal: 1.55, description: 'Trabajo sentada/o o de pie con poco desplazamiento y sin ejercicio regular.', legacyActivity: 'moderate' },
  { key: 'moderate', es: 'Moderada', min: 1.7, max: 1.99, pal: 1.85, description: 'Trabajo activo, o una hora diaria de ejercicio moderado a intenso.', legacyActivity: 'active' },
  { key: 'vigorous', es: 'Intensa', min: 2.0, max: 2.4, pal: 2.2, description: 'Trabajo físico pesado, o varias horas diarias de ejercicio intenso.', legacyActivity: 'very_active' },
];

/** A PAL value with two decimals and a decimal comma ("1,40"). */
export const palText = (v: number): string => v.toFixed(2).replace('.', ',');

export const ENERGY_METHOD_LABELS: Record<EnergyMethod, string> = {
  mifflin: 'Mifflin-St Jeor × factor de actividad',
  rien: 'RIEN Colombia (Schofield × PAL)',
};

export const PHYSIOLOGICAL_STATE_LABELS: Record<PhysiologicalState, string> = {
  none: 'Ninguno',
  pregnant: 'Embarazo',
  lactating: 'Lactancia',
};

export const GOAL_LABELS: Record<GoalType, string> = {
  lose: 'Perder grasa',
  maintain: 'Mantener',
  gain: 'Ganar masa',
  recomp: 'Recomposición',
};

/** Mifflin–St Jeor (1990): 10·kg + 6.25·cm − 5·años + (hombre +5 | mujer −161). kcal/día. */
export function mifflinStJeor(a: { weightKg: number; heightCm: number; ageYears: number; sex: Sex }): number {
  return 10 * a.weightKg + 6.25 * a.heightCm - 5 * a.ageYears + (a.sex === 'male' ? 5 : -161);
}

/**
 * Schofield (1985) adult BMR equations in kcal/day, as tabulated by FAO/WHO/UNU 2004 (Human Energy
 * Requirements, Table 5.2; SEE 108–167 kcal) and adopted by the Colombian RIEN (Res. 3803/2016). Age bands 18–29, 30–59, ≥ 60
 * (the report's 18–30 / 30–60 / ≥ 60). Weight only; adults (≥ 18 y) only: throws below 18.
 */
export const SCHOFIELD_ADULT: Record<Sex, readonly { minAge: number; slope: number; intercept: number; band: string }[]> = {
  male: [
    { minAge: 18, slope: 15.057, intercept: 692.2, band: '18–30 años' },
    { minAge: 30, slope: 11.472, intercept: 873.1, band: '30–60 años' },
    { minAge: 60, slope: 11.711, intercept: 587.7, band: '≥ 60 años' },
  ],
  female: [
    { minAge: 18, slope: 14.818, intercept: 486.6, band: '18–30 años' },
    { minAge: 30, slope: 8.126, intercept: 845.6, band: '30–60 años' },
    { minAge: 60, slope: 9.082, intercept: 658.5, band: '≥ 60 años' },
  ],
};

export function schofieldCoefficients(ageYears: number, sex: Sex): { slope: number; intercept: number; band: string } {
  if (!Number.isFinite(ageYears) || ageYears < 18) throw new Error('Las ecuaciones de Schofield para adultos son para personas de 18 años o más');
  const rows = SCHOFIELD_ADULT[sex];
  let pick = rows[0]!;
  for (const r of rows) if (ageYears >= r.minAge) pick = r;
  return pick;
}

/** BMR (kcal/day) by Schofield / FAO-WHO-UNU for adults. */
export function schofieldBmr(a: { weightKg: number; ageYears: number; sex: Sex }): number {
  const c = schofieldCoefficients(a.ageYears, a.sex);
  return c.slope * a.weightKg + c.intercept;
}

/** Women 1200 / men 1500 kcal: usual clinical minimums (a heuristic, not a requirement). */
export const SEX_MIN_KCAL: Record<Sex, number> = { female: 1200, male: 1500 };
/** No floor can go below this. */
export const ABSOLUTE_MIN_KCAL = 1000;

/**
 * The ONE orientative safety floor shared by the goal calculation and the adaptive module:
 * max(BMR, 1200 women / 1500 men, 1000). A clinical heuristic, not a requirement.
 */
export function safetyFloorKcal(sex: Sex, bmr: number): number {
  return Math.max(bmr, SEX_MIN_KCAL[sex], ABSOLUTE_MIN_KCAL);
}

/**
 * When deficits and automatic adaptive changes must be off, with the reason (Spanish), else null.
 * Under 18: the equations are not validated (Mifflin: 19–78 y) and growth adds to the requirement.
 * Pregnancy / lactation: the equations leave out their energy cost, and gestational weight gain would be
 * read as a surplus by the adaptive module. Both call for professional guidance.
 */
export function energyRestriction(a: { ageYears: number | null | undefined; physiologicalState?: PhysiologicalState | null }): { key: 'minor' | 'pregnant' | 'lactating'; text: string } | null {
  if (a.physiologicalState === 'pregnant')
    return {
      key: 'pregnant',
      text: 'Embarazo: las ecuaciones no incluyen el costo energético de la gestación y el aumento de peso es esperado. No se aplica déficit ni ajuste adaptativo automático; define tus metas con un profesional de la salud.',
    };
  if (a.physiologicalState === 'lactating')
    return {
      key: 'lactating',
      text: 'Lactancia: las ecuaciones no incluyen el costo energético de la producción de leche. No se aplica déficit ni ajuste adaptativo automático; define tus metas con un profesional de la salud.',
    };
  if (typeof a.ageYears === 'number' && Number.isFinite(a.ageYears) && a.ageYears < 18)
    return {
      key: 'minor',
      text: 'Menor de 18 años: las ecuaciones de gasto no están validadas a esta edad y el crecimiento aumenta el requerimiento. No se aplica déficit ni ajuste adaptativo automático; se recomienda orientación de un profesional de la salud.',
    };
  return null;
}

/** RDA of protein for adults (IOM 2005), g/kg/day. */
export const PROTEIN_RDA_G_PER_KG = 0.8;
/** AMDR of fat for adults, share of energy (IOM 2005; RIEN adults 20–35 %). */
export const FAT_AMDR = Object.freeze({ min: 0.2, max: 0.35 });
/** RDA of carbohydrate for adults (IOM 2005), g/day. */
export const CARB_RDA_G = 130;

/**
 * Non-blocking advice on a set of daily targets (calculated or typed): protein below the RDA, fat outside
 * the AMDR, carbohydrate below the RDA, and protein computed on total weight with BMI ≥ 30 (suggests a
 * reference weight at BMI 25). Never changes the numbers.
 */
export function macroAdvisories(a: { kcal: number; protein: number; fat: number; carbs: number; weightKg?: number | null; heightCm?: number | null }): string[] {
  const out: string[] = [];
  const f = (n: number, d = 0) => formatNumber(n, d);
  const w = typeof a.weightKg === 'number' && Number.isFinite(a.weightKg) && a.weightKg > 0 ? a.weightKg : null;
  const h = typeof a.heightCm === 'number' && Number.isFinite(a.heightCm) && a.heightCm > 0 ? a.heightCm / 100 : null;
  if (w !== null && a.protein / w < PROTEIN_RDA_G_PER_KG - 1e-9)
    out.push(`La proteína (${f(a.protein / w, 2)} g/kg) queda por debajo de la RDA para adultos: 0,8 g/kg/día (IOM 2005).`);
  if (a.kcal > 0) {
    const fatShare = (9 * a.fat) / a.kcal;
    if (fatShare < FAT_AMDR.min - 0.005 || fatShare > FAT_AMDR.max + 0.005)
      out.push(`La grasa aporta ${f(fatShare * 100)} % de la energía, fuera del rango de referencia 20–35 % (AMDR: IOM 2005; RIEN).`);
  }
  if (a.carbs < CARB_RDA_G)
    out.push(`Los carbohidratos (${f(a.carbs)} g) quedan por debajo de 130 g/día, la RDA para adultos (IOM 2005).`);
  if (w !== null && h !== null) {
    const bmi = w / (h * h);
    if (bmi >= 30) {
      const ref = 25 * h * h;
      const gkg = a.protein / w;
      out.push(
        `Con IMC ${f(bmi, 1)} (≥ 30), la proteína calculada con el peso total sale alta; considera usar un peso de referencia (IMC 25 ≈ ${f(ref, 1)} kg): ${f(gkg, 2)} g/kg × ${f(ref, 1)} kg ≈ ${f(gkg * ref)} g.`,
      );
    }
  }
  return out;
}

/** Completed years between birth (YYYY-MM-DD) and `on` (YYYY-MM-DD). */
export function ageFromBirthDate(birth: string, on: string): number {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth);
  const o = /^(\d{4})-(\d{2})-(\d{2})/.exec(on);
  if (!b || !o) throw new Error('Fecha inválida');
  let age = Number(o[1]) - Number(b[1]);
  const before = Number(o[2]) < Number(b[2]) || (Number(o[2]) === Number(b[2]) && Number(o[3]) < Number(b[3]));
  if (before) age--;
  return age;
}

export interface TargetInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  /** Required with method 'mifflin' (the default). */
  activity?: ActivityKey;
  goal: GoalType;
  /** Absent = 'mifflin' (every goal saved before 3.3). */
  method?: EnergyMethod;
  /** Required with method 'rien'. */
  palBand?: PalBand;
  physiologicalState?: PhysiologicalState | null;
  deficitKcal?: number;
  surplusKcal?: number;
  proteinGPerKg?: number;
  fatPct?: number;
  fiberPer1000?: number;
}

export interface TargetInputResolved extends TargetInput {
  /** For 'rien': the closest legacy level (see PAL_BANDS.legacyActivity), so older versions can read it. */
  activity: ActivityKey;
  method: EnergyMethod;
  /** Multiplier actually used: the activity factor, or the PAL of the band. */
  pal: number;
  deficitKcal: number;
  surplusKcal: number;
  proteinGPerKg: number;
  fatPct: number;
  fiberPer1000: number;
}

function assertRange(name: string, v: number, min: number, max: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${name} debe estar entre ${formatNumber(min, 2)} y ${formatNumber(max, 2)}`);
  }
}

export function computeTargets(input: TargetInput): {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  warnings: string[];
  method: string;
  inputs: TargetInputResolved;
} {
  const method: EnergyMethod = input.method === 'rien' ? 'rien' : 'mifflin';
  const band = method === 'rien' ? PAL_BANDS.find((b) => b.key === input.palBand) : undefined;
  const level = method === 'mifflin' ? ACTIVITY_LEVELS.find((l) => l.key === input.activity) : undefined;
  if (method === 'rien' && !band) throw new Error('Elige el nivel de actividad física (PAL)');
  if (method === 'mifflin' && !level) throw new Error('Nivel de actividad no válido');
  const inputs: TargetInputResolved = {
    ...input,
    method,
    activity: band ? band.legacyActivity : level!.key,
    pal: band ? band.pal : level!.factor,
    deficitKcal: input.deficitKcal ?? 400,
    surplusKcal: input.surplusKcal ?? 250,
    proteinGPerKg: input.proteinGPerKg ?? (input.goal === 'recomp' ? 2.0 : 1.8),
    fatPct: input.fatPct ?? 0.27,
    fiberPer1000: input.fiberPer1000 ?? 14,
  };
  if (method === 'mifflin') delete inputs.palBand;
  assertRange('El peso (kg)', inputs.weightKg, 20, 400);
  assertRange('La estatura (cm)', inputs.heightCm, 100, 250);
  assertRange('La edad (años)', inputs.ageYears, 10, 110);
  assertRange('El déficit (kcal)', inputs.deficitKcal, 0, 2000);
  assertRange('El superávit (kcal)', inputs.surplusKcal, 0, 2000);
  assertRange('La proteína (g/kg)', inputs.proteinGPerKg, 0.3, 4);
  assertRange('El porcentaje de grasa', inputs.fatPct, 0.05, 0.6);
  assertRange('La fibra (g por 1000 kcal)', inputs.fiberPer1000, 0, 60);
  if (inputs.sex !== 'male' && inputs.sex !== 'female') throw new Error('El sexo debe ser "male" o "female"');
  if (!(inputs.goal in GOAL_LABELS)) throw new Error('Objetivo no válido');

  const f0 = (n: number) => formatNumber(n, 0);
  const warnings: string[] = [];
  const lines: string[] = [];
  const sexEs = inputs.sex === 'male' ? 'hombre' : 'mujer';

  let bmr: number;
  if (band) {
    const c = schofieldCoefficients(inputs.ageYears, inputs.sex);
    bmr = c.slope * inputs.weightKg + c.intercept;
    lines.push(
      `TMB (Schofield, FAO/OMS/UNU; RIEN Res. 3803/2016, ${sexEs} de ${c.band}): ${formatNumber(c.slope, 3)}×${formatNumber(inputs.weightKg, 2)} + ${formatNumber(c.intercept, 1)} = ${f0(bmr)} kcal`,
    );
  } else {
    bmr = mifflinStJeor(inputs);
    lines.push(
      `TMB (Mifflin-St Jeor, ${sexEs}): 10×${formatNumber(inputs.weightKg, 2)} + 6,25×${formatNumber(inputs.heightCm, 2)} − 5×${formatNumber(inputs.ageYears, 0)} ${inputs.sex === 'male' ? '+ 5' : '− 161'} = ${f0(bmr)} kcal`,
    );
  }
  const tdee = bmr * inputs.pal;
  lines.push(
    band
      ? `Gasto energético total estimado (GET): ${f0(bmr)} × ${palText(band.pal)} (PAL ${band.es.toLowerCase()}, punto medio de ${palText(band.min)}–${palText(band.max)}) = ${f0(tdee)} kcal`
      : `Gasto energético total estimado (GET): ${f0(bmr)} × ${formatNumber(level!.factor, 3)} (${level!.es}) = ${f0(tdee)} kcal`,
  );

  // Under 18, pregnancy and lactation: no deficit (and no adaptive auto mode, see energyRestriction).
  const restriction = energyRestriction(inputs);
  let target = tdee;
  const goalLabel = GOAL_LABELS[inputs.goal];
  if (inputs.goal === 'lose' && restriction) {
    lines.push(`Objetivo (${goalLabel}): sin déficit (${PHYSIOLOGICAL_LABEL_SHORT[restriction.key]}) = ${f0(target)} kcal`);
  } else if (inputs.goal === 'lose') {
    target = tdee - inputs.deficitKcal;
    lines.push(`Objetivo (${goalLabel}): ${f0(tdee)} − ${f0(inputs.deficitKcal)} = ${f0(target)} kcal`);
  } else if (inputs.goal === 'gain') {
    target = tdee + inputs.surplusKcal;
    lines.push(`Objetivo (${goalLabel}): ${f0(tdee)} + ${f0(inputs.surplusKcal)} = ${f0(target)} kcal`);
  } else {
    lines.push(`Objetivo (${goalLabel}): igual al gasto total = ${f0(target)} kcal`);
  }
  if (restriction) warnings.push(restriction.text);

  // Shared safety floor (safetyFloorKcal, same as the adaptive module), never above the estimated
  // expenditure: a floor must not turn a goal into a surplus.
  const floor = Math.min(safetyFloorKcal(inputs.sex, bmr), tdee);
  let kcal = Math.round(target);
  if (target < floor) {
    kcal = Math.round(floor);
    warnings.push(
      `El objetivo quedó por debajo del mínimo de seguridad orientativo (${f0(floor)} kcal); se ajustó. Ese mínimo es el mayor entre tu gasto en reposo y ${f0(SEX_MIN_KCAL[inputs.sex])} kcal, sin superar tu gasto total estimado: una referencia clínica, no un requerimiento.`,
    );
    lines.push(`Ajuste: mínimo de seguridad orientativo = máx(TMB, ${f0(SEX_MIN_KCAL[inputs.sex])}) sin superar el GET → ${f0(kcal)} kcal`);
  }

  const protein = Math.round(inputs.proteinGPerKg * inputs.weightKg);
  lines.push(
    `Proteína: ${formatNumber(inputs.proteinGPerKg, 2)} g/kg × ${formatNumber(inputs.weightKg, 2)} kg = ${f0(protein)} g`,
  );
  const fat = Math.round((kcal * inputs.fatPct) / 9);
  lines.push(`Grasa: ${formatNumber(inputs.fatPct * 100, 1)} % de las kcal = ${f0(fat)} g`);
  let carbs = Math.round((kcal - 4 * protein - 9 * fat) / 4);
  if (carbs < 0) {
    carbs = 0;
    warnings.push('Las kcal no alcanzan para la proteína y la grasa elegidas; los carbohidratos quedaron en 0 g.');
  }
  lines.push(`Carbohidratos: resto = (${f0(kcal)} − 4×${f0(protein)} − 9×${f0(fat)}) ÷ 4 = ${f0(carbs)} g`);
  const fiber = Math.round((kcal / 1000) * inputs.fiberPer1000);
  lines.push(`Fibra: ${formatNumber(inputs.fiberPer1000, 1)} g por cada 1000 kcal = ${f0(fiber)} g (base de la ingesta adecuada del IOM 2005)`);
  warnings.push(...macroAdvisories({ kcal, protein, fat, carbs, weightKg: inputs.weightKg, heightCm: inputs.heightCm }));
  lines.push(
    band
      ? 'Fuentes: Schofield 1985; FAO/OMS/UNU 2004 (Human Energy Requirements); RIEN, Res. 3803/2016 del Ministerio de Salud.'
      : 'Fuentes: Mifflin y cols. 1990 (gasto en reposo; adultos de 19 a 78 años). Los factores de actividad 1,2–1,9 son multiplicadores divulgativos (textos de fisiología del ejercicio), no medidos con agua doblemente marcada.',
  );
  lines.push('Son estimaciones (error típico de ±10 % o más): ajusta según la evolución real de tu peso y medidas.');

  return { bmr, tdee, kcal, protein, fat, carbs, fiber, warnings, method: lines.join('\n'), inputs };
}

const PHYSIOLOGICAL_LABEL_SHORT: Record<'minor' | 'pregnant' | 'lactating', string> = {
  minor: 'menor de 18 años',
  pregnant: 'embarazo',
  lactating: 'lactancia',
};
