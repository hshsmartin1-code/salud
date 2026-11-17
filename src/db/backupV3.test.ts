import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeRow } from '../sync/codec'
import { V221_PROFILE, V221_PROFILE_ID, V221_ROUTINE, V221_SESSION, V221_SET, V221_WARMUP_SET } from '../test/fixtures/v221Rows'
import { BACKUP_VERSION, exportBackup, importBackup, parseBackup, type Backup } from './backup'
import { createDB, type SaludDB } from './schema'

// V3 optional training fields through backups. Synthetic data only.
let src: SaludDB
let dst: SaludDB
let n = 0
beforeEach(async () => {
  src = createDB(`backup-v3-src-${Date.now()}-${n++}`)
  dst = createDB(`backup-v3-dst-${Date.now()}-${n++}`)
  await src.open()
  await dst.open()
})
afterEach(async () => {
  await src.delete()
  await dst.delete()
})

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** The 2.2.1 rows plus every V3 optional field. */
const V3 = {
  profile: { ...clone(V221_PROFILE), settings: { ...clone(V221_PROFILE.settings), training: { autoRest: false, effort: 'rir', restAlert: true } } },
  routine: { ...clone(V221_ROUTINE), id: 'routine-v3', order: 2 },
  session: {
    ...clone(V221_SESSION),
    id: 'session-v3',
    exerciseOrder: [
      { exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 150, targetSets: 4, targetReps: '6-8', notes: 'Profundidad paralela' },
      { exerciseId: 'fedb:plank', name: 'Plancha', trackingType: 'time', restSec: 60 },
    ],
  },
  drop: { ...clone(V221_SET), id: 'set-v3-drop', sessionId: 'session-v3', kind: 'drop', rir: 1 },
  failure: { ...clone(V221_SET), id: 'set-v3-fail', sessionId: 'session-v3', setIndex: 2, kind: 'failure', rir: 0 },
  rirNull: { ...clone(V221_SET), id: 'set-v3-null', sessionId: 'session-v3', setIndex: 3, rir: null },
}

async function seed(db: SaludDB, withV3: boolean) {
  await db.profiles.put((withV3 ? V3.profile : clone(V221_PROFILE)) as never)
  await db.routines.put(clone(V221_ROUTINE) as never)
  await db.trainingSessions.put(clone(V221_SESSION) as never)
  await db.exerciseSets.bulkPut([clone(V221_SET), clone(V221_WARMUP_SET)] as never)
  if (!withV3) return
  await db.routines.put(V3.routine as never)
  await db.trainingSessions.put(V3.session as never)
  await db.exerciseSets.bulkPut([V3.drop, V3.failure, V3.rirNull] as never)
}

const dump = async (db: SaludDB) => ({
  profile: await db.profiles.get(V221_PROFILE_ID),
  routines: await db.routines.orderBy('id').toArray(),
  sessions: await db.trainingSessions.orderBy('id').toArray(),
  sets: await db.exerciseSets.orderBy('id').toArray(),
})

describe('backups with V3 training fields', () => {
  it('export → file → import keeps every new field exactly (and the sync encoding with it)', async () => {
    await seed(src, true)
    const file = JSON.stringify(await exportBackup({ profileId: V221_PROFILE_ID }, src))
    const b = parseBackup(file)
    expect(b.schemaVersion).toBe(BACKUP_VERSION) // unchanged format version
    await importBackup(b, { mode: 'merge', mapping: { [V221_PROFILE_ID]: 'new' } }, dst)
    const before = await dump(src)
    const after = await dump(dst)
    expect(after.routines).toEqual(before.routines)
    expect(after.sessions).toEqual(before.sessions)
    expect(after.sets).toEqual(before.sets)
    expect(after.profile?.settings).toEqual(before.profile?.settings)
    expect((after.sets.find((s) => s.id === 'set-v3-drop') as unknown as typeof V3.drop).kind).toBe('drop')
    expect(after.sets.find((s) => s.id === 'set-v3-null')).toHaveProperty('rir', null)
    for (const s of after.sets) expect(encodeRow('exerciseSets', s as never, V221_PROFILE_ID)).toEqual(encodeRow('exerciseSets', before.sets.find((x) => x.id === s.id) as never, V221_PROFILE_ID))
  })

  it('a 2.2.1 backup imports unchanged: same rows, same sync hashes, nothing added', async () => {
    // A file exactly as 2.2.1 wrote it (no V3 field anywhere).
    const file: Backup = {
      format: 'pho-backup',
      schemaVersion: 2,
      appVersion: '2.2.1',
      exportedAt: '2026-11-12T10:00:00.000Z',
      scope: 'profile',
      profiles: [clone(V221_PROFILE) as never],
      includedTables: ['routines', 'trainingSessions', 'exerciseSets'],
      media: true,
      tables: { routines: [clone(V221_ROUTINE)], trainingSessions: [clone(V221_SESSION)], exerciseSets: [clone(V221_SET), clone(V221_WARMUP_SET)] } as never,
    }
    await importBackup(parseBackup(JSON.stringify(file)), { mode: 'merge', mapping: { [V221_PROFILE_ID]: 'new' } }, dst)
    const after = await dump(dst)
    expect(after.routines).toEqual([V221_ROUTINE])
    expect(after.sessions).toEqual([V221_SESSION])
    expect(after.sets).toEqual([V221_SET, V221_WARMUP_SET].sort((a, b) => a.id.localeCompare(b.id)))
    for (const s of after.sets) expect(s).not.toHaveProperty('kind')
    expect(encodeRow('trainingSessions', after.sessions[0] as never, V221_PROFILE_ID)).toEqual(encodeRow('trainingSessions', V221_SESSION as never, V221_PROFILE_ID))
  })
})
