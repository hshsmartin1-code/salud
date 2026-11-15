import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDB, IsolationError, STORES, STORES_V1, type SaludDB } from './schema'
import { DATED_TABLES, PERSONAL_TABLES, SHARED_TABLES, type PersonalTable } from './tables'
import { createProfile, deleteProfile } from './profiles'
import { repo, type NewRow, type RowOf } from './repo'

let db: SaludDB
let n = 0

beforeEach(async () => {
  db = createDB(`iso-test-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const isDated = (t: string) => (DATED_TABLES as readonly string[]).includes(t)

/** Minimal synthetic row per table (shape only matters for indexes). */
function sample(t: PersonalTable, tag: string): NewRow<RowOf<PersonalTable>> {
  const base: Record<string, unknown> = { name: `row-${tag}`, foodRef: `ref-${tag}`, habitId: `h-${tag}`, sessionId: `s-${tag}`, exerciseId: 'fedb:X', validFrom: '2026-01-01', lastUsedAt: '2026-01-01T00:00:00Z' }
  if (isDated(t)) base.date = '2026-01-01'
  return base as unknown as NewRow<RowOf<PersonalTable>>
}

async function twoProfiles() {
  const mk = (name: string) =>
    createProfile({ name, sex: 'male', birthDate: null, heightCm: null, activity: null, color: 'emerald', settings: { addActivityKcal: false } }, db)
  return [await mk('Perfil Uno'), await mk('Perfil Dos')] as const
}

describe('table registry', () => {
  it('classifies every schema table exactly once', () => {
    const schemaTables = Object.keys(STORES).sort()
    const registry = [...PERSONAL_TABLES, ...SHARED_TABLES].sort()
    expect(registry).toEqual(schemaTables)
    expect(new Set(registry).size).toBe(registry.length)
  })
  it('every personal table indexes profileId', () => {
    for (const t of PERSONAL_TABLES) expect(STORES[t]).toMatch(/(^|,\s*)profileId(,|$)/)
  })
  it('every dated table has the [profileId+date] index', () => {
    for (const t of DATED_TABLES) expect(STORES[t]).toContain('[profileId+date]')
  })
  it('v2 only adds tables: every v1 store keeps its exact index definition', () => {
    for (const [t, def] of Object.entries(STORES_V1)) expect(STORES[t]).toBe(def)
  })
})

describe('profile isolation', () => {
  it('reads only return the requesting profile rows, for every personal table', async () => {
    const [a, b] = await twoProfiles()
    const ra = repo(a.id, db)
    const rb = repo(b.id, db)
    for (const t of PERSONAL_TABLES) {
      const rowA = await ra.add(t, sample(t, 'a'))
      const rowB = await rb.add(t, sample(t, 'b'))
      expect(rowA.profileId).toBe(a.id)
      expect((await ra.all(t)).map((r) => r.id)).toEqual([rowA.id])
      expect((await rb.all(t)).map((r) => r.id)).toEqual([rowB.id])
      expect(await ra.get(t, rowB.id)).toBeUndefined()
      expect(await ra.count(t)).toBe(1)
      if (isDated(t)) {
        const dt = t as (typeof DATED_TABLES)[number]
        expect((await ra.onDate(dt, '2026-01-01')).map((r) => r.id)).toEqual([rowA.id])
        expect((await ra.range(dt, '2025-01-01', '2027-01-01')).map((r) => r.id)).toEqual([rowA.id])
        expect((await ra.latest(dt, 5)).map((r) => r.id)).toEqual([rowA.id])
      }
    }
  })

  it('refuses writes to another profile rows', async () => {
    const [a, b] = await twoProfiles()
    const ra = repo(a.id, db)
    const rb = repo(b.id, db)
    for (const t of PERSONAL_TABLES) {
      const rowB = await rb.add(t, sample(t, 'b'))
      await expect(ra.update(t, rowB.id, {} as never)).rejects.toBeInstanceOf(IsolationError)
      await expect(ra.remove(t, rowB.id)).rejects.toBeInstanceOf(IsolationError)
      await expect(ra.put(t, { ...sample(t, 'x'), id: rowB.id })).rejects.toBeInstanceOf(IsolationError)
      await expect(ra.removeMany(t, [rowB.id])).rejects.toBeInstanceOf(IsolationError)
      expect((await rb.all(t)).length).toBe(1)
    }
  })

  it('database hooks reject rows without profileId and profile moves', async () => {
    const [a, b] = await twoProfiles()
    for (const t of PERSONAL_TABLES) {
      await expect(db.table(t).add({ id: `orphan-${t}`, ...sample(t, 'o') })).rejects.toThrow()
      const row = await repo(a.id, db).add(t, sample(t, 'a'))
      await expect(db.table(t).update(row.id, { profileId: b.id })).rejects.toThrow()
    }
  })

  it('repo() requires a profile id', () => {
    expect(() => repo('', db)).toThrow(IsolationError)
  })

  it('deleting a profile removes only its rows', async () => {
    const [a, b] = await twoProfiles()
    for (const t of PERSONAL_TABLES) {
      await repo(a.id, db).add(t, sample(t, 'a'))
      await repo(b.id, db).add(t, sample(t, 'b'))
    }
    const removed = await deleteProfile(a.id, db)
    expect(removed).toBe(PERSONAL_TABLES.length)
    for (const t of PERSONAL_TABLES) {
      expect(await repo(a.id, db).count(t)).toBe(0)
      expect(await repo(b.id, db).count(t)).toBe(1)
    }
    expect(await db.profiles.count()).toBe(1)
  })
})
