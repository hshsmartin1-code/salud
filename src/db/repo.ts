import type { Table } from 'dexie'
import { db as defaultDb, IsolationError, type SaludDB } from './schema'
import type { DatedTable, PersonalTable } from './tables'
import type {
  ActivityLog,
  BodyMeasurement,
  CustomExercise,
  CustomFood,
  DayMark,
  EnergyAdjustment,
  ExerciseSet,
  Favorite,
  FoodLog,
  Goal,
  Habit,
  HabitLog,
  ImportedDaily,
  LabelImage,
  MealTemplate,
  Recent,
  Recipe,
  RecoveryLog,
  Routine,
  SleepLog,
  TrainingSession,
} from './types'

export interface PersonalRows {
  goals: Goal
  foodLogs: FoodLog
  customFoods: CustomFood
  recipes: Recipe
  mealTemplates: MealTemplate
  favorites: Favorite
  recents: Recent
  routines: Routine
  trainingSessions: TrainingSession
  exerciseSets: ExerciseSet
  customExercises: CustomExercise
  bodyMeasurements: BodyMeasurement
  activityLogs: ActivityLog
  sleepLogs: SleepLog
  recoveryLogs: RecoveryLog
  habits: Habit
  habitLogs: HabitLog
  importedDaily: ImportedDaily
  labelImages: LabelImage
  dayMarks: DayMark
  energyAdjustments: EnergyAdjustment
}
type AssertAllCovered = { [K in PersonalTable]: PersonalRows[K] }
export type RowOf<T extends PersonalTable> = AssertAllCovered[T]
export type NewRow<R> = Omit<R, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> & { id?: string }
export type Changes<R> = Partial<Omit<R, 'id' | 'profileId' | 'createdAt' | 'updatedAt'>>

export function uuid(): string {
  return crypto.randomUUID()
}

export const nowIso = () => new Date().toISOString()

/**
 * The ONLY way UI/features touch personal data. Every read is filtered by profileId and every
 * write is stamped with it; reads/writes of another profile's row are refused.
 */
export function repo(profileId: string, database: SaludDB = defaultDb) {
  if (!profileId) throw new IsolationError('repo() requiere un profileId')
  const tbl = <T extends PersonalTable>(t: T) => database.table(t) as unknown as Table<RowOf<T>, string>
  const own = <R extends { profileId: string }>(r: R | undefined): R | undefined =>
    r && r.profileId === profileId ? r : undefined

  async function assertOwned<T extends PersonalTable>(t: T, id: string): Promise<RowOf<T>> {
    const row = await tbl(t).get(id)
    if (!row) throw new Error(`No existe el registro ${id}`)
    if (row.profileId !== profileId) throw new IsolationError('El registro pertenece a otro perfil')
    return row
  }

  function stamp<T extends PersonalTable>(data: NewRow<RowOf<T>> | RowOf<T>, existing?: RowOf<T>): RowOf<T> {
    const now = nowIso()
    return {
      ...(data as object),
      id: (data as { id?: string }).id ?? uuid(),
      profileId,
      createdAt: existing?.createdAt ?? (data as { createdAt?: string }).createdAt ?? now,
      updatedAt: now,
    } as RowOf<T>
  }

  return {
    profileId,
    db: database,

    async get<T extends PersonalTable>(t: T, id: string): Promise<RowOf<T> | undefined> {
      return own(await tbl(t).get(id))
    },
    async all<T extends PersonalTable>(t: T): Promise<RowOf<T>[]> {
      return tbl(t).where('profileId').equals(profileId).toArray()
    },
    async count<T extends PersonalTable>(t: T): Promise<number> {
      return tbl(t).where('profileId').equals(profileId).count()
    },
    async onDate<T extends DatedTable>(t: T, date: string): Promise<RowOf<T>[]> {
      return tbl(t).where('[profileId+date]').equals([profileId, date]).toArray()
    },
    async range<T extends DatedTable>(t: T, from: string, to: string): Promise<RowOf<T>[]> {
      return tbl(t)
        .where('[profileId+date]')
        .between([profileId, from], [profileId, to], true, true)
        .toArray()
    },
    async latest<T extends DatedTable>(t: T, limit = 1): Promise<RowOf<T>[]> {
      return tbl(t)
        .where('[profileId+date]')
        .between([profileId, ''], [profileId, '￿'])
        .reverse()
        .limit(limit)
        .toArray()
    },
    async byIndex<T extends PersonalTable>(t: T, index: string, value: string): Promise<RowOf<T>[]> {
      const rows = await tbl(t).where(index).equals(value).toArray()
      return rows.filter((r) => r.profileId === profileId)
    },
    /** Uses a compound index `[profileId+field]` (must exist in the schema). */
    async byProfileIndex<T extends PersonalTable>(t: T, field: string, value: string): Promise<RowOf<T>[]> {
      return tbl(t).where(`[profileId+${field}]`).equals([profileId, value]).toArray()
    },
    async add<T extends PersonalTable>(t: T, data: NewRow<RowOf<T>>): Promise<RowOf<T>> {
      const row = stamp<T>(data)
      await tbl(t).add(row)
      return row
    },
    /** Insert or replace. Refuses to overwrite another profile's row with the same id. */
    async put<T extends PersonalTable>(t: T, data: NewRow<RowOf<T>> | RowOf<T>): Promise<RowOf<T>> {
      const id = (data as { id?: string }).id
      const existing = id ? await tbl(t).get(id) : undefined
      if (existing && existing.profileId !== profileId) throw new IsolationError('El registro pertenece a otro perfil')
      const row = stamp<T>(data, existing)
      await tbl(t).put(row)
      return row
    },
    async bulkPut<T extends PersonalTable>(t: T, rows: (NewRow<RowOf<T>> | RowOf<T>)[]): Promise<number> {
      const ids = rows.map((r) => (r as { id?: string }).id).filter((x): x is string => !!x)
      const existing = await tbl(t).bulkGet(ids)
      const byId = new Map<string, RowOf<T>>()
      for (const e of existing) {
        if (!e) continue
        if (e.profileId !== profileId) throw new IsolationError('Un registro pertenece a otro perfil')
        byId.set(e.id, e)
      }
      const stamped = rows.map((r) => stamp<T>(r, byId.get((r as { id?: string }).id ?? '')))
      await tbl(t).bulkPut(stamped)
      return stamped.length
    },
    async update<T extends PersonalTable>(t: T, id: string, changes: Changes<RowOf<T>>): Promise<void> {
      await assertOwned(t, id)
      const clean = { ...(changes as object), updatedAt: nowIso() } as Record<string, unknown>
      delete clean.profileId
      delete clean.id
      // Dexie's UpdateSpec typing is too strict for generic rows.
      await (tbl(t) as unknown as Table<Record<string, unknown>, string>).update(id, clean)
    },
    async remove<T extends PersonalTable>(t: T, id: string): Promise<void> {
      await assertOwned(t, id)
      await tbl(t).delete(id)
    },
    async removeMany<T extends PersonalTable>(t: T, ids: string[]): Promise<void> {
      const rows = await tbl(t).bulkGet(ids)
      for (const r of rows) if (r && r.profileId !== profileId) throw new IsolationError('Un registro pertenece a otro perfil')
      await tbl(t).bulkDelete(ids)
    },
    /** Delete every row of this profile in one table. */
    async clear<T extends PersonalTable>(t: T): Promise<number> {
      return tbl(t).where('profileId').equals(profileId).delete()
    },
  }
}

export type Repo = ReturnType<typeof repo>
