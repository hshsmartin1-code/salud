/**
 * Registry: every Dexie table is either PERSONAL (rows carry profileId and are only reachable
 * through repo(profileId)) or SHARED (no personal data). Isolation tests iterate this list —
 * adding a table to the schema without classifying it here fails the tests.
 */
export const PERSONAL_TABLES = [
  'goals',
  'foodLogs',
  'customFoods',
  'recipes',
  'mealTemplates',
  'favorites',
  'recents',
  'routines',
  'trainingSessions',
  'exerciseSets',
  'customExercises',
  'bodyMeasurements',
  'activityLogs',
  'sleepLogs',
  'recoveryLogs',
  'habits',
  'habitLogs',
  'importedDaily',
  'labelImages',
  'dayMarks',
  'energyAdjustments',
  'healthRecords',
  'integrations',
  'vitals',
  'hydrationLogs',
  'progressPhotos',
  'exerciseFavorites',
  'foodPortions',
] as const

/** Tables holding photos (large data URLs); a backup can leave them out. */
export const MEDIA_TABLES = ['labelImages', 'progressPhotos'] as const satisfies readonly PersonalTable[]

/**
 * Device-only bookkeeping for the optional account sync (V2.2): which local profile is linked to
 * which account, the last synced revision/hash of each row and unresolved conflicts. Rows carry the
 * local profileId, are never exported in backups and never leave the device.
 */
export const SYNC_STATE_TABLES = ['syncLinks', 'syncShadow', 'syncConflicts'] as const
export type SyncStateTable = (typeof SYNC_STATE_TABLES)[number]

/** profiles = the registry of people; refFoods = public/private reference foods; meta = app settings. */
export const SHARED_TABLES = ['profiles', 'refFoods', 'meta'] as const

export type PersonalTable = (typeof PERSONAL_TABLES)[number]
export type SharedTable = (typeof SHARED_TABLES)[number]
export type TableName = PersonalTable | SharedTable | SyncStateTable

/** Tables that have a [profileId+date] index. */
export const DATED_TABLES = [
  'foodLogs',
  'trainingSessions',
  'exerciseSets',
  'bodyMeasurements',
  'activityLogs',
  'sleepLogs',
  'recoveryLogs',
  'habitLogs',
  'importedDaily',
  'dayMarks',
  'energyAdjustments',
  'healthRecords',
  'vitals',
  'hydrationLogs',
  'progressPhotos',
] as const satisfies readonly PersonalTable[]
export type DatedTable = (typeof DATED_TABLES)[number]
