/**
 * CONTRACT shared by the data pipelines (Python, data-pipeline/) and the app.
 * Changing anything here requires regenerating public/data/*.json.
 */

/** Canonical nutrient codes, fixed order (index = position in catalog nutrient arrays). */
export const NUTRIENTS = [
  { code: 'kcal', unit: 'kcal', es: 'Energía' },
  { code: 'kj', unit: 'kJ', es: 'Energía (kJ)' },
  { code: 'protein', unit: 'g', es: 'Proteína' },
  { code: 'carbs', unit: 'g', es: 'Carbohidratos totales' },
  { code: 'carbsAvail', unit: 'g', es: 'Carbohidratos disponibles' },
  { code: 'fat', unit: 'g', es: 'Grasa total' },
  { code: 'satFat', unit: 'g', es: 'Grasa saturada' },
  { code: 'monoFat', unit: 'g', es: 'Grasa monoinsaturada' },
  { code: 'polyFat', unit: 'g', es: 'Grasa poliinsaturada' },
  { code: 'transFat', unit: 'g', es: 'Grasa trans' },
  { code: 'fiber', unit: 'g', es: 'Fibra dietaria' },
  { code: 'sugars', unit: 'g', es: 'Azúcares totales' },
  { code: 'addedSugars', unit: 'g', es: 'Azúcares añadidos' },
  { code: 'sodium', unit: 'mg', es: 'Sodio' },
  { code: 'cholesterol', unit: 'mg', es: 'Colesterol' },
  { code: 'potassium', unit: 'mg', es: 'Potasio' },
  { code: 'calcium', unit: 'mg', es: 'Calcio' },
  { code: 'iron', unit: 'mg', es: 'Hierro' },
  { code: 'magnesium', unit: 'mg', es: 'Magnesio' },
  { code: 'phosphorus', unit: 'mg', es: 'Fósforo' },
  { code: 'zinc', unit: 'mg', es: 'Zinc' },
  { code: 'vitA', unit: 'µg', es: 'Vitamina A (ER/RAE)' },
  { code: 'vitC', unit: 'mg', es: 'Vitamina C' },
  { code: 'vitD', unit: 'µg', es: 'Vitamina D' },
  { code: 'vitE', unit: 'mg', es: 'Vitamina E' },
  { code: 'vitB12', unit: 'µg', es: 'Vitamina B12' },
  { code: 'folate', unit: 'µg', es: 'Folato' },
  { code: 'water', unit: 'g', es: 'Agua' },
] as const;

export type NutrientCode = (typeof NUTRIENTS)[number]['code'];
export const NUTRIENT_CODES: NutrientCode[] = NUTRIENTS.map((n) => n.code);

/** Sparse map: a MISSING key means "unknown", never zero. */
export type NutrientMap = Partial<Record<NutrientCode, number>>;

export type FoodSource =
  | 'usda_foundation'
  | 'usda_sr'
  | 'usda_fndds'
  | 'off'
  | 'icbf_tcac2015'
  | 'user'
  | 'label'
  | 'recipe';

export type FoodKind = 'generic' | 'raw' | 'cooked' | 'prepared' | 'packaged' | 'recipe' | 'user';
export type FoodBasis = '100g' | '100ml' | 'serving';

/**
 * Compact catalog row (public/data/foods-*.json and private-data/tcac2015.json):
 * [id, name, nameEs, brand, barcode, category, kind, basis, nutrients, portions, synonyms, flags]
 * - id: "<source>:<sourceId>" e.g. "usda_sr:171477", "off:7702011000000", "icbf_tcac2015:A001"
 * - name: name in the source language (English for USDA)
 * - nameEs: Spanish display name or null
 * - nutrients: numbers aligned with file-level `nutrientOrder`; null = unknown (never 0 for unknown)
 * - portions: [[label, grams], ...] household portions in grams (ml for basis 100ml), or null
 * - synonyms: space-separated, lowercase, accent-free extra search terms (Spanish first) or null
 * - flags: semicolon-separated quality flags (e.g. "kcal_from_kj;curated_es") or null
 */
export type CatalogFoodRow = [
  id: string,
  name: string,
  nameEs: string | null,
  brand: string | null,
  barcode: string | null,
  category: string | null,
  kind: FoodKind,
  basis: '100g' | '100ml',
  nutrients: (number | null)[],
  portions: [string, number][] | null,
  synonyms: string | null,
  flags: string | null,
];

export interface CatalogFoodFile {
  format: 'pho-catalog-foods';
  version: 1;
  source: FoodSource | 'usda';
  datasetVersion: string; // e.g. "SR Legacy 2018-04; Foundation 2026-10-29; FNDDS 2021-2023"
  generatedAt: string; // ISO timestamp
  license: string; // "CC0-1.0" | "ODbL-1.0" | "private-personal-use"
  attribution: string;
  nutrientOrder: NutrientCode[];
  counts: Record<string, number>; // per source
  foods: CatalogFoodRow[];
}

export type TrackingType = 'weight_reps' | 'bodyweight_reps' | 'time' | 'distance';

export interface CatalogExercise {
  id: string; // "fedb:Barbell_Squat"
  nameEs: string;
  nameEn: string;
  aliases: string[]; // Spanish + English aliases
  primaryMuscles: string[]; // canonical English keys, e.g. "quadriceps"
  secondaryMuscles: string[];
  equipment: string | null; // canonical key e.g. "barbell"
  category: string; // strength | stretching | cardio | plyometrics | powerlifting | olympic weightlifting | strongman
  level: string | null; // beginner | intermediate | expert
  mechanic: string | null; // compound | isolation
  force: string | null; // push | pull | static
  trackingType: TrackingType;
  instructionsEs: string[];
}

export interface CatalogExerciseFile {
  format: 'pho-catalog-exercises';
  version: 1;
  source: string;
  datasetVersion: string;
  generatedAt: string;
  license: string;
  attribution: string;
  labelsEs: { muscles: Record<string, string>; equipment: Record<string, string>; category: Record<string, string> };
  exercises: CatalogExercise[];
}
