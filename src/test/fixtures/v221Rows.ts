/**
 * Frozen 2.2.1-shaped rows (synthetic). They describe exactly what a 2.2.1 client stores, so tests can
 * prove that later versions encode, sync and back up those rows without rewriting them.
 * NEVER edit these objects: the golden values in `src/sync/compat.test.ts` were computed from them on
 * the untouched 2.2.1 code.
 */
export const V221_PROFILE_ID = 'p-221'

export const V221_PROFILE = {
  id: V221_PROFILE_ID,
  name: 'Perfil Sintético',
  sex: 'female',
  birthDate: '1991-03-04',
  heightCm: 166,
  activity: 'moderate',
  color: 'violet',
  settings: {
    addActivityKcal: false,
    weekStartsMonday: true,
    stepGoal: 8000,
    waterGoalMl: 2000,
    dashboard: { order: ['weight', 'training'], hidden: ['pressure'], hideEmpty: true },
  },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
} as const

export const V221_ROUTINE = {
  id: 'routine-221',
  profileId: V221_PROFILE_ID,
  name: 'Pierna A',
  notes: 'Calentar bien',
  exercises: [
    { key: 'k1', exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', targetSets: 4, targetReps: '6-8', restSec: 150, notes: 'Profundidad paralela' },
    { key: 'k2', exerciseId: 'fedb:plank', name: 'Plancha', trackingType: 'time', targetSets: 3, targetReps: '30-60 s', restSec: 60 },
  ],
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
} as const

export const V221_SESSION = {
  id: 'session-221',
  profileId: V221_PROFILE_ID,
  date: '2026-11-10',
  name: 'Pierna A',
  routineId: 'routine-221',
  status: 'done',
  startedAt: '2026-11-10T18:00:00.000Z',
  endedAt: '2026-11-10T19:02:00.000Z',
  restEndsAt: null,
  exerciseOrder: [
    { exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 150 },
    { exerciseId: 'fedb:plank', name: 'Plancha', trackingType: 'time', restSec: 60 },
  ],
  notes: 'Buena sesión',
  rpe: 8,
  durationMin: 62,
  origin: 'app',
  createdAt: '2026-11-10T18:00:00.000Z',
  updatedAt: '2026-11-10T19:02:00.000Z',
} as const

export const V221_SET = {
  id: 'set-221',
  profileId: V221_PROFILE_ID,
  sessionId: 'session-221',
  date: '2026-11-10',
  exerciseId: 'fedb:squat',
  exerciseName: 'Sentadilla',
  setIndex: 1,
  weight: 82.5,
  reps: 8,
  durationSec: null,
  distanceM: null,
  rpe: 7.5,
  isWarmup: false,
  done: true,
  notes: 'Rodilla bien',
  origin: 'app',
  createdAt: '2026-11-10T18:10:00.000Z',
  updatedAt: '2026-11-10T18:12:00.000Z',
} as const

export const V221_WARMUP_SET = {
  ...V221_SET,
  id: 'set-221-w',
  setIndex: 0,
  weight: 40,
  reps: 10,
  rpe: null,
  isWarmup: true,
  notes: undefined,
} as const
