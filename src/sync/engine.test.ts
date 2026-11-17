import { afterEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup, parseBackup } from '../db/backup'
import { createProfile, deleteProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { PERSONAL_TABLES } from '../db/tables'
import { decodeRow, encodeRow } from './codec'
import { canKeepBoth, deleteThreshold, pendingCount, resolveConflict, restoreDeletedFromCloud, syncProfile, SyncError } from './engine'
import { createProfileFromAccount, deleteCloudData, linkProfile, LinkError, previewLink, unlinkProfile, verifyLink } from './link'
import { MemoryServer } from './memoryRemote'
import { RemoteError } from './remote'
import { assertClassification, NOT_SYNCED, SYNC_TABLES } from './syncTables'

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }
const BETO = { uid: 'uid-beto', email: 'beto@example.test', displayName: 'Beto Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`sync-test-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const mkProfile = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)

async function food(db: SaludDB, pid: string, name: string, kcal: number, date = '2026-11-10') {
  return repo(pid, db).add('foodLogs', { date, meal: 'almuerzo', name, foodRef: 'usda:1', qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal }, missing: [], source: 'usda_sr' } as never)
}

const strip = (rows: readonly object[]) =>
  (rows as Record<string, unknown>[]).map(({ profileId: _p, ...r }) => (void _p, r)).sort((a, b) => String(a.id).localeCompare(String(b.id)))

describe('classification and codec', () => {
  it('every personal table is either synced or explicitly kept on the device', () => {
    expect(assertClassification()).toEqual([])
    expect(SYNC_TABLES.length + Object.keys(NOT_SYNCED).length).toBe(PERSONAL_TABLES.length)
    expect(SYNC_TABLES).not.toContain('progressPhotos')
    expect(SYNC_TABLES).not.toContain('healthRecords')
  })

  it('never sends the local profile id; another device maps rows to its own profile', () => {
    const row = { id: 'p1|usda:1', profileId: 'p1', foodRef: 'usda:1', note: 'p1|x', nested: [['a', 1]], updatedAt: 'x', skip: undefined }
    const enc = encodeRow('recents', row, 'p1')
    expect(enc.d).not.toContain('p1')
    expect(enc.cloudId).toBe('@|usda:1')
    const back = decodeRow('recents', enc.cloudId, enc.d, 'p2')
    expect(back).toEqual({ id: 'p2|usda:1', profileId: 'p2', foodRef: 'usda:1', note: 'p2|x', nested: [['a', 1]], updatedAt: 'x' })
    // Same content → same hash regardless of key order.
    expect(encodeRow('recents', { updatedAt: 'x', nested: [['a', 1]], note: 'p1|x', foodRef: 'usda:1', profileId: 'p1', id: 'p1|usda:1' }, 'p1').h).toBe(enc.h)
  })
})

describe('first link, second device and verification', () => {
  it('uploads a profile, downloads it into a new profile elsewhere and verifies counts', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 5; i++) await food(a, pa.id, `Comida ${i}`, 100 + i)
    await repo(pa.id, a).add('hydrationLogs', { date: '2026-11-10', time: '08:00', ml: 250 } as never)
    await repo(pa.id, a).add('progressPhotos', { date: '2026-11-10', pose: 'front', dataUrl: 'data:image/jpeg;base64,AAAA' } as never)

    const preview = await previewLink(a, pa.id, server.remote(ANA.uid))
    expect(preview.localTotal).toBe(6)
    expect(preview.remoteTotal).toBe(0)
    const { verify } = await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    expect((await a.syncLinks.get(pa.id))?.state).toBe('linked')
    // Photos are not uploaded in this phase.
    expect([...server.docs(ANA.uid).values()].some((d) => d.t === 'progressPhotos')).toBe(false)

    const b = await device()
    const other = await mkProfile(b, 'Otra persona')
    await food(b, other.id, 'No se toca', 999)
    const { profileId, verify: v2 } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
    expect(v2.ok).toBe(true)
    expect(profileId).not.toBe(other.id)
    expect((await b.profiles.get(profileId))?.name).toBe('Ana')
    expect(strip(await repo(profileId, b).all('foodLogs'))).toEqual(strip(await repo(pa.id, a).all('foodLogs')))
    // The pre-existing profile on device B is untouched.
    expect((await repo(other.id, b).all('foodLogs')).map((r) => r.name)).toEqual(['No se toca'])
  })

  it('pages through large accounts whose batches share one server timestamp', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 650; i++) await food(a, pa.id, `C${i}`, i)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    const b = await device()
    const { profileId, verify } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    expect(await repo(profileId, b).count('foodLogs')).toBe(650)
  })

  it('an unchanged second sync uploads nothing and reads only the overlap window', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arepa', 200)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    const written = server.calls.written
    const r = await syncProfile(a, pa.id, server.remote(ANA.uid))
    expect(r.pushed).toBe(0)
    expect(r.applied).toBe(0)
    expect(server.calls.written).toBe(written)
  })
})

async function twoDevices() {
  const server = new MemoryServer()
  const a = await device()
  const pa = await mkProfile(a, 'Ana')
  const base = await food(a, pa.id, 'Arroz', 130)
  await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
  return { server, a, b, pa: pa.id, pb, baseId: base.id }
}

describe('offline edits, reconnection and conflicts', () => {
  it('merges independent offline changes from two devices', async () => {
    const { server, a, b, pa, pb } = await twoDevices()
    server.offline = true
    await food(a, pa, 'Desayuno A', 300)
    await repo(pb, b).add('vitals', { date: '2026-11-11', time: '07:00', kind: 'pulse', value: 60, unit: 'lpm' } as never)
    await expect(syncProfile(a, pa, server.remote(ANA.uid))).rejects.toBeInstanceOf(RemoteError)
    expect((await a.syncLinks.get(pa))?.lastErrorCode).toBe('offline')
    expect(await pendingCount(a, pa)).toBe(1)
    server.offline = false
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await repo(pb, b).all('foodLogs')).map((r) => r.name).sort()).toEqual(['Arroz', 'Desayuno A'])
    expect(await repo(pa, a).count('vitals')).toBe(1)
    expect(await pendingCount(a, pa)).toBe(0)
  })

  it('keeps both versions when the same food entry is edited on two devices, then resolves', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await repo(pa, a).update('foodLogs', baseId, { qty: 150 } as never)
    await repo(pb, b).update('foodLogs', baseId, { qty: 200 } as never)
    await syncProfile(a, pa, server.remote(ANA.uid))
    const r = await syncProfile(b, pb, server.remote(ANA.uid))
    expect(r.conflicts).toBe(1)
    // Nothing was overwritten: B still shows its own value and the server still has A's.
    expect((await repo(pb, b).get('foodLogs', baseId))?.qty).toBe(200)
    const [c] = await b.syncConflicts.toArray()
    expect(canKeepBoth(c!)).toBe(true)
    expect((c!.local as { qty: number }).qty).toBe(200)
    expect((c!.remote as { qty: number }).qty).toBe(150)
    expect(await pendingCount(b, pb)).toBe(0) // blocked while the conflict is open
    expect((await verifyLink(b, pb, server.remote(ANA.uid))).ok).toBe(false)

    await resolveConflict(b, pb, c!.id, 'both')
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await repo(pa, a).all('foodLogs')).map((x) => x.qty).sort()).toEqual([150, 200])
    expect((await repo(pb, b).all('foodLogs')).map((x) => x.qty).sort()).toEqual([150, 200])
  })

  it('resolving with "this device" uploads the local version on top of the newer server revision', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await repo(pa, a).update('foodLogs', baseId, { qty: 150 } as never)
    await syncProfile(a, pa, server.remote(ANA.uid))
    await repo(pb, b).update('foodLogs', baseId, { qty: 175 } as never)
    await syncProfile(b, pb, server.remote(ANA.uid))
    const [c] = await b.syncConflicts.toArray()
    await resolveConflict(b, pb, c!.id, 'local')
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await repo(pa, a).get('foodLogs', baseId))?.qty).toBe(175)
  })

  it('a push based on a stale revision becomes a conflict instead of overwriting', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    await repo(pa, a).update('foodLogs', baseId, { qty: 111 } as never)
    await syncProfile(a, pa, server.remote(ANA.uid))
    // B edits the same row and pushes without having pulled A's change in between.
    await repo(pb, b).update('foodLogs', baseId, { qty: 222 } as never)
    const shadowBefore = await b.syncShadow.toArray()
    expect(shadowBefore.length).toBeGreaterThan(0)
    const r = await syncProfile(b, pb, server.remote(ANA.uid))
    expect(r.conflicts).toBe(1)
    const doc = [...server.docs(ANA.uid).values()].find((d) => d.t === 'foodLogs')!
    expect(JSON.parse(doc.d!).qty).toBe(111)
  })
})

describe('deletions', () => {
  it('propagates a deletion and keeps an edit that raced with it', async () => {
    const { server, a, b, pa, pb, baseId } = await twoDevices()
    const extra = await food(a, pa, 'Extra', 50)
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    await repo(pa, a).remove('foodLogs', extra.id)
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    expect(await repo(pb, b).get('foodLogs', extra.id)).toBeUndefined()

    // A deletes the base row while B edits it: B's edit is not silently lost.
    await repo(pa, a).remove('foodLogs', baseId)
    await repo(pb, b).update('foodLogs', baseId, { qty: 80 } as never)
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    expect((await repo(pb, b).get('foodLogs', baseId))?.qty).toBe(80)
    const [c] = await b.syncConflicts.toArray()
    expect(c!.remote).toBeNull()
    await resolveConflict(b, pb, c!.id, 'local')
    await syncProfile(b, pb, server.remote(ANA.uid))
    await syncProfile(a, pa, server.remote(ANA.uid))
    expect((await repo(pa, a).get('foodLogs', baseId))?.qty).toBe(80)
  })

  it('holds a mass deletion (e.g. a replace-restore of an old backup) until confirmed', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 40; i++) await food(a, pa.id, `C${i}`, i)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    expect(deleteThreshold(40)).toBe(25)
    await repo(pa.id, a).clear('foodLogs')
    const r = await syncProfile(a, pa.id, server.remote(ANA.uid))
    expect(r.heldDeletes).toBe(40)
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(40)
    expect((await verifyLink(a, pa.id, server.remote(ANA.uid))).ok).toBe(false)
    await syncProfile(a, pa.id, server.remote(ANA.uid), { confirmDeletes: true })
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBeUndefined()
  })

  it('can bring held deletions back from the cloud instead of confirming them', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 30; i++) await food(a, pa.id, `C${i}`, i)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    await repo(pa.id, a).clear('foodLogs')
    await food(a, pa.id, 'Nueva', 1)
    expect((await syncProfile(a, pa.id, server.remote(ANA.uid))).heldDeletes).toBe(30)
    const r = await restoreDeletedFromCloud(a, pa.id, server.remote(ANA.uid))
    expect(r.heldDeletes).toBe(0)
    expect(await repo(pa.id, a).count('foodLogs')).toBe(31)
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(31)
    expect((await verifyLink(a, pa.id, server.remote(ANA.uid))).ok).toBe(true)
  })
})

describe('unstable connectivity', () => {
  it('retries after a lost acknowledgement without duplicates or false conflicts', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    await food(a, pa.id, 'Pan', 250)
    server.loseAcks = 1
    await expect(syncProfile(a, pa.id, server.remote(ANA.uid))).rejects.toBeInstanceOf(RemoteError)
    const r = await syncProfile(a, pa.id, server.remote(ANA.uid))
    expect(r.conflicts).toBe(0)
    expect(await a.syncConflicts.count()).toBe(0)
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(1)
  })

  it('still receives a change that became visible with an older server time than the cursor', async () => {
    const { server, a, b, pa, pb } = await twoDevices()
    await syncProfile(b, pb, server.remote(ANA.uid)) // B's cursor moves to "now"
    await food(a, pa, 'Tardío', 10)
    server.backdateNext = 60_000 // committed earlier than B's cursor
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncProfile(b, pb, server.remote(ANA.uid))
    expect((await repo(pb, b).all('foodLogs')).map((r) => r.name)).toContain('Tardío')
  })

  it('an interrupted first upload resumes and is only verified when complete', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    for (let i = 0; i < 450; i++) await food(a, pa.id, `C${i}`, i)
    const remote = server.remote(ANA.uid)
    const realCommit = remote.commit.bind(remote)
    let calls = 0
    remote.commit = async (w) => {
      if (++calls === 2) throw new RemoteError('offline')
      return realCommit(w)
    }
    await expect(linkProfile(a, pa.id, remote, ANA)).rejects.toBeInstanceOf(RemoteError)
    expect((await a.syncLinks.get(pa.id))?.state).toBe('linking')
    const { verify } = await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(450)
    expect(await repo(pa.id, a).count('foodLogs')).toBe(450)
  })
})

describe('account isolation', () => {
  it('two local profiles sync to two accounts without mixing', async () => {
    const server = new MemoryServer()
    const d = await device()
    const pa = await mkProfile(d, 'Ana')
    const pb = await mkProfile(d, 'Beto')
    await food(d, pa.id, 'Comida Ana', 1)
    await food(d, pb.id, 'Comida Beto', 2)
    await linkProfile(d, pa.id, server.remote(ANA.uid), ANA)
    await linkProfile(d, pb.id, server.remote(BETO.uid), BETO)
    const names = (uid: string) => [...server.docs(uid).values()].filter((x) => x.t === 'foodLogs').map((x) => JSON.parse(x.d!).name)
    expect(names(ANA.uid)).toEqual(['Comida Ana'])
    expect(names(BETO.uid)).toEqual(['Comida Beto'])
  })

  it('refuses a session of another account, an account already used by another profile, and asks on a name mismatch', async () => {
    const server = new MemoryServer()
    const d = await device()
    const pa = await mkProfile(d, 'Ana')
    const pb = await mkProfile(d, 'Beto')
    await linkProfile(d, pa.id, server.remote(ANA.uid), ANA)
    await expect(syncProfile(d, pa.id, server.remote(BETO.uid))).rejects.toMatchObject({ code: 'account-mismatch' })
    await expect(linkProfile(d, pb.id, server.remote(ANA.uid), ANA)).rejects.toMatchObject({ code: 'account-in-use' })

    // Another device: Beto's profile tries to link to Ana's (non-empty) account.
    const e = await device()
    const pe = await mkProfile(e, 'Beto')
    await food(e, pe.id, 'Comida Beto', 2)
    await expect(linkProfile(e, pe.id, server.remote(ANA.uid), ANA)).rejects.toBeInstanceOf(LinkError)
    expect(await e.syncLinks.count()).toBe(0)
    expect([...server.docs(ANA.uid).values()].filter((x) => x.t === 'foodLogs')).toHaveLength(0)
  })

  it('refuses to pull rows that already belong to another local profile', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz', 130)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    // Device B restored Ana's backup into a profile with the same ids, then a NEW profile links Ana.
    const b = await device()
    const backup = parseBackup(JSON.stringify(await exportBackup({ profileId: pa.id }, a)))
    await importBackup(backup, { mode: 'merge', mapping: { [pa.id]: 'new' } }, b)
    const fresh = await mkProfile(b, 'Ana')
    await b.syncLinks.put({ profileId: fresh.id, uid: ANA.uid, email: null, displayName: null, linkedAt: '', state: 'linking', cursor: null, tablesVersion: '', lastSyncAt: null, lastError: null, lastErrorCode: null, pending: 0, heldDeletes: 0, verifiedAt: null })
    await expect(syncProfile(b, fresh.id, server.remote(ANA.uid))).rejects.toBeInstanceOf(SyncError)
  })
})

describe('backups, profile removal and data deletion', () => {
  it('restoring a backup into a linked profile uploads the restored rows', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Antes', 1)
    const backup = parseBackup(JSON.stringify(await exportBackup({ profileId: pa.id }, a)))
    // Backups never contain sync bookkeeping.
    expect(Object.keys(backup.tables)).not.toContain('syncShadow')
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    const other = await device()
    const po = await mkProfile(other, 'Ana')
    await food(other, po.id, 'Restaurada', 5)
    const b2 = parseBackup(JSON.stringify(await exportBackup({ profileId: po.id }, other)))
    await importBackup(b2, { mode: 'merge', mapping: { [po.id]: pa.id } }, a)
    await syncProfile(a, pa.id, server.remote(ANA.uid))
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(2)
  })

  it('removing a local profile or unlinking never deletes cloud data', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz', 130)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    await unlinkProfile(a, pa.id)
    expect(await repo(pa.id, a).count('foodLogs')).toBe(1)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    await deleteProfile(pa.id, a)
    expect(await a.syncLinks.count()).toBe(0)
    expect(await a.syncShadow.count()).toBe(0)
    expect((await server.remote(ANA.uid).liveCounts()).foodLogs).toBe(1)
  })

  it('another device does not re-upload into an account whose cloud copy was erased', async () => {
    const { server, a, b, pa, pb } = await twoDevices()
    await deleteCloudData(a, pa, server.remote(ANA.uid))
    await food(b, pb, 'Nuevo', 1)
    await expect(syncProfile(b, pb, server.remote(ANA.uid))).rejects.toMatchObject({ code: 'cloud-reset' })
    expect(server.docs(ANA.uid).size).toBe(0)
    expect((await b.syncLinks.get(pb))?.lastErrorCode).toBe('cloud-reset')
    expect(await repo(pb, b).count('foodLogs')).toBe(2)
  })

  it('deleting cloud data erases the account copy and keeps the device copy', async () => {
    const server = new MemoryServer()
    const a = await device()
    const pa = await mkProfile(a, 'Ana')
    await food(a, pa.id, 'Arroz', 130)
    await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
    await expect(deleteCloudData(a, pa.id, server.remote(BETO.uid))).rejects.toBeInstanceOf(LinkError)
    await deleteCloudData(a, pa.id, server.remote(ANA.uid))
    expect(server.docs(ANA.uid).size).toBe(0)
    expect(server.getMeta(ANA.uid)).toBeNull()
    expect(await repo(pa.id, a).count('foodLogs')).toBe(1)
    expect(await a.syncLinks.get(pa.id)).toBeUndefined()
  })
})
