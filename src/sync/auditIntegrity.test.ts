import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { deleteSession } from '../features/training/session'
import { canKeepBoth, canMerge, conflictGroups, resolveConflict, syncProfile } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'
import { mergeSessionRows } from './sessionMerge'
import { encodeRow, shadowKey } from './codec'
import { PROFILE_TABLE, SYNC_TABLES } from './syncTables'

// Entirely synthetic profiles, rows and in-memory remote. No Firebase connection.
const account = { uid: 'audit-account', email: null, displayName: 'Perfil sintetico' }
const dbs: SaludDB[] = []
async function device() {
  const db = createDB(`audit-sync-${crypto.randomUUID()}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete() })
const sessionData = { date: '2026-11-10', name: 'Sesion sintetica', routineId: null, status: 'done' as const, startedAt: null, endedAt: null, restEndsAt: null, exerciseOrder: [] }
const setData = (sessionId: string, setIndex: number) => ({ sessionId, date: '2026-11-10', exerciseId: 'synthetic:lift', exerciseName: 'Ejercicio sintetico', setIndex, weight: 60, reps: 8, rpe: null, durationSec: null, distanceM: null, isWarmup: false, done: true })
async function pair() {
  const server = new MemoryServer()
  const a = await device(), b = await device()
  const p = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, a)
  await linkProfile(a, p.id, server.remote(account.uid), account)
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(account.uid), account)
  const ra = repo(p.id, a), rb = repo(pb, b)
  const sync = (db: SaludDB, pid: string) => syncProfile(db, pid, server.remote(account.uid))
  return { a, b, pa: p.id, pb, ra, rb, sync, server }
}

describe('session deletion audit', () => {
  it('pulls an entire 650-document timestamp group without skipping or looping', async () => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    for (let i = 0; i < 650; i++) await ra.add('hydrationLogs', { date: '2026-11-10', time: null, ml: 250 })
    await sync(a, pa)
    const at = server.tick()
    for (const [key, doc] of server.docs(account.uid)) server.docs(account.uid).set(key, { ...doc, at })
    await sync(b, pb)
    expect(await rb.count('hydrationLogs')).toBe(650)
    expect((await sync(b, pb)).pushed).toBe(0)
  })

  it('restoring two deleted sessions preserves every set of both sessions', async () => {
    const { a, b, pa, pb, ra, rb, sync } = await pair()
    const sessions = [await ra.add('trainingSessions', sessionData), await ra.add('trainingSessions', sessionData)]
    for (const s of sessions) await ra.add('exerciseSets', setData(s.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    for (const s of sessions) {
      await ra.update('trainingSessions', s.id, { notes: 'Cambio remoto' })
      await deleteSession(rb, (await rb.get('trainingSessions', s.id))!)
    }
    await sync(a, pa)
    await sync(b, pb)
    const conflicts = await b.syncConflicts.where('profileId').equals(pb).toArray()
    expect(conflicts.filter((c) => c.table === 'trainingSessions')).toHaveLength(2)
    for (const c of conflicts.filter((c) => c.table === 'trainingSessions')) await resolveConflict(b, pb, c.id, 'remote')
    await sync(b, pb)
    await sync(a, pa)
    expect(await rb.count('trainingSessions')).toBe(2)
    expect(await rb.count('exerciseSets')).toBe(2)
    expect(await ra.count('exerciseSets')).toBe(2)
  })

  it('an older edit/edit set conflict cannot resurrect a set after accepting the session deletion', async () => {
    const { a, b, pa, pb, ra, rb, sync } = await pair()
    const s = await ra.add('trainingSessions', sessionData)
    const set = await ra.add('exerciseSets', setData(s.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    await ra.update('exerciseSets', set.id, { weight: 65 })
    await rb.update('exerciseSets', set.id, { weight: 70 })
    await sync(a, pa)
    await sync(b, pb)
    const setConflict = (await b.syncConflicts.toArray()).find((c) => c.table === 'exerciseSets')!
    await ra.update('trainingSessions', s.id, { notes: 'Cambio posterior en la cabecera' })
    await sync(a, pa)
    await deleteSession(rb, (await rb.get('trainingSessions', s.id))!)
    await sync(b, pb)
    const deletion = (await b.syncConflicts.toArray()).find((c) => c.table === 'trainingSessions')!
    await resolveConflict(b, pb, deletion.id, 'local')
    expect(await b.syncConflicts.get(setConflict.id)).toBeUndefined()
    expect(await rb.get('exerciseSets', set.id)).toBeUndefined()
    await expect(resolveConflict(b, pb, setConflict.id, 'remote')).rejects.toThrow('Conflicto no encontrado')
    await sync(b, pb)
    await sync(a, pa)
    for (const r of [ra, rb]) {
      expect(await r.get('trainingSessions', s.id)).toBeUndefined()
      expect(await r.get('exerciseSets', set.id)).toBeUndefined()
    }
  })

  it.each(['local', 'remote'] as const)('%s session deletion closes all its set conflicts and keeps unrelated conflicts', async (choice) => {
    const { b, pb, rb } = await pair()
    const session = await rb.add('trainingSessions', sessionData)
    const other = await rb.add('trainingSessions', sessionData)
    const set = await rb.add('exerciseSets', setData(session.id, 0))
    const extra = await rb.add('exerciseSets', setData(session.id, 1))
    const otherSet = await rb.add('exerciseSets', setData(other.id, 0))
    const row = set as unknown as Record<string, unknown>
    const unrelated = otherSet as unknown as Record<string, unknown>
    const conflict = (id: string, local: Record<string, unknown> | null, remote: Record<string, unknown> | null) => ({ id, profileId: pb, key: id, table: 'exerciseSets', rowId: id, local, remote, remoteRev: 2, detectedAt: '' })
    const conflicts = [
      conflict('edit-edit', row, { ...row, weight: 65 }),
      conflict('delete-edit', null, row),
      conflict('edit-delete', row, null),
      // Check both snapshots when their session references differ.
      conflict('remote-session', unrelated, row),
    ]
    const header = session as unknown as Record<string, unknown>
    await b.syncConflicts.bulkPut([
      ...conflicts,
      conflict('unrelated', unrelated, { ...unrelated, weight: 75 }),
      { ...conflict('session-deletion', null, null), table: 'trainingSessions', rowId: session.id, local: choice === 'local' ? null : header, remote: choice === 'local' ? header : null },
    ])
    if (choice === 'local') await b.trainingSessions.delete(session.id)
    await resolveConflict(b, pb, 'session-deletion', choice)
    expect((await b.syncConflicts.toArray()).map((c) => c.id)).toEqual(['unrelated'])
    for (const c of conflicts) await expect(resolveConflict(b, pb, c.id, 'remote')).rejects.toThrow('Conflicto no encontrado')
    expect(await rb.get('exerciseSets', set.id)).toBeUndefined()
    expect(await rb.get('exerciseSets', extra.id)).toBeUndefined()
    expect(await rb.get('trainingSessions', other.id)).toBeDefined()
    expect(await rb.get('exerciseSets', otherSet.id)).toBeDefined()
  })

  it('local also closes set conflicts when the session was deleted after an edit/edit header conflict', async () => {
    const { b, pb, rb } = await pair()
    const session = await rb.add('trainingSessions', sessionData)
    const set = await rb.add('exerciseSets', setData(session.id, 0))
    const row = session as unknown as Record<string, unknown>
    await b.syncConflicts.bulkPut([
      { id: 'header', profileId: pb, key: 'header-key', table: 'trainingSessions', rowId: session.id, local: row, remote: { ...row, notes: 'Remota' }, remoteRev: 2, detectedAt: '' },
      { id: 'set', profileId: pb, key: 'set-key', table: 'exerciseSets', rowId: set.id, local: { ...set }, remote: { ...set, weight: 65 }, remoteRev: 2, detectedAt: '' },
    ])
    await deleteSession(rb, (await rb.get('trainingSessions', session.id))!)
    await resolveConflict(b, pb, 'header', 'local')
    expect(await b.syncConflicts.count()).toBe(0)
    expect(await rb.count('exerciseSets')).toBe(0)
    expect(await rb.count('trainingSessions')).toBe(0)
  })

  it('a changed set on the server prevents its parent session from being deleted silently', async () => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    const s = await ra.add('trainingSessions', sessionData)
    const set = await ra.add('exerciseSets', setData(s.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    await ra.update('exerciseSets', set.id, { weight: 65 })
    await sync(a, pa)
    await deleteSession(rb, (await rb.get('trainingSessions', s.id))!)
    await sync(b, pb)
    expect([...server.docs(account.uid).values()].find((d) => d.t === 'trainingSessions')?.del).toBe(false)
    const groups = conflictGroups(await b.syncConflicts.toArray())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conflict).toMatchObject({ table: 'trainingSessions', rowId: s.id, local: null })
    expect(groups[0]!.dependents).toHaveLength(1)
    expect(await rb.get('exerciseSets', set.id)).toBeUndefined()
    await resolveConflict(b, pb, groups[0]!.conflict.id, 'remote')
    await sync(b, pb)
    await sync(a, pa)
    expect(await rb.get('trainingSessions', s.id)).toBeDefined()
    expect(await rb.get('exerciseSets', set.id)).toMatchObject({ weight: 65 })
    expect(await b.syncConflicts.count()).toBe(0)
  })

  it.each(['local', 'remote'] as const)('set-only edits raise an old header outside the pull window; %s converges', async (choice) => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    const s = await ra.add('trainingSessions', sessionData)
    const set = await ra.add('exerciseSets', setData(s.id, 0))
    const unchanged = await ra.add('exerciseSets', setData(s.id, 1))
    await sync(a, pa)
    await sync(b, pb)
    // Advance only the incremental cursor: the unchanged header is outside the overlap window.
    await b.syncLinks.update(pb, { cursor: 1_000_000_000 })
    await ra.update('exerciseSets', set.id, { weight: 65 })
    await sync(a, pa)
    const doc = [...server.docs(account.uid).values()].find((d) => d.t === 'exerciseSets' && d.id === set.id)!
    server.docs(account.uid).set(doc.key, { ...doc, at: 1_000_000_010 })
    await deleteSession(rb, (await rb.get('trainingSessions', s.id))!)
    await sync(b, pb)
    const [group] = conflictGroups(await b.syncConflicts.toArray())
    expect(group!.conflict).toMatchObject({ table: 'trainingSessions', rowId: s.id, local: null })
    expect([...server.docs(account.uid).values()].filter((d) => !d.del && d.t === 'trainingSessions')).toHaveLength(1)
    await sync(b, pb)
    expect(conflictGroups(await b.syncConflicts.toArray())).toHaveLength(1)
    await resolveConflict(b, pb, group!.conflict.id, choice)
    await sync(b, pb)
    await sync(a, pa)
    for (const r of [ra, rb]) {
      expect(await r.count('trainingSessions')).toBe(choice === 'local' ? 0 : 1)
      expect(await r.count('exerciseSets')).toBe(choice === 'local' ? 0 : 2)
      if (choice === 'remote') {
        expect(await r.get('exerciseSets', set.id)).toMatchObject({ weight: 65 })
        expect(await r.get('exerciseSets', unchanged.id)).toBeDefined()
      }
    }
  })

  it('a set-only edit arriving between pull and push holds the session header deletion', async () => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    const s = await ra.add('trainingSessions', sessionData)
    const set = await ra.add('exerciseSets', setData(s.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    await deleteSession(rb, (await rb.get('trainingSessions', s.id))!)
    await ra.update('exerciseSets', set.id, { weight: 65 })
    const remote = server.remote(account.uid)
    const commit = remote.commit.bind(remote)
    let race = true
    remote.commit = async (writes) => {
      if (race) {
        race = false
        await sync(a, pa)
      }
      return commit(writes)
    }
    await syncProfile(b, pb, remote)
    expect([...server.docs(account.uid).values()].find((d) => d.t === 'trainingSessions')?.del).toBe(false)
    const [group] = conflictGroups(await b.syncConflicts.toArray())
    expect(group!.conflict).toMatchObject({ table: 'trainingSessions', local: null })
    expect(group!.dependents).toHaveLength(1)
    await resolveConflict(b, pb, group!.conflict.id, 'remote')
    await sync(b, pb)
    expect(await rb.get('trainingSessions', s.id)).toBeDefined()
    expect(await rb.get('exerciseSets', set.id)).toMatchObject({ weight: 65 })
  })

  it.each(['local', 'remote'] as const)('a newly added remote set raises its deleted session; %s converges', async (choice) => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    const session = await ra.add('trainingSessions', sessionData)
    await ra.add('exerciseSets', setData(session.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    const extra = await ra.add('exerciseSets', setData(session.id, 1))
    await sync(a, pa)
    await deleteSession(rb, (await rb.get('trainingSessions', session.id))!)
    await sync(b, pb)
    const groups = conflictGroups(await b.syncConflicts.toArray())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conflict).toMatchObject({ table: 'trainingSessions', rowId: session.id, local: null })
    expect(groups[0]!.dependents).toHaveLength(1)
    expect(await rb.get('exerciseSets', extra.id)).toBeUndefined()
    expect([...server.docs(account.uid).values()].filter((d) => !d.del && d.t === 'exerciseSets')).toHaveLength(2)
    await resolveConflict(b, pb, groups[0]!.conflict.id, choice)
    await sync(b, pb)
    await sync(a, pa)
    for (const r of [ra, rb]) {
      expect(await r.count('trainingSessions')).toBe(choice === 'local' ? 0 : 1)
      expect(await r.count('exerciseSets')).toBe(choice === 'local' ? 0 : 2)
    }
  })

  it('a header edit racing a deletion across push batches keeps every set', async () => {
    const { a, b, pa, pb, ra, rb, sync, server } = await pair()
    const session = await ra.add('trainingSessions', sessionData)
    for (let i = 0; i < 201; i++) await ra.add('exerciseSets', setData(session.id, i))
    await sync(a, pa)
    await sync(b, pb)
    await deleteSession(rb, (await rb.get('trainingSessions', session.id))!)
    await ra.update('trainingSessions', session.id, { notes: 'Cambio durante el push' })
    const remote = server.remote(account.uid)
    const commit = remote.commit.bind(remote)
    let race = true
    remote.commit = async (writes) => {
      if (race) {
        race = false
        await sync(a, pa)
      }
      return commit(writes)
    }
    await syncProfile(b, pb, remote, { confirmDeletes: true })
    expect([...server.docs(account.uid).values()].filter((d) => !d.del && d.t === 'exerciseSets')).toHaveLength(201)
    const [group] = conflictGroups(await b.syncConflicts.toArray())
    expect(group!.conflict).toMatchObject({ table: 'trainingSessions', rowId: session.id, local: null })
    await resolveConflict(b, pb, group!.conflict.id, 'remote')
    await sync(b, pb)
    expect(await rb.count('exerciseSets')).toBe(201)
    expect(await rb.get('trainingSessions', session.id)).toMatchObject({ notes: 'Cambio durante el push' })
  })
})

describe('session header scan convergence', () => {
  async function deletedSessionWithSetConflict() {
    const ctx = await pair()
    const { a, b, pa, pb, ra, rb, sync, server } = ctx
    const session = await ra.add('trainingSessions', sessionData)
    const set = await ra.add('exerciseSets', setData(session.id, 0))
    const unchanged = await ra.add('exerciseSets', setData(session.id, 1))
    const other = await ra.add('trainingSessions', sessionData)
    const otherSet = await ra.add('exerciseSets', setData(other.id, 0))
    await sync(a, pa)
    await sync(b, pb)
    await ra.update('exerciseSets', set.id, { weight: 65 })
    await rb.update('exerciseSets', set.id, { weight: 70 })
    await sync(a, pa)
    await sync(b, pb)
    expect(await b.syncConflicts.count()).toBe(1)
    // Leave the conflicting row and a never-synced child locally to check the cascade too.
    const extra = await rb.add('exerciseSets', setData(session.id, 2))
    await b.trainingSessions.delete(session.id)
    // The header is outside the incremental pull window, so the first check needs a full scan.
    await b.syncLinks.update(pb, { cursor: 1_000_000_000 })
    const header = [...server.docs(account.uid).values()].find((d) => d.t === 'trainingSessions' && d.id === session.id)!
    const remote = server.remote(account.uid)
    const pulls = vi.spyOn(remote, 'pull')
    const fullScans = () => pulls.mock.calls.filter(([since]) => since === null).length
    return { ...ctx, session, set, unchanged, extra, otherSet, header, remote, fullScans }
  }

  it.each(['deleted', 'absent'] as const)('a remotely %s header closes set conflicts and pushes their deletions without rescanning', async (state) => {
    const { b, pb, rb, server, session, set, unchanged, extra, otherSet, header, remote, fullScans } = await deletedSessionWithSetConflict()
    if (state === 'deleted') server.docs(account.uid).set(header.key, { ...header, del: true, d: null, h: null, rev: header.rev + 1 })
    else server.docs(account.uid).delete(header.key)
    await syncProfile(b, pb, remote)
    expect(fullScans()).toBe(1)
    expect(await b.syncConflicts.count()).toBe(0)
    expect(await rb.get('trainingSessions', session.id)).toBeUndefined()
    for (const row of [set, unchanged, extra]) expect(await rb.get('exerciseSets', row.id)).toBeUndefined()
    expect(await rb.get('exerciseSets', otherSet.id)).toBeDefined()
    const liveSessions = new Set((await rb.all('trainingSessions')).map((s) => s.id))
    expect((await rb.all('exerciseSets')).every((s) => liveSessions.has(s.sessionId))).toBe(true)
    for (const row of [set, unchanged]) {
      expect([...server.docs(account.uid).values()].find((d) => d.t === 'exerciseSets' && d.id === row.id)?.del).toBe(true)
    }
    expect(await syncProfile(b, pb, remote)).toMatchObject({ conflicts: 0, pending: 0, pushed: 0 })
    expect(fullScans()).toBe(1)
    expect(await b.syncConflicts.count()).toBe(0)
  })

  it('a present header raises one session conflict and the second sync does not scan again', async () => {
    const { b, pb, session, remote, fullScans } = await deletedSessionWithSetConflict()
    expect((await syncProfile(b, pb, remote)).conflicts).toBe(1)
    const conflicts = await b.syncConflicts.toArray()
    expect(conflicts.filter((c) => c.table === 'trainingSessions')).toHaveLength(1)
    expect(conflicts.find((c) => c.table === 'trainingSessions')).toMatchObject({ rowId: session.id, local: null })
    expect(fullScans()).toBe(1)
    expect((await syncProfile(b, pb, remote)).conflicts).toBe(0)
    expect(fullScans()).toBe(1)
    expect(await b.syncConflicts.toArray()).toEqual(conflicts)
  })

  it.each(['stale', 'unreadable'] as const)('remembers a %s header revision and accepts a later incremental revision without a full scan', async (reason) => {
    const { b, pb, server, header, remote, fullScans } = await deletedSessionWithSetConflict()
    if (reason === 'stale') await b.syncShadow.update(shadowKey(pb, header.key), { rev: header.rev + 1 })
    else server.docs(account.uid).set(header.key, { ...header, d: '{invalid' })
    await syncProfile(b, pb, remote)
    expect(fullScans()).toBe(1)
    const conflicts = await b.syncConflicts.toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.table).toBe('exerciseSets')
    await syncProfile(b, pb, remote)
    expect(fullScans()).toBe(1)
    expect(await b.syncConflicts.toArray()).toEqual(conflicts)
    server.docs(account.uid).set(header.key, { ...header, rev: header.rev + 2, at: 1_000_000_010 })
    await syncProfile(b, pb, remote)
    expect((await b.syncConflicts.toArray()).filter((c) => c.table === 'trainingSessions')).toHaveLength(1)
    expect(fullScans()).toBe(1)
  })
})

describe('all conflict table kinds', () => {
  for (const table of [PROFILE_TABLE, ...SYNC_TABLES]) {
    it(`${table}: choices and composite IDs respect their contracts`, async () => {
      const local = { id: 'synthetic-row', profileId: 'synthetic-profile', marker: 'local' }
      const remote = { ...local, marker: 'remote' }
      const c = { table, rowId: local.id, local, remote }
      expect(canMerge(c)).toBe(table === 'trainingSessions')
      expect(canKeepBoth(c)).toBe(table !== PROFILE_TABLE && table !== 'trainingSessions')
      expect(canKeepBoth({ ...c, rowId: 'synthetic-profile|synthetic-row' })).toBe(false)
      expect(canKeepBoth({ ...c, local: null })).toBe(false)
      const db = await device()
      for (const choice of ['local', 'remote', 'both', 'merge'] as const) {
        const profileId = 'synthetic-profile'
        const rowId = table === PROFILE_TABLE ? profileId : local.id
        const target = db.table(table === PROFILE_TABLE ? 'profiles' : table)
        const initial = { ...sessionData, ...local, id: rowId }
        const other = { ...initial, marker: 'remote' }
        await target.put(initial)
        await db.syncConflicts.put({ ...c, rowId, local: initial, remote: other, id: 'conflict', profileId, key: 'synthetic-key', remoteRev: 2, detectedAt: '' })
        if ((choice === 'both' && !canKeepBoth(c)) || (choice === 'merge' && !canMerge(c))) {
          await expect(resolveConflict(db, profileId, 'conflict', choice)).rejects.toThrow()
          continue
        }
        await resolveConflict(db, profileId, 'conflict', choice)
        const result = await target.get(rowId)
        expect(result.marker).toBe(choice === 'local' ? 'local' : 'remote')
        expect(await db.syncConflicts.get('conflict')).toBeUndefined()
        await target.clear()
      }
      for (const choice of ['local', 'remote'] as const) {
        const profileId = 'synthetic-profile'
        const rowId = table === PROFILE_TABLE ? profileId : `${profileId}|synthetic-row`
        const initial = { ...local, id: rowId }
        const other = { ...initial, marker: 'remote' }
        const target = db.table(table === PROFILE_TABLE ? 'profiles' : table)
        await target.put(initial)
        await db.syncConflicts.put({ ...c, rowId, local: initial, remote: other, id: 'composite-conflict', profileId, key: 'composite-key', remoteRev: 2, detectedAt: '' })
        await resolveConflict(db, profileId, 'composite-conflict', choice)
        expect((await target.get(rowId)).marker).toBe(choice)
        await target.clear()
      }
    })
  }

  it.each(['local', 'both'] as const)('%s preserves edits made after the conflict was recorded', async (choice) => {
    const { a, b, pa, pb, ra, rb, sync } = await pair()
    const row = await ra.add('routines', { name: 'Rutina inicial', exercises: [] })
    await sync(a, pa)
    await sync(b, pb)
    await ra.update('routines', row.id, { name: 'Version remota' })
    await rb.update('routines', row.id, { name: 'Version local' })
    await sync(a, pa)
    await sync(b, pb)
    const conflict = (await b.syncConflicts.toArray())[0]!
    await rb.update('routines', row.id, { notes: 'Nota posterior al conflicto' })
    await resolveConflict(b, pb, conflict.id, choice)
    expect((await rb.all('routines')).some((r) => r.notes === 'Nota posterior al conflicto')).toBe(true)
  })

  it('profile conflicts also preserve settings edited after detection when choosing local', async () => {
    const { a, b, pa, pb, sync } = await pair()
    await a.profiles.update(pa, { heightCm: 160, updatedAt: '2026-11-10T10:00:00Z' })
    await b.profiles.update(pb, { heightCm: 170, updatedAt: '2026-11-10T11:00:00Z' })
    await sync(a, pa)
    await sync(b, pb)
    const conflict = (await b.syncConflicts.toArray())[0]!
    await b.profiles.update(pb, { 'settings.training': { effort: 'rir' }, updatedAt: '2026-11-10T12:00:00Z' })
    await resolveConflict(b, pb, conflict.id, 'local')
    expect((await b.profiles.get(pb))?.settings.training?.effort).toBe('rir')
  })

  for (const table of [PROFILE_TABLE, ...SYNC_TABLES]) {
    it(`${table}: local and both use the current row, including a row recreated after detection`, async () => {
      const db = await device()
      const profileId = 'synthetic-profile'
      const rowId = table === PROFILE_TABLE ? profileId : 'synthetic-row'
      const target = db.table(table === PROFILE_TABLE ? 'profiles' : table)
      const initial = { ...sessionData, id: rowId, profileId, marker: 'snapshot' }
      const remote = { ...initial, marker: 'remote' }
      const current = { ...initial, marker: 'current', notes: 'Nota posterior' }
      for (const local of [initial, null]) {
        for (const choice of ['local', 'both'] as const) {
          const conflict = { id: 'current-conflict', profileId, key: 'current-key', table, rowId, local, remote, remoteRev: 2, detectedAt: '' }
          if (choice === 'both' && !canKeepBoth({ ...conflict, local: current })) continue
          await target.put(current)
          await db.syncConflicts.put(conflict)
          await resolveConflict(db, profileId, conflict.id, choice)
          const rows = await target.toArray()
          expect(rows.find((r) => r.marker === 'current')).toMatchObject({ notes: 'Nota posterior' })
          expect(await target.get(rowId)).toMatchObject(choice === 'local' ? current : remote)
          expect(rows).toHaveLength(choice === 'local' ? 1 : 2)
          expect(await db.syncConflicts.get(conflict.id)).toBeUndefined()
          await target.clear()
        }
      }
    })

    it(`${table}: a later local deletion is kept; both rejects without restoring a snapshot`, async () => {
      const db = await device()
      const profileId = 'synthetic-profile'
      const rowId = table === PROFILE_TABLE ? profileId : 'synthetic-row'
      const target = db.table(table === PROFILE_TABLE ? 'profiles' : table)
      const initial = { ...sessionData, id: rowId, profileId, marker: 'snapshot' }
      for (const choice of ['local', 'both'] as const) {
        const conflict = { id: 'deleted-conflict', profileId, key: 'deleted-key', table, rowId, local: initial, remote: { ...initial, marker: 'remote' }, remoteRev: 2, detectedAt: '' }
        await target.put(initial)
        await db.syncConflicts.put(conflict)
        await target.delete(rowId)
        if (choice === 'both') {
          await expect(resolveConflict(db, profileId, conflict.id, choice)).rejects.toThrow('Este registro no admite conservar ambas versiones')
          expect(await db.syncConflicts.get(conflict.id)).toBeDefined()
        } else {
          await resolveConflict(db, profileId, conflict.id, choice)
          expect(await db.syncConflicts.get(conflict.id)).toBeUndefined()
        }
        expect(await target.count()).toBe(0)
      }
    })
  }
})

describe('three-device merge audit', () => {
  it('three different edit times converge independently of merge grouping', () => {
    const row = (notes: string, minute: string) => ({ ...sessionData, id: 's', profileId: 'p', notes, updatedAt: `2026-11-10T10:${minute}:00Z` })
    const a = row('A', '10'), b = row('B', '20'), c = row('C', '30')
    const ab_c = mergeSessionRows(mergeSessionRows(a, b, []), c, [])
    const ac_b = mergeSessionRows(mergeSessionRows(a, c, []), b, [])
    expect(encodeRow('trainingSessions', ab_c, 'p').d).toBe(encodeRow('trainingSessions', ac_b, 'p').d)
  })

  it('open set deletion conflicts do not erase exercise notes and targets during session merge', async () => {
    const { b, pb, rb } = await pair()
    const ex = { exerciseId: 'synthetic:lift', name: 'Ejercicio sintetico', trackingType: 'weight_reps' as const, restSec: 120, targetSets: 4, targetReps: '8', notes: 'Nota conservada' }
    const session = await rb.add('trainingSessions', { ...sessionData, exerciseOrder: [ex] })
    const set = await rb.add('exerciseSets', setData(session.id, 0))
    await rb.remove('exerciseSets', set.id)
    await b.syncConflicts.bulkPut([
      { id: 'set-conflict', profileId: pb, key: 'set-key', table: 'exerciseSets', rowId: set.id, local: null, remote: set as unknown as Record<string, unknown>, remoteRev: 2, detectedAt: '' },
      { id: 'session-conflict', profileId: pb, key: 'session-key', table: 'trainingSessions', rowId: session.id, local: session as unknown as Record<string, unknown>, remote: { ...session, exerciseOrder: [], updatedAt: '2099-01-01T00:00:00Z' }, remoteRev: 2, detectedAt: '' },
    ])
    await resolveConflict(b, pb, 'session-conflict', 'merge')
    expect((await rb.get('trainingSessions', session.id))?.exerciseOrder).toContainEqual(ex)
    expect(await rb.get('exerciseSets', set.id)).toBeUndefined()
    await resolveConflict(b, pb, 'set-conflict', 'remote')
    expect((await rb.get('trainingSessions', session.id))?.exerciseOrder).toContainEqual(ex)
  })

  it('merge uses both held set versions and their descriptions, scoped to the profile and session', async () => {
    const { b, pb, rb } = await pair()
    const ex = (exerciseId: string) => ({ exerciseId, name: exerciseId, trackingType: 'weight_reps' as const, restSec: 120, targetSets: 4, targetReps: '8', notes: `Nota ${exerciseId}` })
    const kept = [ex('synthetic:local'), ex('synthetic:remote')]
    const session = await rb.add('trainingSessions', { ...sessionData, exerciseOrder: [...kept, ex('synthetic:removed')] })
    const other = await rb.add('trainingSessions', sessionData)
    const set = { ...setData(session.id, 0), id: 'held-set', profileId: pb, exerciseId: kept[0]!.exerciseId }
    const remoteSet = { ...set, exerciseId: kept[1]!.exerciseId }
    const orphan = { ...set, id: 'held-orphan', exerciseId: 'synthetic:orphan', exerciseName: 'Distancia sintetica', distanceM: 1200 }
    const conflict = (id: string, profileId: string, local: Record<string, unknown> | null, remote: Record<string, unknown>) => ({ id, profileId, key: id, table: 'exerciseSets', rowId: id, local, remote, remoteRev: 2, detectedAt: '' })
    await b.syncConflicts.bulkPut([
      conflict('held', pb, set, remoteSet),
      conflict('orphan', pb, null, orphan),
      conflict('other-session', pb, null, { ...set, sessionId: other.id, exerciseId: 'synthetic:unrelated' }),
      conflict('other-profile', 'synthetic-other-profile', null, { ...set, profileId: 'synthetic-other-profile', exerciseId: 'synthetic:foreign' }),
      { id: 'header', profileId: pb, key: 'header-key', table: 'trainingSessions', rowId: session.id, local: { ...session }, remote: { ...session, exerciseOrder: [], updatedAt: '2099-01-01T00:00:00Z' }, remoteRev: 2, detectedAt: '' },
    ])
    await resolveConflict(b, pb, 'header', 'merge')
    expect((await rb.get('trainingSessions', session.id))?.exerciseOrder).toEqual([
      ...kept,
      { exerciseId: orphan.exerciseId, name: orphan.exerciseName, trackingType: 'distance', restSec: 0 },
    ])
    expect(await rb.count('exerciseSets')).toBe(0)
    expect(await b.syncConflicts.count()).toBe(4)
    await resolveConflict(b, pb, 'held', 'remote')
    expect(await rb.get('exerciseSets', 'held')).toMatchObject({ exerciseId: kept[1]!.exerciseId })
    expect((await rb.get('trainingSessions', session.id))?.exerciseOrder).toContainEqual(kept[1])
  })
})
