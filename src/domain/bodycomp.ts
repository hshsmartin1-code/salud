import type { Sex } from './energy';
import { formatNumber } from './units';

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Waist-to-height ratio. */
export function whtr(waistCm: number, heightCm: number): number {
  return waistCm / heightCm;
}

/** Fat-free mass index (Kouri 1995): lean/h²; normalized to 1.8 m: + 6.1·(1.8 − h). */
export function ffmi(
  weightKg: number,
  bodyFatPct: number,
  heightCm: number,
): { leanKg: number; ffmi: number; normalized: number } {
  const h = heightCm / 100;
  const leanKg = weightKg * (1 - bodyFatPct / 100);
  const v = leanKg / (h * h);
  return { leanKg, ffmi: v, normalized: v + 6.1 * (1.8 - h) };
}

export type SkinfoldSite =
  | 'chest'
  | 'midaxillary'
  | 'triceps'
  | 'subscapular'
  | 'abdominal'
  | 'suprailiac'
  | 'supraspinale'
  | 'thigh'
  | 'biceps'
  | 'calf';

export const SKINFOLD_SITES: readonly { key: SkinfoldSite; es: string; hint: string }[] = [
  { key: 'chest', es: 'Pectoral', hint: 'Pliegue diagonal entre la axila y el pezón (hombres: mitad de la distancia).' },
  { key: 'midaxillary', es: 'Axilar media', hint: 'Vertical, en la línea media de la axila, a la altura del esternón (apófisis xifoides).' },
  { key: 'triceps', es: 'Tríceps', hint: 'Vertical, cara posterior del brazo, punto medio entre acromion y olécranon.' },
  { key: 'subscapular', es: 'Subescapular', hint: 'Diagonal, 2 cm debajo del ángulo inferior de la escápula.' },
  { key: 'abdominal', es: 'Abdominal', hint: 'Vertical (o horizontal), 2–3 cm al lado del ombligo.' },
  { key: 'suprailiac', es: 'Cresta ilíaca (suprailíaco)', hint: 'Diagonal, justo encima de la cresta ilíaca, en la línea axilar media.' },
  { key: 'supraspinale', es: 'Supraespinal', hint: 'Diagonal, intersección de la línea axilar anterior con la horizontal de la cresta ilíaca.' },
  { key: 'thigh', es: 'Muslo anterior', hint: 'Vertical, punto medio entre el pliegue inguinal y el borde superior de la rótula.' },
  { key: 'biceps', es: 'Bíceps', hint: 'Vertical, cara anterior del brazo, a la misma altura que el tríceps.' },
  { key: 'calf', es: 'Pantorrilla medial', hint: 'Vertical, cara interna de la pantorrilla, en su máxima circunferencia.' },
];

const SITE_ES: Record<SkinfoldSite, string> = Object.fromEntries(
  SKINFOLD_SITES.map((s) => [s.key, s.es]),
) as Record<SkinfoldSite, string>;

export type ProtocolId =
  | 'jp7'
  | 'jp3_male'
  | 'jp3_female'
  | 'dw4'
  | 'isak7_calf'
  | 'isak7_thigh'
  | 'isak8'
  | 'sum_custom';

export const PROTOCOLS: readonly {
  id: ProtocolId;
  es: string;
  sites: SkinfoldSite[];
  equation: 'jp7' | 'jp3' | 'dw4' | null;
  sex: Sex | null;
  note: string;
}[] = [
  {
    id: 'jp7',
    es: 'Jackson & Pollock 7 pliegues',
    sites: ['chest', 'midaxillary', 'triceps', 'subscapular', 'abdominal', 'suprailiac', 'thigh'],
    equation: 'jp7',
    sex: null,
    note: 'Ecuación de densidad corporal; validada en adultos de 18 a 61 años.',
  },
  {
    id: 'jp3_male',
    es: 'Jackson & Pollock 3 pliegues (hombres)',
    sites: ['chest', 'abdominal', 'thigh'],
    equation: 'jp3',
    sex: 'male',
    note: 'Pectoral, abdominal y muslo. Solo para hombres de 18 a 61 años.',
  },
  {
    id: 'jp3_female',
    es: 'Jackson & Pollock 3 pliegues (mujeres)',
    sites: ['triceps', 'suprailiac', 'thigh'],
    equation: 'jp3',
    sex: 'female',
    note: 'Tríceps, suprailíaco y muslo. Solo para mujeres de 18 a 61 años.',
  },
  {
    id: 'dw4',
    es: 'Durnin & Womersley 4 pliegues',
    sites: ['biceps', 'triceps', 'subscapular', 'suprailiac'],
    equation: 'dw4',
    sex: null,
    note: 'Ecuación logarítmica por edad y sexo; adultos de 17 años en adelante.',
  },
  {
    id: 'isak7_calf',
    es: 'ISAK 7 pliegues (con pantorrilla)',
    sites: ['triceps', 'subscapular', 'biceps', 'suprailiac', 'supraspinale', 'abdominal', 'calf'],
    equation: null,
    sex: null,
    note: 'Solo suma de pliegues (mm); útil para seguir cambios, sin estimar % de grasa.',
  },
  {
    id: 'isak7_thigh',
    es: 'ISAK 7 pliegues (con muslo)',
    sites: ['triceps', 'subscapular', 'biceps', 'suprailiac', 'supraspinale', 'abdominal', 'thigh'],
    equation: null,
    sex: null,
    note: 'Solo suma de pliegues (mm); útil para seguir cambios, sin estimar % de grasa.',
  },
  {
    id: 'isak8',
    es: 'ISAK 8 pliegues',
    sites: ['triceps', 'subscapular', 'biceps', 'suprailiac', 'supraspinale', 'abdominal', 'thigh', 'calf'],
    equation: null,
    sex: null,
    note: 'Solo suma de pliegues (mm); útil para seguir cambios, sin estimar % de grasa.',
  },
  {
    id: 'sum_custom',
    es: 'Suma personalizada',
    sites: [],
    equation: null,
    sex: null,
    note: 'Suma de los pliegues que midas; compara siempre con los mismos sitios.',
  },
];

// --- Equations -------------------------------------------------------------------------------

/** Jackson & Pollock 7-site (Jackson & Pollock 1978, Br J Nutr 40:497; women: Jackson, Pollock & Ward 1980, Med Sci Sports Exerc 12:175). S = sum of 7 skinfolds in mm. */
export function jp7Density(sumMm: number, age: number, sex: Sex): number {
  return sex === 'male'
    ? 1.112 - 0.00043499 * sumMm + 0.00000055 * sumMm ** 2 - 0.00028826 * age
    : 1.097 - 0.00046971 * sumMm + 0.00000056 * sumMm ** 2 - 0.00012828 * age;
}

/** Jackson & Pollock 3-site. Men (chest, abdominal, thigh): Jackson & Pollock 1978. Women (triceps, suprailiac, thigh): Jackson, Pollock & Ward 1980. */
export function jp3Density(sumMm: number, age: number, sex: Sex): number {
  return sex === 'male'
    ? 1.10938 - 0.0008267 * sumMm + 0.0000016 * sumMm ** 2 - 0.0002574 * age
    : 1.0994921 - 0.0009929 * sumMm + 0.0000023 * sumMm ** 2 - 0.0001392 * age;
}

/**
 * Durnin & Womersley (1974), Br J Nutr 32:77-97: D = c − m·log10(Σ biceps, triceps, subscapular, suprailiac).
 * Coefficients (c, m) as in the commonly reproduced table of the paper (checked against memory of
 * the published table; not re-verified online in this session).
 */
const DW_COEF: Record<Sex, [number, number, number][]> = {
  // [min age, c, m]
  male: [
    [50, 1.1715, 0.0779],
    [40, 1.162, 0.07],
    [30, 1.1422, 0.0544],
    [20, 1.1631, 0.0632],
    [0, 1.162, 0.063],
  ],
  female: [
    [50, 1.1339, 0.0645],
    [40, 1.1333, 0.0612],
    [30, 1.1423, 0.0632],
    [20, 1.1599, 0.0717],
    [0, 1.1549, 0.0678],
  ],
};

export function dw4Density(sumMm: number, age: number, sex: Sex): number {
  const row = DW_COEF[sex].find((r) => age >= r[0])!;
  return row[1] - row[2] * Math.log10(sumMm);
}

/** Siri (1961): %BF = 495/D − 450. */
export function siri(density: number): number {
  return 495 / density - 450;
}

/** Brozek (1963): %BF = 457/D − 414.2. */
export function brozek(density: number): number {
  return 457 / density - 414.2;
}

// --- Orchestration ---------------------------------------------------------------------------

export interface BodyCompInput {
  protocol: ProtocolId;
  sex: Sex;
  ageYears: number;
  skinfolds: Partial<Record<SkinfoldSite, number>>;
  weightKg?: number | null;
  heightCm?: number | null;
}

export interface BodyCompResult {
  sum: number | null;
  sitesUsed: SkinfoldSite[];
  missingSites: SkinfoldSite[];
  density?: number;
  bodyFatPct?: number;
  fatMassKg?: number;
  leanMassKg?: number;
  equation: string | null;
  method: string;
  warnings: string[];
}

const validSf = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function computeBodyComp(input: BodyCompInput): BodyCompResult {
  const proto = PROTOCOLS.find((p) => p.id === input.protocol);
  if (!proto) throw new Error('Protocolo no válido');
  const warnings: string[] = [];
  const f1 = (n: number) => formatNumber(n, 1);

  let sites: SkinfoldSite[];
  let missing: SkinfoldSite[] = [];
  if (proto.id === 'sum_custom') {
    sites = SKINFOLD_SITES.map((s) => s.key).filter((k) => validSf(input.skinfolds[k]));
  } else {
    sites = proto.sites.filter((k) => validSf(input.skinfolds[k]));
    missing = proto.sites.filter((k) => !validSf(input.skinfolds[k]));
  }
  const base = { sitesUsed: sites, missingSites: missing, equation: null as string | null, warnings };

  if (missing.length > 0) {
    return {
      ...base,
      sum: null,
      method: `${proto.es}: faltan pliegues (${missing.map((k) => SITE_ES[k]).join(', ')}); no se puede calcular.`,
    };
  }
  if (sites.length === 0) {
    return { ...base, sum: null, method: `${proto.es}: no hay pliegues registrados.` };
  }

  const sum = sites.reduce((a, k) => a + (input.skinfolds[k] as number), 0);

  if (proto.equation === null) {
    return {
      ...base,
      sum,
      method: `${proto.es}: Σ de ${sites.length} pliegues = ${f1(sum)} mm. Es una suma de pliegues, sin ecuación de % de grasa; úsala para comparar tu evolución con las mismas mediciones.`,
    };
  }

  if (proto.sex !== null && proto.sex !== input.sex) {
    warnings.push(`El protocolo "${proto.es}" es solo para ${proto.sex === 'male' ? 'hombres' : 'mujeres'}; no se estimó el % de grasa.`);
    return { ...base, sum, method: `${proto.es}: Σ = ${f1(sum)} mm. Protocolo no aplicable al sexo indicado.` };
  }

  const age = input.ageYears;
  if (proto.equation === 'dw4') {
    if (age < 17) warnings.push('Durnin & Womersley se validó desde los 17 años; el resultado es poco fiable.');
  } else if (age < 18 || age > 61) {
    warnings.push('Jackson & Pollock se validó en adultos de 18 a 61 años; el resultado es poco fiable.');
  }

  const density =
    proto.equation === 'jp7'
      ? jp7Density(sum, age, input.sex)
      : proto.equation === 'jp3'
        ? jp3Density(sum, age, input.sex)
        : dw4Density(sum, age, input.sex);
  const bodyFatPct = siri(density);
  const equation = proto.equation === 'jp7' ? 'Jackson & Pollock 1978/1980' : proto.equation === 'jp3' ? 'Jackson & Pollock 1978/1980 (3 pliegues)' : 'Durnin & Womersley 1974';

  if (bodyFatPct < 2 || bodyFatPct > 60) warnings.push('El % de grasa calculado es poco plausible; revisa las mediciones.');

  let fatMassKg: number | undefined;
  let leanMassKg: number | undefined;
  const w = input.weightKg;
  if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
    fatMassKg = (w * bodyFatPct) / 100;
    leanMassKg = w - fatMassKg;
  }

  const method =
    `${proto.es} (${input.sex === 'male' ? 'hombre' : 'mujer'}): Σ=${f1(sum)} mm, edad ${formatNumber(age, 0)} → D=${formatNumber(density, 4)}; ` +
    `Siri: %GC = 495/D − 450 = ${f1(bodyFatPct)} %. ` +
    'Es una estimación (error típico de varios puntos porcentuales); no sustituye una evaluación profesional.';

  return {
    ...base,
    sum,
    density,
    bodyFatPct,
    fatMassKg,
    leanMassKg,
    equation,
    method,
  };
}
