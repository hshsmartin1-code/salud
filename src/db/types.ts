import type { ProtocolId, SkinfoldSite } from '../domain/bodycomp'
import type { ActivityKey, GoalType, Sex } from '../domain/energy'
import type { QtyUnit } from '../domain/units'
import type { HouseholdPortion, PortionVerification } from '../domain/portions'
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
  /** Adaptive energy settings for this profile (absent = adaptation off). */
  adaptive?: StoredAdaptiveSettings
  /** Daily step goal for the movement indicator (null/absent = no goal shown). */
  stepGoal?: number | null
  /** Daily water goal in ml (null/absent = no goal). */
  waterGoalMl?: number | null
  /** Water quick-add containers of this profile (max 6; default 250 and 500 ml). */
  hydration?: { containers?: { label: string; ml: number }[] }
  dashboard?: { order?: DashboardIndicator[]; hidden?: DashboardIndicator[]; hideEmpty?: boolean }
  /** V3 training preferences (absent = defaults). Travels with the profile row. */
  training?: TrainingSettings
  /** V3.2 meal slots of this profile, in display order (absent = defaults, see nutrition/mealSlots.ts). */
  meals?: MealSlotPref[]
}
/** V3.2: one configurable meal slot. `key` is the stored MealKey and never changes; only presentation does. */
export interface MealSlotPref {
  key: MealKey
  on: boolean
  /** Custom name (absent = the default Spanish name of the key). */
  name?: string
  /** Usual local time 'HH:MM' (absent = none). */
  time?: string
}
/** V3.2: weekly training plan. A plan never creates or changes sessions; "done" comes only from real sessions. */
export interface TrainingPlan {
  /** ISO weekday '1' (Monday) … '7' (Sunday) → a training day, optionally with a routine. Absent weekday = rest. */
  days?: Record<string, { routineId?: ID | null }>
  /** One-off changes by local date (YYYY-MM-DD): rest that date, or train that date (optionally another routine). */
  overrides?: Record<string, { rest: true } | { routineId?: ID | null }>
  /** Optional reminder on training days at a local time 'HH:MM'. Scheduling is per device and needs its permission. */
  reminder?: { on: boolean; time: string }
}
/** V3: optional training preferences. Every field is optional; absent keeps the 2.2.1 behaviour. */
export interface TrainingSettings {
  /** Start the rest timer when a work set is completed (default true). */
  autoRest?: boolean
  /** Effort column shown in the live session (default 'none'). */
  effort?: 'none' | 'rpe' | 'rir'
  /** End-of-rest alert: notification, vibration and tone (default true; web notifications need permission). */
  restAlert?: boolean
  /** Keep the screen on during a live session (Screen Wake Lock, where available; default false). */
  keepAwake?: boolean
  /** V3.2 weekly plan (absent = no plan). */
  plan?: TrainingPlan
  /** V4 plate calculator: bar weight in kg (absent = 20). */
  barKg?: number
  /** V4 plate calculator: pairs of each plate owned, by denomination in kg as text (absent = defaults, see domain/plates.ts). */
  plates?: Record<string, number>
}
export type DashboardIndicator = 'weight' | 'steps' | 'sleep' | 'training' | 'water' | 'recovery' | 'habits' | 'pressure'
export interface StoredAdaptiveSettings {
  /** 'off' (default), 'suggest' (proposals need review) or 'auto' (opt-in automatic adjustments). */
  mode: 'off' | 'suggest' | 'auto'
  phase: 'deficit' | 'maintenance' | 'surplus'
  /** Target change in % of body weight per week (negative = loss). */
  targetRatePctPerWeek: number
  windowDays?: number
  maxStepKcal?: number
  cooldownDays?: number
  minKcalFloor?: number | null
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
  /** Created by an adaptive-energy adjustment (applied automatically or accepted by the user). */
  adaptive?: boolean
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
  portionId?: string
  portionSource?: FoodSource
  portionVerification?: PortionVerification
  portionEquivalentAmount?: number
  portionEquivalentUnit?: 'g' | 'ml'
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

/** Food- and profile-specific equivalence; never modifies catalog or historical snapshots. */
export type FoodPortion = PersonalRow & HouseholdPortion

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
  /** How the label states its values, before any conversion ('package' = whole package). */
  labelBasis?: 'serving' | '100g' | '100ml' | 'package' | null
  /** Values exactly as printed for labelBasis (the stored `nutrients` may be converted to per 100). */
  labelNutrients?: NutrientMap | null
  servingLabel?: string | null
  servingsPerPackage?: number | null
  packageSize?: number | null
  packageUnit?: 'g' | 'ml' | null
  /** How the values were entered; OCR and pasted text are always reviewed by the user before saving. */
  entryMethod?: 'manual' | 'text' | 'ocr'
  /** Original pasted or recognised label text (kept for traceability). */
  sourceText?: string | null
  labelImageId?: ID | null
  validation?: 'confirmed'
}

/** Optional photo of a nutrition label, stored once per food (never copied into logs). */
export interface LabelImage extends PersonalRow {
  foodId: ID | null
  /** Downscaled JPEG as a data URL, so it survives JSON backups. */
  dataUrl: string
  width: number
  height: number
  bytes: number
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
  imageUrl?: string
  packageLabel?: string
  soldInColombia?: boolean
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
  lastPortionId?: string | null
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
  /** V3: warm-up sets created (as warm-up rows, never counted as work) when a session starts from the routine. */
  warmupSets?: number
}
export interface Routine extends PersonalRow {
  name: string
  notes?: string
  exercises: RoutineExercise[]
  archived?: boolean
  /** V3: manual position in the routine list (absent = sorted by name after the ordered ones). */
  order?: number
}
/** One exercise of a session. V3 adds the optional targets and notes copied from the routine. */
export interface SessionExercise {
  exerciseId: string
  name: string
  trackingType: TrackingType
  restSec: number
  /** V3: target set count copied from the routine when the session started. */
  targetSets?: number
  /** V3: target reps text copied from the routine (e.g. "8-12"). */
  targetReps?: string
  /** V3: per-exercise note for this session (from the routine, or carried over from the last session). */
  notes?: string
}
export interface TrainingSession extends PersonalRow, Provenance {
  date: LocalDate
  name: string
  routineId: ID | null
  status: 'active' | 'done'
  startedAt: string | null
  endedAt: string | null
  /**
   * 2.2.1 rest timer end (epoch ms). V3 keeps the rest timer on the device (restTimer.ts) and never
   * writes a non-null value here; it is only cleared when an older client left one behind.
   */
  restEndsAt: number | null
  /** Exercise order within the session. */
  exerciseOrder: SessionExercise[]
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
  /**
   * Warm-up flag. Still the compatibility source for 2.2.1 clients: `kind === 'warmup'` ⇔
   * `isWarmup === true`. Read with `setKind()` and write with `setKindPatch()` (domain/setKind.ts).
   */
  isWarmup: boolean
  /** V3: set type. Absent = normal work set. Never written directly (see setKindPatch). */
  kind?: StoredSetKind
  /** V3: repetitions in reserve (null/absent = not recorded). */
  rir?: number | null
  done: boolean
  notes?: string
}
/** Stored values of ExerciseSet.kind ('normal' is represented by the field being absent). */
export type StoredSetKind = 'warmup' | 'drop' | 'failure'
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
/** User mark that a day's food log is complete (or knowingly incomplete); used by adaptive energy. */
export interface DayMark extends PersonalRow {
  date: LocalDate
  complete: boolean
}

/** One applied change of the calorie target made by the adaptive energy module. */
export interface EnergyAdjustment extends PersonalRow {
  date: LocalDate
  fromKcal: number
  toKcal: number
  formulaTdee: number | null
  observedTdee: number | null
  blendedTdee: number | null
  confidence: 'none' | 'low' | 'medium' | 'high'
  phase: 'deficit' | 'maintenance' | 'surplus'
  ratePctPerWeek: number
  applied: 'auto' | 'accepted'
  reason: string
  goalId: ID | null
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

// ───────────── V2 (schema v3): integrations, vitals, hydration, progress photos, exercise favourites ─────────────
/** Metrics imported from an external health platform (Health Connect). */
export type HealthMetric =
  | 'steps'
  | 'activeKcal'
  | 'totalKcal'
  | 'distanceM'
  | 'restingHr'
  | 'heartRateAvg'
  | 'exercise'
  | 'sleep'
  | 'weight'
  | 'bodyFat'
  | 'leanMassKg'

/** Consent groups shown to the person (one switch each). */
export type HealthCategory = 'activity' | 'heart' | 'exercise' | 'sleep' | 'body'

/**
 * One value imported from an external provider. `kind: 'daily'` rows are per-day aggregates computed by
 * the provider (de-duplicated across source apps); `kind: 'record'` rows are individual records
 * (an exercise session, a sleep session, a weigh-in). Never mixed with hand-entered data: shown with
 * their source and can be excluded from statistics.
 */
export interface HealthRecord extends PersonalRow {
  provider: 'health-connect'
  kind: 'daily' | 'record'
  metric: HealthMetric
  date: LocalDate
  start: string | null
  end: string | null
  value: number | null
  unit: string
  /** Package names of the apps that wrote the data (e.g. a band's companion app). */
  sources: string[]
  device?: string | null
  /** Provider record id (raw records) — used for de-duplication on re-import. */
  externalId: string | null
  lastModified: string | null
  title?: string | null
  detail?: Record<string, number | string | null>
  /** Excluded by the person from statistics (kept for traceability). */
  excluded?: boolean
  importedAt: string
}

export interface SyncLogEntry {
  at: string
  ok: boolean
  message: string
  counts?: Record<string, number>
}

/** Connection state of one provider for one profile. id = `${profileId}|${provider}`. */
export interface IntegrationState extends PersonalRow {
  provider: 'health-connect'
  status: 'connected' | 'disconnected'
  categories: Partial<Record<HealthCategory, boolean>>
  grantedPermissions: string[]
  linkedAt: string | null
  lastSyncAt: string | null
  lastSyncFrom: LocalDate | null
  lastSyncTo: LocalDate | null
  /** Health Connect Changes API tokens, one per record type (device-specific; never exported). */
  changesTokens: Partial<Record<string, string>>
  lastError: string | null
  log: SyncLogEntry[]
}

export type VitalKind = 'bloodPressure' | 'restingHr' | 'spo2' | 'glucose' | 'temperature'
export interface VitalSign extends PersonalRow, Provenance {
  date: LocalDate
  time: string | null
  kind: VitalKind
  /** Blood pressure only. */
  systolic?: number | null
  diastolic?: number | null
  /** Single-value vitals (bpm, %, mg/dL, °C). */
  value: number | null
  unit: string
  /** e.g. 'reposo', 'ayunas', 'posprandial'. */
  context?: string | null
  notes?: string
}

export interface HydrationLog extends PersonalRow {
  date: LocalDate
  time: string | null
  ml: number
  drink?: string | null
}

export type PhotoPose = 'front' | 'side' | 'back' | 'other'
export interface ProgressPhoto extends PersonalRow {
  date: LocalDate
  pose: PhotoPose
  /** Downscaled JPEG data URL (≤1280 px) — a string, so it survives JSON backups. */
  dataUrl: string
  /** Small preview (≤240 px). */
  thumbUrl: string
  width: number
  height: number
  bytes: number
  /** Weight on that day, copied from the measurements if present (context only). */
  weightKg?: number | null
  notes?: string
}

/** Favourite exercise. id = `${profileId}|${exerciseId}`. */
export interface ExerciseFavorite extends PersonalRow {
  exerciseId: string
  name: string
}

// ───────────── V2.2 (schema v5): device-only sync bookkeeping ─────────────

export type SyncLinkState = 'linking' | 'linked'
/** One local profile ↔ one account (Firebase uid) on this device. Never exported. */
export interface SyncLink {
  profileId: ID
  uid: string
  email: string | null
  displayName: string | null
  linkedAt: string
  state: SyncLinkState
  /** Server time (ms) of the newest remote change already applied. null = never pulled. */
  cursor: number | null
  /** Sync table list the cursor was built with; a new synced table forces one full pull. */
  tablesVersion: string
  lastSyncAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  /** Local changes not yet accepted by the server (computed at the end of each sync). */
  pending: number
  /** Deletions held back until the person confirms them (mass-delete guard). */
  heldDeletes: number
  /** Set once counts matched after the first upload/merge. */
  verifiedAt: string | null
  /**
   * `createdAt` of the account's cloud metadata when the link was verified. If the cloud copy is
   * erased and recreated (another device deleted it and linked again), the value changes and this
   * device stops instead of mixing its old revisions with the new copy (`cloud-reset`).
   */
  cloudEpoch?: number | null
}
/** Last revision/hash agreed with the server for one row. hash null = deleted (tombstone). */
export interface SyncShadow {
  k: string
  profileId: ID
  table: string
  rowId: string
  rev: number
  hash: string | null
}
/** Both versions of a row edited on two devices; nothing is overwritten until the person decides. */
export interface SyncConflict {
  id: ID
  profileId: ID
  key: string
  table: string
  rowId: string
  local: Record<string, unknown> | null
  remote: Record<string, unknown> | null
  remoteRev: number
  detectedAt: string
}
