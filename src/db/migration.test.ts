import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { createDB, SCHEMA_VERSION, STORES_V1, STORES_V2, STORES_V3 } from './schema'
import { PERSONAL_TABLES } from './tables'
import { repo } from './repo'

it.each([2, 3])('upgrades populated Dexie v%i to v4 without changing profiles or old tables', async (version) => {
  const name = `migration-v2-v3-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(1).stores(STORES_V1)
  old.version(2).stores(STORES_V2)
  if (version === 3) old.version(3).stores(STORES_V3)
  const upgraded = createDB(name)
  const before = new Map<string, Record<string, unknown>[]>()
  try {
    await old.open()
    const previousStores = version === 3 ? STORES_V3 : STORES_V2
    for (const t of Object.keys(previousStores)) {
      // Synthetic rows include media strings and per-device metadata.
      const rows = t === 'meta' ? [{ key: 'synthetic', value: { keep: true } }] :
        ['one', 'two'].map((profileId) => ({
          id: `${t}-${profileId}`, profileId, name: profileId, date: '2026-11-15',
          dataUrl: 'data:image/jpeg;base64,c3ludGhldGlj', updatedAt: '2026-11-15T12:00:00Z',
        }))
      await old.table(t).bulkAdd(rows)
      before.set(t, await old.table(t).toArray())
    }
    old.close()
    await upgraded.open()
    expect(upgraded.verno).toBe(SCHEMA_VERSION)
    for (const [t, rows] of before) expect(await upgraded.table(t).toArray(), t).toEqual(rows)
    for (const t of PERSONAL_TABLES.filter((t) => !(t in previousStores))) {
      expect(await upgraded.table(t).count(), t).toBe(0)
      const row = await repo('one', upgraded).add(t, { date: '2026-11-15' } as never)
      expect(await repo('two', upgraded).get(t, row.id), t).toBeUndefined()
    }
  } finally {
    old.close()
    await upgraded.delete()
  }
})
