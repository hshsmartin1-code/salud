import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { encodeRow } from './codec'
import { pendingCount, syncProfile } from './engine'
import { linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

// Count every row encoding (JSON with sorted keys + hash), the CPU cost of finding local changes.
vi.mock('./codec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codec')>()
  return { ...actual, encodeRow: vi.fn(actual.encodeRow) }
})

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`encode-cost-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const food = (db: SaludDB, pid: string, name: string) =>
  repo(pid, db).add('foodLogs', { date: '2026-11-10', meal: 'almuerzo', name, foodRef: 'usda:1', qty: 100, unit: 'g', grams: 100, ml: null, nutrients: { kcal: 100 }, missing: [], source: 'usda_sr' } as never)

async function linked(rows: number) {
  const server = new MemoryServer()
  const db = await device()
  const p = await createProfile({ name: 'Ana', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)
  for (let i = 0; i < rows; i++) await food(db, p.id, `C${i}`)
  await linkProfile(db, p.id, server.remote(ANA.uid), ANA)
  return { server, db, pid: p.id }
}

describe('a sync round encodes each local row once', () => {
  it('the scan after the upload reuses the encodings of rows that did not change', async () => {
    const { server, db, pid } = await linked(300)
    await food(db, pid, 'Nueva')
    vi.mocked(encodeRow).mockClear()
    const r = await syncProfile(db, pid, server.remote(ANA.uid))
    expect(r.pushed).toBe(1)
    expect(r.pending).toBe(0)
    // 301 food logs + the profile row: encoded once (was twice: before and after the upload).
    expect(vi.mocked(encodeRow).mock.calls.length).toBe(302)
  })

  it('a row edited while the upload is in flight is still counted as pending, and goes up next time', async () => {
    const { server, db, pid } = await linked(5)
    const [first] = await repo(pid, db).all('foodLogs')
    await food(db, pid, 'Nueva')
    const remote = server.remote(ANA.uid)
    const realCommit = remote.commit.bind(remote)
    remote.commit = async (w) => {
      await realCommit(w)
      await repo(pid, db).update('foodLogs', first!.id, { qty: 250 } as never)
    }
    const r = await syncProfile(db, pid, remote)
    expect(r.pushed).toBe(1)
    expect(r.pending).toBe(1)
    expect((await db.syncLinks.get(pid))?.pending).toBe(1)
    expect(await pendingCount(db, pid)).toBe(1)
    const again = await syncProfile(db, pid, server.remote(ANA.uid))
    expect(again.pushed).toBe(1)
    expect(again.pending).toBe(0)
  })
})
