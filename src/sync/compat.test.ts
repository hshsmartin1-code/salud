import { afterEach, describe, expect, it } from 'vitest'
import { createDB, type SaludDB } from '../db/schema'
import { V221_PROFILE, V221_PROFILE_ID, V221_ROUTINE, V221_SESSION, V221_SET, V221_WARMUP_SET } from '../test/fixtures/v221Rows'
import { decodeRow, encodeRow, shadowKey } from './codec'
import { localChanges } from './engine'
import { TABLES_VERSION } from './syncTables'

/**
 * Compatibility proof (V3 training data). The golden values below were computed with the UNTOUCHED
 * 2.2.1 codec from the frozen rows in `src/test/fixtures/v221Rows.ts`. Any later change that alters
 * how an existing row is encoded (key, body `d` or hash `h`) fails here, because it would make every
 * 2.2.1 row look locally modified (a mass re-push) or make two app versions disagree on the same row.
 * Do NOT update these values to make a test pass: fix the change instead.
 */
const GOLDEN = {
  profile: {
    table: "_profile",
    key: "_profile~%40",
    h: "fd9c07d6-1487-4a0f-a126-e22e483d8ff7",
    d: '{"activity":"moderate","birthDate":"1991-03-04","color":"violet","createdAt":"2026-10-01T10:00:00.000Z","heightCm":166,"name":"Perfil Sintético","settings":{"addActivityKcal":false,"dashboard":{"hidden":["pressure"],"hideEmpty":true,"order":["weight","training"]},"stepGoal":8000,"waterGoalMl":2000,"weekStartsMonday":true},"sex":"female","updatedAt":"2026-11-01T10:00:00.000Z"}',
  },
  routine: {
    table: "routines",
    key: "routines~routine-221",
    h: "a653d62e-12fb-4993-a074-978194dc183c",
    d: '{"createdAt":"2026-10-02T10:00:00.000Z","exercises":[{"exerciseId":"fedb:squat","key":"k1","name":"Sentadilla","notes":"Profundidad paralela","restSec":150,"targetReps":"6-8","targetSets":4,"trackingType":"weight_reps"},{"exerciseId":"fedb:plank","key":"k2","name":"Plancha","restSec":60,"targetReps":"30-60 s","targetSets":3,"trackingType":"time"}],"name":"Pierna A","notes":"Calentar bien","updatedAt":"2026-10-02T10:00:00.000Z"}',
  },
  session: {
    table: "trainingSessions",
    key: "trainingSessions~session-221",
    h: "8c17eb35-7021-4321-a83b-e4e3a40d1cf7",
    d: '{"createdAt":"2026-11-10T18:00:00.000Z","date":"2026-11-10","durationMin":62,"endedAt":"2026-11-10T19:02:00.000Z","exerciseOrder":[{"exerciseId":"fedb:squat","name":"Sentadilla","restSec":150,"trackingType":"weight_reps"},{"exerciseId":"fedb:plank","name":"Plancha","restSec":60,"trackingType":"time"}],"name":"Pierna A","notes":"Buena sesión","origin":"app","restEndsAt":null,"routineId":"routine-221","rpe":8,"startedAt":"2026-11-10T18:00:00.000Z","status":"done","updatedAt":"2026-11-10T19:02:00.000Z"}',
  },
  set: {
    table: "exerciseSets",
    key: "exerciseSets~set-221",
    h: "41df8bcf-d780-4c62-a589-86bdd3d6d110",
    d: '{"createdAt":"2026-11-10T18:10:00.000Z","date":"2026-11-10","distanceM":null,"done":true,"durationSec":null,"exerciseId":"fedb:squat","exerciseName":"Sentadilla","isWarmup":false,"notes":"Rodilla bien","origin":"app","reps":8,"rpe":7.5,"sessionId":"session-221","setIndex":1,"updatedAt":"2026-11-10T18:12:00.000Z","weight":82.5}',
  },
  warmup: {
    table: "exerciseSets",
    key: "exerciseSets~set-221-w",
    h: "202f51e6-19bc-4279-a4b2-15914d21960e",
    d: '{"createdAt":"2026-11-10T18:10:00.000Z","date":"2026-11-10","distanceM":null,"done":true,"durationSec":null,"exerciseId":"fedb:squat","exerciseName":"Sentadilla","isWarmup":true,"origin":"app","reps":10,"rpe":null,"sessionId":"session-221","setIndex":0,"updatedAt":"2026-11-10T18:12:00.000Z","weight":40}',
  },
} as const

const ROWS = {
  profile: V221_PROFILE,
  routine: V221_ROUTINE,
  session: V221_SESSION,
  set: V221_SET,
  warmup: V221_WARMUP_SET,
} as const
type Name = keyof typeof GOLDEN
const NAMES = Object.keys(GOLDEN) as Name[]

const dbs: SaludDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

describe('2.2.1 rows encode exactly as before (golden values)', () => {
  for (const name of NAMES) {
    it(`${GOLDEN[name].table} (${name})`, () => {
      const enc = encodeRow(GOLDEN[name].table, ROWS[name] as never, V221_PROFILE_ID)
      expect(enc.key).toBe(GOLDEN[name].key)
      expect(enc.d).toBe(GOLDEN[name].d)
      expect(enc.h).toBe(GOLDEN[name].h)
    })
  }

  it('decoding a golden document and encoding it again gives the same bytes', () => {
    for (const name of NAMES) {
      const g = GOLDEN[name]
      const cloudId = encodeRow(g.table, ROWS[name] as never, V221_PROFILE_ID).cloudId
      const back = decodeRow(g.table, cloudId, g.d, 'other-device-profile')
      expect(encodeRow(g.table, back, 'other-device-profile').d).toBe(g.d)
    }
  })

  it('rows stored by Dexie keep the same hash, so a synced 2.2.1 row is not pending after the upgrade', async () => {
    const db = createDB(`compat-${Date.now()}`)
    await db.open()
    dbs.push(db)
    await db.profiles.put(V221_PROFILE as never)
    await db.routines.put(V221_ROUTINE as never)
    await db.trainingSessions.put(V221_SESSION as never)
    await db.exerciseSets.bulkPut([V221_SET, V221_WARMUP_SET] as never)
    await db.syncLinks.put({ profileId: V221_PROFILE_ID, uid: 'uid-x', email: null, displayName: null, linkedAt: '', state: 'linked', cursor: 0, tablesVersion: TABLES_VERSION, lastSyncAt: null, lastError: null, lastErrorCode: null, pending: 0, heldDeletes: 0, verifiedAt: null })
    // The shadow a 2.2.1 client recorded after syncing these rows.
    await db.syncShadow.bulkPut(
      NAMES.map((name) => {
        const g = GOLDEN[name]
        const rowId = name === 'profile' ? V221_PROFILE_ID : ROWS[name].id
        return { k: shadowKey(V221_PROFILE_ID, g.key), profileId: V221_PROFILE_ID, table: g.table, rowId, rev: 3, hash: g.h }
      }),
    )
    const { writes, deletes } = await localChanges(db, V221_PROFILE_ID)
    expect(writes).toEqual([])
    expect(deletes).toEqual([])
  })
})
