import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeRow, shadowKey } from '../sync/codec'
import { localChanges } from '../sync/engine'
import { PROFILE_TABLE } from '../sync/syncTables'
import { V221_PROFILE, V221_PROFILE_ID, V221_ROUTINE, V221_SESSION, V221_SET } from '../test/fixtures/v221Rows'
import { exportBackup, importBackup, parseBackup, previewImport } from './backup'
import { createDB, type SaludDB } from './schema'
import type { Profile } from './types'

// All fixture values are synthetic. Unknown optional fields must survive unchanged too.
let src: SaludDB, dst: SaludDB
const profile = JSON.parse(JSON.stringify(V221_PROFILE)) as Profile
const settings: Profile['settings'] = { ...profile.settings, training: { autoRest: false, effort: 'rir', restAlert: false }, hydration: { containers: [{ label: 'Recipiente sintetico', ml: 350 }] } }
beforeEach(async () => {
  src = createDB(`audit-backup-src-${crypto.randomUUID()}`)
  dst = createDB(`audit-backup-dst-${crypto.randomUUID()}`)
  await src.open()
  await dst.open()
  await src.profiles.put({ ...profile, settings })
  await src.routines.put({ ...V221_ROUTINE, order: 3, exercises: V221_ROUTINE.exercises.map((e) => ({ ...e, warmupSets: 2 })) } as never)
  await src.trainingSessions.put({ ...V221_SESSION, exerciseOrder: V221_SESSION.exerciseOrder.map((e) => ({ ...e, targetSets: 4, targetReps: '8-10', notes: 'Nota sintetica' })) } as never)
  await src.exerciseSets.put({ ...V221_SET, kind: 'drop', rir: 2 } as never)
})
afterEach(async () => { await src.delete(); await dst.delete() })

describe('backup audit: optional V3 fields', () => {
  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode}: all optional fields survive validation, ID remapping and repeated import`, async () => {
      const b = parseBackup(JSON.stringify(await exportBackup({ profileId: V221_PROFILE_ID }, src)))
      await dst.profiles.put({ ...profile, id: 'synthetic-destination' })
      const plan = { mode, mapping: { [V221_PROFILE_ID]: 'synthetic-destination' } }
      await importBackup(b, plan, dst)
      await importBackup(b, plan, dst)
      const routine = (await dst.routines.toArray())[0]!
      const session = (await dst.trainingSessions.toArray())[0]!
      const set = (await dst.exerciseSets.toArray())[0]!
      expect(routine).toMatchObject({ order: 3, exercises: V221_ROUTINE.exercises.map((e) => ({ ...e, warmupSets: 2 })) })
      expect(session.exerciseOrder).toEqual((await src.trainingSessions.get(V221_SESSION.id))!.exerciseOrder)
      expect(set).toMatchObject({ kind: 'drop', rir: 2, sessionId: session.id })
      expect([await dst.routines.count(), await dst.trainingSessions.count(), await dst.exerciseSets.count()]).toEqual([1, 1, 1])
    })

    it(`${mode}: restoring into the original existing profile recovers its backed-up settings`, async () => {
      const b = parseBackup(JSON.stringify(await exportBackup({ profileId: V221_PROFILE_ID }, src)))
      await dst.profiles.put({ ...profile, updatedAt: '2020-01-01T00:00:00Z' })
      await importBackup(b, { mode, mapping: { [V221_PROFILE_ID]: V221_PROFILE_ID } }, dst)
      expect((await dst.profiles.get(V221_PROFILE_ID))!.settings).toEqual(settings)
      expect(await dst.profiles.get(V221_PROFILE_ID)).toEqual(b.profiles[0])
    })

    it(`${mode}: profile fields of a backup mapped onto another profile (the target profile row is left untouched), with a read-only preview`, async () => {
      const backedUp = { ...profile, settings, name: 'Perfil respaldado sintetico', syntheticOptional: { enabled: true } }
      await src.profiles.put(backedUp)
      const b = parseBackup(JSON.stringify(await exportBackup({ profileId: V221_PROFILE_ID }, src)))
      const target: Profile = {
        ...profile, id: 'synthetic-destination', name: 'Destino sintetico', sex: 'male', birthDate: null,
        heightCm: 188, activity: null, color: 'sky', createdAt: '2019-01-01T00:00:00.000Z',
        // Replace ignores recency; merge accepts the strictly newer backup.
        updatedAt: mode === 'replace' ? '2030-01-01T00:00:00.000Z' : '2020-01-01T00:00:00.000Z',
      }
      const unrelated = { ...profile, id: 'synthetic-unrelated', name: 'Perfil ajeno' }
      await dst.profiles.bulkPut([target, profile, unrelated])
      const plan = { mode, mapping: { [V221_PROFILE_ID]: target.id } }
      // Importing a backup onto a DIFFERENT profile never renames it or changes its identity or settings,
      // in either mode and however new the backup is (the same-profile cases are below).
      const expected = target
      const before = JSON.stringify(await dst.profiles.orderBy('id').toArray())
      const preview = await previewImport(b, plan, dst)
      expect(JSON.stringify(await dst.profiles.orderBy('id').toArray())).toBe(before)
      expect(await importBackup(b, plan, dst)).toEqual(preview)
      expect(await dst.profiles.get(target.id)).toEqual(expected)
      expect(await dst.profiles.get(profile.id)).toEqual(profile)
      expect(await dst.profiles.get(unrelated.id)).toEqual(unrelated)
      // Restoring the same row again leaves the source timestamp intact.
      await importBackup(b, plan, dst)
      expect(await dst.profiles.get(target.id)).toEqual(expected)
    })
  }

  it.each(['older', 'equal'] as const)('merge: an %s backup leaves the local profile byte-identical, unwritten and absent from the sync queue', async (age) => {
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: V221_PROFILE_ID }, src)))
    const local = {
      ...profile, name: 'Version local sintetica',
      updatedAt: age === 'older' ? '2026-11-02T10:00:00.000Z' : profile.updatedAt,
    }
    await dst.profiles.put(local)
    const encoded = encodeRow(PROFILE_TABLE, local as unknown as Record<string, unknown>, local.id)
    await dst.syncShadow.put({ k: shadowKey(local.id, encoded.key), profileId: local.id, table: PROFILE_TABLE, rowId: local.id, rev: 1, hash: encoded.h })
    const before = JSON.stringify(await dst.profiles.get(local.id))
    const writes = vi.fn()
    dst.profiles.hook('updating', writes)
    dst.profiles.hook('creating', writes)
    dst.profiles.hook('deleting', writes)
    const plan = { mode: 'merge' as const, mapping: { [V221_PROFILE_ID]: local.id } }
    await previewImport(b, plan, dst)
    await importBackup(b, plan, dst)
    await importBackup(b, plan, dst)
    expect(writes).not.toHaveBeenCalled()
    expect(JSON.stringify(await dst.profiles.get(local.id))).toBe(before)
    expect((await dst.profiles.get(local.id))!.updatedAt).toBe(local.updatedAt)
    const changes = await localChanges(dst, local.id)
    expect([...changes.writes, ...changes.deletes].filter((w) => w.t === PROFILE_TABLE)).toEqual([])
  })
})
