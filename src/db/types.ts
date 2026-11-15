import type { ProtocolId, SkinfoldSite } from '../domain/bodycomp'
import type { ActivityKey, GoalType, Sex } from '../domain/energy'
import type { QtyUnit } from '../domain/units'
import type { FoodBasis, FoodKind, FoodSource, NutrientCode, NutrientMap, TrackingType } from './catalogTypes'

export type ID = string
/** Local calendar date, YYYY-MM-DD (America/Bogota). */
export type LocalDate = string

export interface BaseRow {
  id: ID
  createdAt: string
  updatedAt: string
}
export interface PersonalRow extends BaseRow {
  profileId: ID
}
/** Provenance for rows that came from an import (Phase 0 history, backups). */
export interface Provenance {
  origin?: 'app' | 'phase0'
  sourceRef?: string
  approx?: boolean
  excludeFromStats?: boolean
}

// ───────────── Profiles & goals ─────────────
export interface ProfileSettings {
  /** Add logged activity kcal to the daily food budget (default false: informational only). */
  addActivityKcal: boolean
  skinfoldProtocol?: ProtocolId
  weekStartsMonday?: boolean
}
export interface Profile extends BaseRow {
  name: string
  sex: Sex
  birthDate: LocalDate | null
  heightCm: number | null
  activity: ActivityKey | null
  color: ProfileColor
  settings: ProfileSettings
}
export type ProfileColor = 'emerald' | 'violet' | 'amber' | 'sky' | 'rose'

export interface GoalInputs {
  weightKg: number
  heightCm: number
  ageYears: number
  sex: Sex
  activity: ActivityKey
  goal: GoalType
  deficitKcal: number
  surplusKcal: number
  proteinGPerKg: number
  fatPct: number
  fiberPer1000: number
}
export interface Goal extends PersonalRow, Provenance {
  validFrom: LocalDate
  goal: GoalType
  /** 'calculated' = Mifflin-St Jeor pipeline; 'manual' = user typed the numbers. */
  method: 'calculated' | 'manual'
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  inputs: GoalInputs | null
  methodText: string
  warnings: string[]
  targetWeightKg: number | null
  notes?: string
}

// ───────────── Nutrition ─────────────
export type MealKey = 'desayuno' | 'media_manana' | 'almuerzo' | 'onces' | 'cena' | 'otro'

/** Immutable nutrition snapshot stored with every log / recipe ingredient / template item. */
export interface FoodSnapshot {
  foodRef: string
  name: string
  brand?: string | null
  source: FoodSource
  datasetVersion?: string | null
  kind?: FoodKind | null
  qty: number
  unit: QtyUnit
  portionLabel?: string | null
  grams: number | null
  ml: number | null
  /** Absolute amounts for this quantity. Missing key = unknown. */
  nutrients: NutrientMap
  /** Core nutrients unknown for this entry. */
  missing: NutrientCode[]
}

export interface FoodLog extends PersonalRow, FoodSnapshot, Provenance {
  date: LocalDate
  time?: string | null
  meal: MealKey
  note?: string
}

/** Foods a person created (by hand or from a nutrition label). */
export interface CustomFood extends PersonalRow {
  source: 'user' | 'label'
  name: string
  brand: string | null
  barcode: string | null
  category: string | null
  kind: FoodKind
  basis: FoodBasis
  /** Per basis (100 g, 100 ml or one serving). */
  nutrients: NutrientMap
  portions: [string, number][]
  servingSize: number | null
  servingUnit: 'g' | 'ml' | null
  notes?: string
}

/** Shared reference foods imported on this device: private ICBF table, Open Food Facts cache. */
export interface RefFood {
  id: string // "icbf_tcac2015:…" | "off:…"
  source: 'icbf_tcac2015' | 'off'
  name: string
  nameEs: string | null
  brand: string | null
  barcode: string | null
  category: string | null
  kind: FoodKind
  basis: FoodBasis
  nutrients: NutrientMap
  portions: [string, number][]
  synonyms: string | null
  flags: string[]
  datasetVersion: string
  fetchedAt: string
}

export interface RecipeIngredient extends FoodSnapshot {
  key: string
}
export interface Recipe extends PersonalRow {
  name: string
  servings: number
  /** Total cooked weight in grams; enables per-100 g values. */
  cookedWeightG: number | null
  ingredients: RecipeIngredient[]
  notes?: string
}

export interface MealTemplate extends PersonalRow {
  name: string
  meal: MealKey | null
  items: FoodSnapshot[]
}

export interface Favorite extends PersonalRow {
  foodRef: string
  name: string
  source: FoodSource
}
export interface Recent extends PersonalRow {
  foodRef: string
  name: string
  source: FoodSource
  lastUsedAt: string
  count: number
  lastQty: number
  lastUnit: QtyUnit
  lastPortionLabel?: string | null
}

// ───────────── Training ─────────────
export interface RoutineExercise {
  key: string
  exerciseId: string
  name: string
  trackingType: TrackingType
  targetSets: number
  targetReps: string
  restSec: number
  notes?: string
}
export interface Routine extends PersonalRow {
  name: string
  notes?: string
  exercises: RoutineExercise[]
  archived?: boolean
}
export interface TrainingSession extends PersonalRow, Provenance {
  date: LocalDate
  name: string
  routineId: ID | null
  status: 'active' | 'done'
  startedAt: string | null
  endedAt: string | null
  /** Rest timer end, epoch ms (survives reloads). */
  restEndsAt: number | null
  /** Exercise order within the session. */
  exerciseOrder: { exerciseId: string; name: string; trackingType: TrackingType; restSec: number }[]
  notes?: string
  rpe?: number | null
  durationMin?: number | null
}
export interface ExerciseSet extends PersonalRow, Provenance {
  sessionId: ID
  date: LocalDate
  exerciseId: string
  exerciseName: string
  setIndex: number
  weight: number | null
  reps: number | null
  durationSec: number | null
  distanceM: number | null
  rpe: number | null
  isWarmup: boolean
  done: boolean
  notes?: string
}
export interface CustomExercise extends PersonalRow {
  nameEs: string
  aliases: string[]
  primaryMuscles: string[]
  secondaryMuscles: string[]
  equipment: string | null
  category: string
  trackingType: TrackingType
  instructionsEs: string[]
}

// ───────────── Body ─────────────
export type CircumferenceKey =
  | 'waist'
  | 'hip'
  | 'neck'
  | 'chest'
  | 'armRelaxed'
  | 'armContracted'
  | 'forearm'
  | 'thigh'
  | 'calf'

export interface DerivedBodyComp {
  estimated: true
  protocol: ProtocolId
  equation: string | null
  method: string
  sum: number | null
  density?: number
  bodyFatPct?: number
  fatMassKg?: number
  leanMassKg?: number
  inputs: { sex: Sex; ageYears: number; weightKg: number | null; heightCm: number | null }
  computedAt: string
}
export interface BodyMeasurement extends PersonalRow, Provenance {
  date: LocalDate
  time?: string | null
  weightKg: number | null
  circumferences: Partial<Record<CircumferenceKey, number>>
  skinfolds: Partial<Record<SkinfoldSite, number>>
  protocol: ProtocolId | null
  /** Calculated values, stored apart from the raw measurements. */
  derived: DerivedBodyComp | null
  notes?: string
}

// ───────────── Health modules ─────────────
export interface ActivityLog extends PersonalRow, Provenance {
  date: LocalDate
  type: string
  steps: number | null
  activeKcal: number | null
  minutes: number | null
  distanceKm: number | null
  notes?: string
}
export interface SleepLog extends PersonalRow, Provenance {
  /** Date of waking up. */
  date: LocalDate
  hours: number | null
  bedtime: string | null
  waketime: string | null
  quality: number | null
  notes?: string
}
export interface RecoveryLog extends PersonalRow, Provenance {
  date: LocalDate
  energy: number | null
  soreness: number | null
  stress: number | null
  mood: number | null
  restingHr: number | null
  notes?: string
}
export interface Habit extends PersonalRow {
  name: string
  kind: 'habit' | 'supplement'
  dose: string | null
  target: number
  unit: string | null
  active: boolean
  order: number
}
export interface HabitLog extends PersonalRow {
  habitId: ID
  date: LocalDate
  value: number
  notes?: string
}
/** Phase 0 day-level values without food detail (intake totals, band kcal, …). */
export interface ImportedDaily extends PersonalRow, Provenance {
  date: LocalDate
  metric: string
  value: number | null
  valueText: string | null
  unit: string | null
  label: string
}

export interface MetaRow {
  key: string
  value: unknown
}
