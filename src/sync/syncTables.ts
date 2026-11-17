import { PERSONAL_TABLES, type PersonalTable } from '../db/tables'

/**
 * Which personal tables travel to the account. Every personal table must be listed in exactly one
 * of SYNC_TABLES or NOT_SYNCED (enforced by a test), so a table added later can never be skipped or
 * uploaded silently.
 */
export const SYNC_TABLES = [
  'goals',
  'foodLogs',
  'customFoods',
  'foodPortions',
  'recipes',
  'mealTemplates',
  'favorites',
  'recents',
  'routines',
  'trainingSessions',
  'exerciseSets',
  'customExercises',
  'exerciseFavorites',
  'bodyMeasurements',
  'activityLogs',
  'sleepLogs',
  'recoveryLogs',
  'habits',
  'habitLogs',
  'importedDaily',
  'dayMarks',
  'energyAdjustments',
  'vitals',
  'hydrationLogs',
] as const satisfies readonly PersonalTable[]
export type SyncTable = (typeof SYNC_TABLES)[number]

/** Kept on the device only, with the reason shown in the account screen and the docs. */
export const NOT_SYNCED: Record<Exclude<PersonalTable, SyncTable>, string> = {
  labelImages: 'Fotos de etiquetas: no se suben en esta fase (tamaño y privacidad).',
  progressPhotos: 'Fotos de progreso: no se suben en esta fase (tamaño y privacidad).',
  healthRecords:
    'Datos de Health Connect: el permiso se concede en cada teléfono; cada dispositivo Android los importa por su cuenta.',
  integrations: 'Estado de conexión del teléfono (permisos y marcas de sincronización locales).',
}

/** Profile row (name, sex, birth date, height, activity, colour, preferences incl. dashboard). */
export const PROFILE_TABLE = '_profile'
export type SyncedTableName = SyncTable | typeof PROFILE_TABLE

/**
 * Low-stakes, derived rows where the same key naturally appears on two devices (shortcuts, not
 * health records). A concurrent edit keeps the most recently updated version instead of asking.
 * Nutrition, training and health rows are NEVER auto-resolved: both versions are kept for review.
 */
export const AUTO_RESOLVE_TABLES: ReadonlySet<string> = new Set<SyncTable>(['recents', 'favorites', 'exerciseFavorites'])

const synced = new Set<string>([...SYNC_TABLES, PROFILE_TABLE])
export const isSyncedTable = (t: string): t is SyncedTableName => synced.has(t)

/** Changes when the synced table set changes; a client seeing a new value pulls everything once. */
export const TABLES_VERSION = `v1:${[...SYNC_TABLES].sort().join(',')}`

export function assertClassification(): string[] {
  const listed = [...SYNC_TABLES, ...Object.keys(NOT_SYNCED)]
  const missing = PERSONAL_TABLES.filter((t) => !listed.includes(t))
  const twice = listed.filter((t, i) => listed.indexOf(t) !== i)
  return [...missing.map((t) => `sin clasificar: ${t}`), ...twice.map((t) => `repetida: ${t}`)]
}
