import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { docKey, shadowKey } from './codec'
import { PULL_OVERLAP_US, syncProfile } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`pull-cost-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const mkProfile = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)

const food = (db: SaludDB, pid: string, name: string, kcal = 100) =>
  repo(pid, db).add('foodLogs', { date: '2026-11-10', meal: 'almuerzo', name, foodRef: 'usda:1', qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal }, missing: [], source: 'usda_sr' } as never)

const S = 1_000_000 // one second in server µs

/** Device clock that follows server time (any fixed skew would do: only elapsed time is used). */
function deviceClock(server: MemoryServer) {
  const t0 = server.now
  const base = Date.now()
  return () => new Date(base + (server.now - t0) / 1000)
}

async function linkedPair(rows: number) {
  const server = new MemoryServer()
  const a = await device()
  const pa = await mkProfile(a, 'Ana')
  for (let i = 0; i < rows; i++) await food(a, pa.id, `C${i}`, i)
  await linkProfile(a, pa.id, server.remote(ANA.uid), ANA)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
  return { server, a, b, pa: pa.id, pb }
}

const names = async (db: SaludDB, pid: string) => (await repo(pid, db).all('foodLogs')).map((r) => r.name)

describe('pull cost: the overlap window is re-read only until it has settled', () => {
  it('keeps the window short', () => {
    expect(PULL_OVERLAP_US).toBe(90 * S)
  })

  it('idle syncs after a bulk upload stop re-reading the uploaded documents', async () => {
    const { server, b, pb } = await linkedPair(400)
    const now = deviceClock(server)
    const idle = async () => {
      const before = server.calls.reads
      const r = await syncProfile(b, pb, server.remote(ANA.uid), { now })
      expect(r.applied + r.pushed + r.conflicts).toBe(0)
      return server.calls.reads - before
    }
    // Right after the download the window (the whole upload: 400 rows + profile) is still re-read.
    const soon = await idle()
    expect(soon).toBe(2 + 400)
    // The first sync at least one overlap later re-reads it one last time and settles it…
    server.advance(5 * 60 * S)
    expect(await idle()).toBe(2 + 400)
    // …then every idle sync costs 2 reads (metadata + one empty query) instead of ~400.
    server.advance(5 * 60 * S)
    expect([await idle(), await idle(), await idle()]).toEqual([2, 2, 2])
  })

  it('a full pull reads each document once, even when push batches straddle pages', async () => {
    const { server, b, pb } = await linkedPair(650) // 651 documents, in batches of 200 sharing one server time
    await b.syncLinks.update(pb, { cursor: null })
    const before = server.calls.reads
    const r = await syncProfile(b, pb, server.remote(ANA.uid))
    expect(r.pulled).toBe(651)
    expect(server.calls.reads - before).toBe(1 + 651) // metadata + each document once
  })

  it('still receives writes that commit out of order within the window, then stops re-reading', async () => {
    const { server, a, b, pa, pb } = await linkedPair(3)
    const now = deviceClock(server)
    const syncB = () => syncProfile(b, pb, server.remote(ANA.uid), { now })
    await syncB()

    server.advance(30 * S)
    await food(a, pa, 'Normal')
    await syncProfile(a, pa, server.remote(ANA.uid)) // at = T+30 s
    await syncB() // cursor = T+30 s, seen at T+30 s
    expect(await names(b, pb)).toContain('Normal')

    // Visible at T+50 s with a server time 40 s older than that (earlier than B's cursor).
    server.advance(20 * S)
    await food(a, pa, 'Tarde 1')
    server.backdateNext = 40 * S
    await syncProfile(a, pa, server.remote(ANA.uid))
    await syncB()
    expect(await names(b, pb)).toContain('Tarde 1')

    // At T+110 s (80 s after the cursor was seen) the window is re-read again: nothing new.
    server.advance(60 * S)
    await syncB()
    // Visible at T+110 s with a timestamp 85 s older (still inside the window).
    await food(a, pa, 'Tarde 2')
    server.backdateNext = 85 * S
    await syncProfile(a, pa, server.remote(ANA.uid))
    // T+125 s: 95 s after the cursor was seen, this pull re-reads the window once more and settles it.
    server.advance(15 * S)
    await syncB()
    expect(await names(b, pb)).toContain('Tarde 2')

    // Settled: an idle sync reads only the metadata and one empty query.
    server.advance(60 * S)
    const before = server.calls.reads
    await syncB()
    expect(server.calls.reads - before).toBe(2)

    // New writes keep arriving (the next pull starts right after the last document seen).
    await food(a, pa, 'Nueva')
    await syncProfile(a, pa, server.remote(ANA.uid))
    const r = await syncB()
    expect(r.applied).toBe(1)
    expect(await names(b, pb)).toContain('Nueva')
    expect(await repo(pb, b).count('foodLogs')).toBe(await repo(pa, a).count('foodLogs'))
  })

  it('a link from an older version (cursor without key) learns the key, then settles', async () => {
    const { server, b, pb } = await linkedPair(250)
    const now = deviceClock(server)
    // As stored by the previous version: only the server time of the newest change.
    const link = (await b.syncLinks.get(pb))!
    await b.syncLinks.put({ ...link, cursorKey: undefined, cursorSeenAt: undefined, cursorSettled: undefined })
    const idle = async () => {
      const before = server.calls.reads
      await syncProfile(b, pb, server.remote(ANA.uid), { now })
      return server.calls.reads - before
    }
    expect(await idle()).toBe(2 + 250)
    expect((await b.syncLinks.get(pb))?.cursorKey).toBeTruthy()
    server.advance(2 * 60 * S)
    expect(await idle()).toBe(2 + 250)
    expect([await idle(), await idle()]).toEqual([2, 2])
  })

  it('an account that stays empty never settles on a cursor without a document key', async () => {
    const server = new MemoryServer()
    const b = await device()
    const pb = (await mkProfile(b, 'Ana')).id
    const now = deviceClock(server)
    await b.syncLinks.put({ profileId: pb, uid: ANA.uid, email: null, displayName: null, linkedAt: '', state: 'linking', cursor: null, tablesVersion: '', lastSyncAt: null, lastError: null, lastErrorCode: null, pending: 0, heldDeletes: 0, verifiedAt: null })
    // Only pulls: the remote refuses every upload, so the account stays empty.
    const remote = server.remote(ANA.uid)
    remote.commit = async () => {
      throw new Error('sin subidas en esta prueba')
    }
    for (let i = 0; i < 3; i++) {
      await expect(syncProfile(b, pb, remote, { now })).rejects.toThrow('sin subidas')
      server.advance(5 * 60 * S)
    }
    const l = (await b.syncLinks.get(pb))!
    expect(l.cursor).toBe(0)
    expect(l.cursorSettled).toBeFalsy()
  })

  it('a cursor reset made during a pull (restore from the cloud) is not overwritten by that pull', async () => {
    const { server, a, b, pa, pb } = await linkedPair(1)
    const [base] = await repo(pb, b).all('foodLogs')
    await syncProfile(b, pb, server.remote(ANA.uid))
    server.advance(10 * 60 * S) // the row is far outside any overlap window
    await food(a, pa, 'Nueva')
    await syncProfile(a, pa, server.remote(ANA.uid))

    const remote = server.remote(ANA.uid)
    const realPull = remote.pull.bind(remote)
    let once = true
    remote.pull = async (since, after, limit) => {
      if (once) {
        once = false
        // Another action on this device forgets a row and asks for a full re-read (cursor: null),
        // like resolveConflict / restoreDeletedFromCloud do, while this pull is already running.
        await b.transaction('rw', [b.foodLogs, b.syncShadow, b.syncLinks], async () => {
          await b.foodLogs.delete(base!.id)
          await b.syncShadow.delete(shadowKey(pb, docKey('foodLogs', base!.id)))
          await b.syncLinks.update(pb, { cursor: null })
        })
      }
      return realPull(since, after, limit)
    }
    await syncProfile(b, pb, remote)
    expect((await b.syncLinks.get(pb))?.cursor).toBeNull()
    await syncProfile(b, pb, server.remote(ANA.uid))
    expect(await repo(pb, b).get('foodLogs', base!.id)).toBeDefined()
  })
})
