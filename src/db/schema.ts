import Dexie, { type EntityTable } from 'dexie'
import { PERSONAL_TABLES } from './tables'
import type {
  ActivityLog,
  BodyMeasurement,
  CustomExercise,
  CustomFood,
  ExerciseSet,
  Favorite,
  FoodLog,
  Goal,
  Habit,
  HabitLog,
  ImportedDaily,
  MealTemplate,
  MetaRow,
  Profile,
  Recent,
  Recipe,
  RecoveryLog,
  RefFood,
  Routine,
  SleepLog,
  TrainingSession,
} from './types'

export const SCHEMA_VERSION = 1
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
  // Future migrations: db.version(2).stores({...}).upgrade(tx => ...)

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
