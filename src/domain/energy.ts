import { formatNumber } from './units';

export type Sex = 'male' | 'female';
export type ActivityKey = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain' | 'recomp';

export const ACTIVITY_LEVELS: readonly { key: ActivityKey; factor: number; es: string; description: string }[] = [
  { key: 'sedentary', factor: 1.2, es: 'Sedentaria', description: 'Poco o ningún ejercicio; trabajo de escritorio.' },
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
  activity: ActivityKey;
  goal: GoalType;
  deficitKcal?: number;
  surplusKcal?: number;
  proteinGPerKg?: number;
  fatPct?: number;
  fiberPer1000?: number;
}

export interface TargetInputResolved extends TargetInput {
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
  const inputs: TargetInputResolved = {
    ...input,
    deficitKcal: input.deficitKcal ?? 400,
    surplusKcal: input.surplusKcal ?? 250,
    proteinGPerKg: input.proteinGPerKg ?? (input.goal === 'recomp' ? 2.0 : 1.8),
    fatPct: input.fatPct ?? 0.27,
    fiberPer1000: input.fiberPer1000 ?? 14,
  };
  assertRange('El peso (kg)', inputs.weightKg, 20, 400);
  assertRange('La estatura (cm)', inputs.heightCm, 100, 250);
  assertRange('La edad (años)', inputs.ageYears, 10, 110);
  assertRange('El déficit (kcal)', inputs.deficitKcal, 0, 2000);
  assertRange('El superávit (kcal)', inputs.surplusKcal, 0, 2000);
  assertRange('La proteína (g/kg)', inputs.proteinGPerKg, 0.3, 4);
  assertRange('El porcentaje de grasa', inputs.fatPct, 0.05, 0.6);
  assertRange('La fibra (g por 1000 kcal)', inputs.fiberPer1000, 0, 60);
  if (inputs.sex !== 'male' && inputs.sex !== 'female') throw new Error('El sexo debe ser "male" o "female"');
  const level = ACTIVITY_LEVELS.find((l) => l.key === inputs.activity);
  if (!level) throw new Error('Nivel de actividad no válido');
  if (!(inputs.goal in GOAL_LABELS)) throw new Error('Objetivo no válido');

  const f0 = (n: number) => formatNumber(n, 0);
  const warnings: string[] = [];
  const lines: string[] = [];

  const bmr = mifflinStJeor(inputs);
  lines.push(
    `TMB (Mifflin-St Jeor, ${inputs.sex === 'male' ? 'hombre' : 'mujer'}): 10×${formatNumber(inputs.weightKg, 2)} + 6,25×${formatNumber(inputs.heightCm, 2)} − 5×${formatNumber(inputs.ageYears, 0)} ${inputs.sex === 'male' ? '+ 5' : '− 161'} = ${f0(bmr)} kcal`,
  );
  const tdee = bmr * level.factor;
  lines.push(`Gasto total: ${f0(bmr)} × ${formatNumber(level.factor, 3)} (${level.es}) = ${f0(tdee)} kcal`);

  let target = tdee;
  const goalLabel = GOAL_LABELS[inputs.goal];
  if (inputs.goal === 'lose') {
    target = tdee - inputs.deficitKcal;
    lines.push(`Objetivo (${goalLabel}): ${f0(tdee)} − ${f0(inputs.deficitKcal)} = ${f0(target)} kcal`);
  } else if (inputs.goal === 'gain') {
    target = tdee + inputs.surplusKcal;
    lines.push(`Objetivo (${goalLabel}): ${f0(tdee)} + ${f0(inputs.surplusKcal)} = ${f0(target)} kcal`);
  } else {
    lines.push(`Objetivo (${goalLabel}): igual al gasto total = ${f0(target)} kcal`);
  }

  let kcal = Math.round(target);
  if (target < bmr) {
    kcal = Math.round(bmr);
    warnings.push('El objetivo quedó por debajo del metabolismo basal; se ajustó a la TMB.');
    lines.push(`Ajuste: no se baja de la TMB → ${f0(kcal)} kcal`);
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
  lines.push(`Fibra: ${formatNumber(inputs.fiberPer1000, 1)} g por cada 1000 kcal = ${f0(fiber)} g`);
  lines.push('Son estimaciones: ajusta según la evolución real de tu peso y medidas.');

  return { bmr, tdee, kcal, protein, fat, carbs, fiber, warnings, method: lines.join('\n'), inputs };
}
