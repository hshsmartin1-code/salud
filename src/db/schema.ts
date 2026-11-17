import Dexie, { type EntityTable } from 'dexie'
import { PERSONAL_TABLES } from './tables'
import type {
  ActivityLog,
  BodyMeasurement,
  CustomExercise,
  CustomFood,
  DayMark,
  EnergyAdjustment,
  ExerciseFavorite,
  ExerciseSet,
  Favorite,
  FoodLog,
  FoodPortion,
  SyncConflict,
  SyncLink,
  SyncShadow,
  Goal,
  Habit,
  HabitLog,
  HealthRecord,
  HydrationLog,
  ImportedDaily,
  IntegrationState,
  LabelImage,
  MealTemplate,
  MetaRow,
  Profile,
  ProgressPhoto,
  Recent,
  Recipe,
  RecoveryLog,
  RefFood,
  Routine,
  SleepLog,
  TrainingSession,
  VitalSign,
} from './types'

export const SCHEMA_VERSION = 5
export const DB_NAME = 'salud-pho'

export type SaludDB = Dexie & {
  profiles: EntityTable<Profile, 'id'>
  goals: EntityTable<Goal, 'id'>
  foodLogs: EntityTable<FoodLog, 'id'>
  customFoods: EntityTable<CustomFood, 'id'>
  refFoods: EntityTable<RefFood, 'id'>
  recipes: EntityTable<Recipe, 'id'>
  mealTemplates: EntityTable<MealTemplate, 'id'>
  favorites: EntityTable<Favorite, 'id'>
  recents: EntityTable<Recent, 'id'>
  routines: EntityTable<Routine, 'id'>
  trainingSessions: EntityTable<TrainingSession, 'id'>
  exerciseSets: EntityTable<ExerciseSet, 'id'>
  customExercises: EntityTable<CustomExercise, 'id'>
  bodyMeasurements: EntityTable<BodyMeasurement, 'id'>
  activityLogs: EntityTable<ActivityLog, 'id'>
  sleepLogs: EntityTable<SleepLog, 'id'>
  recoveryLogs: EntityTable<RecoveryLog, 'id'>
  habits: EntityTable<Habit, 'id'>
  habitLogs: EntityTable<HabitLog, 'id'>
  importedDaily: EntityTable<ImportedDaily, 'id'>
  labelImages: EntityTable<LabelImage, 'id'>
  dayMarks: EntityTable<DayMark, 'id'>
  energyAdjustments: EntityTable<EnergyAdjustment, 'id'>
  healthRecords: EntityTable<HealthRecord, 'id'>
  integrations: EntityTable<IntegrationState, 'id'>
  vitals: EntityTable<VitalSign, 'id'>
  hydrationLogs: EntityTable<HydrationLog, 'id'>
  progressPhotos: EntityTable<ProgressPhoto, 'id'>
  exerciseFavorites: EntityTable<ExerciseFavorite, 'id'>
  foodPortions: EntityTable<FoodPortion, 'id'>
  syncLinks: EntityTable<SyncLink, 'profileId'>
  syncShadow: EntityTable<SyncShadow, 'k'>
  syncConflicts: EntityTable<SyncConflict, 'id'>
  meta: EntityTable<MetaRow, 'key'>
}

export const STORES_V1: Record<string, string> = {
  profiles: 'id, name',
  goals: 'id, profileId, [profileId+validFrom]',
  foodLogs: 'id, profileId, [profileId+date], foodRef',
  customFoods: 'id, profileId, barcode, name',
  refFoods: 'id, source, barcode',
  recipes: 'id, profileId, name',
  mealTemplates: 'id, profileId',
  favorites: 'id, profileId, [profileId+foodRef]',
  recents: 'id, profileId, [profileId+foodRef], [profileId+lastUsedAt]',
  routines: 'id, profileId',
  trainingSessions: 'id, profileId, [profileId+date], status',
  exerciseSets: 'id, profileId, sessionId, [profileId+exerciseId], [profileId+date]',
  customExercises: 'id, profileId',
  bodyMeasurements: 'id, profileId, [profileId+date]',
  activityLogs: 'id, profileId, [profileId+date]',
  sleepLogs: 'id, profileId, [profileId+date]',
  recoveryLogs: 'id, profileId, [profileId+date]',
  habits: 'id, profileId',
  habitLogs: 'id, profileId, habitId, [profileId+date], [habitId+date]',
  importedDaily: 'id, profileId, [profileId+date], [profileId+metric]',
  meta: 'key',
}

/** v2 (V1.1): additive only — label photos, day completeness marks, adaptive energy history. */
export const STORES_V2: Record<string, string> = {
  ...STORES_V1,
  labelImages: 'id, profileId, foodId',
  dayMarks: 'id, profileId, [profileId+date]',
  energyAdjustments: 'id, profileId, [profileId+date]',
}

/**
 * v3 (V2): additive only — Health Connect imports and connection state, vital signs, hydration,
 * progress photos and favourite exercises. Existing rows are untouched (no upgrade function).
 */
export const STORES_V3: Record<string, string> = {
  ...STORES_V2,
  healthRecords: 'id, profileId, [profileId+date], [profileId+metric], externalId',
  integrations: 'id, profileId',
  vitals: 'id, profileId, [profileId+date], [profileId+kind]',
  hydrationLogs: 'id, profileId, [profileId+date]',
  progressPhotos: 'id, profileId, [profileId+date]',
  exerciseFavorites: 'id, profileId, [profileId+exerciseId]',
}

/** Latest store definitions. */
export const STORES_V4: Record<string, string> = {
  ...STORES_V3,
  foodPortions: 'id, profileId, [profileId+foodRef]',
}
/** V2.2: device-only sync bookkeeping (additive; no existing table changes). */
export const STORES_V5: Record<string, string> = {
  ...STORES_V4,
  syncLinks: 'profileId, uid',
  syncShadow: 'k, profileId, [profileId+table]',
  syncConflicts: 'id, profileId, [profileId+key]',
}
export const STORES = STORES_V5

export class IsolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IsolationError'
  }
}

/** Create a database instance (tests pass a unique name). */
export function createDB(name = DB_NAME): SaludDB {
  const db = new Dexie(name) as SaludDB
  db.version(1).stores(STORES_V1)
  // v2 only adds tables; existing rows need no upgrade function.
  db.version(2).stores(STORES_V2)
  // v3 only adds tables as well.
  db.version(3).stores(STORES_V3)
  // V2.1 is additive: existing foods, snapshots and media are not rewritten.
  db.version(4).stores(STORES_V4)
  // V2.2 adds sync bookkeeping tables only; personal rows are not rewritten.
  db.version(5).stores(STORES_V5)

  for (const t of PERSONAL_TABLES) {
    const table = db.table(t)
    table.hook('creating', (_pk, obj: { profileId?: unknown }) => {
      if (typeof obj.profileId !== 'string' || !obj.profileId) {
        throw new IsolationError(`Fila sin profileId en la tabla personal "${t}"`)
      }
    })
    table.hook('updating', (mods, _pk, obj) => {
      const m = mods as Record<string, unknown>
      if ('profileId' in m && m.profileId !== (obj as { profileId?: unknown }).profileId) {
        throw new IsolationError(`No se permite mover filas entre perfiles ("${t}")`)
      }
      return undefined
    })
  }
  return db
}

export const db: SaludDB = createDB()

/** Ask the browser not to evict our storage (best effort). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}
