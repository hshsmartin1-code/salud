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
] as const

/** profiles = the registry of people; refFoods = public/private reference foods; meta = app settings. */
export const SHARED_TABLES = ['profiles', 'refFoods', 'meta'] as const

export type PersonalTable = (typeof PERSONAL_TABLES)[number]
export type SharedTable = (typeof SHARED_TABLES)[number]
export type TableName = PersonalTable | SharedTable

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
] as const satisfies readonly PersonalTable[]
export type DatedTable = (typeof DATED_TABLES)[number]
