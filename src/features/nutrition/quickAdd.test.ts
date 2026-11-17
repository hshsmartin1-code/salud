import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { FoodLog } from '../../db/types'
import { resizeSnapshot } from '../../domain/foodSnapshot'
import { scaleNutrients } from '../../domain/nutrients'
import { diaryPath, searchPath } from './paths'
import { logSnapshots, recentId, snapshotOf, touchRecent } from './quickAdd'
import { copyMeal } from './repeatMeal'

let db: SaludDB
let r: Repo
beforeEach(async () => {
  db = createDB(`quick-${crypto.randomUUID()}`)
  await db.open()
  const p = await createProfile({ name: 'Sintético', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

const SNAP = {
  foodRef: 'icbf:synthetic', name: 'Arroz sintético', brand: null, source: 'icbf_tcac2015' as const, datasetVersion: 'v-test', kind: 'cooked' as const,
  qty: 1.5, unit: 'portion' as const, portionLabel: 'Taza', portionId: 'p:taza', portionSource: 'icbf_tcac2015' as const, portionVerification: 'standard' as const,
  portionEquivalentAmount: 160, portionEquivalentUnit: 'g' as const, grams: 240, ml: null,
  nutrients: { kcal: 312, protein: 6.3, carbs: 68.1 }, missing: ['fat', 'fiber'] as ('fat' | 'fiber')[],
}

async function seedSource(): Promise<FoodLog> {
  return r.add('foodLogs', { ...SNAP, date: '2026-11-10', meal: 'almuerzo', time: '12:30', origin: 'app' })
}

describe('one-tap copy', () => {
  it('copies the source snapshot field by field; only id, date, meal and timestamps differ', async () => {
    const src = await seedSource()
    const batch = await logSnapshots(r, [{ snapshot: src }], '2026-11-03', 'cena')
    expect(batch.ids).toHaveLength(1)
    const copy = (await r.onDate('foodLogs', '2026-11-03'))[0]!
    expect(copy.id).toBe(batch.ids[0])
    expect(copy.id).not.toBe(src.id)
    expect(copy.date).toBe('2026-11-03')
    expect(copy.meal).toBe('cena')
    const strip = (l: FoodLog) => {
      const { id: _i, profileId: _p, createdAt: _c, updatedAt: _u, date: _d, meal: _m, time: _t, origin: _o, ...snap } = l
      void [_i, _p, _c, _u, _d, _m, _t, _o]
      return snap
    }
    expect(strip(copy)).toEqual(strip(src))
    // The values stay frozen: still the stored ones, not recomputed (240 g x 1.3 kcal/g would give another number).
    expect(copy.nutrients).toEqual({ kcal: 312, protein: 6.3, carbs: 68.1 })
    expect(copy.missing).toEqual(['fat', 'fiber'])
    expect(copy.nutrients).not.toBe(src.nutrients)
  })

  it('snapshotOf keeps every snapshot field and drops row identity', async () => {
    const src = await seedSource()
    const s = snapshotOf(src) as unknown as Record<string, unknown>
    for (const k of ['id', 'profileId', 'createdAt', 'updatedAt', 'date', 'meal', 'time', 'origin']) expect(k in s, k).toBe(false)
    expect(s.portionId).toBe('p:taza')
    expect(s.datasetVersion).toBe('v-test')
  })

  it('updates recents like a normal log (count, last quantity and portion)', async () => {
    const src = await seedSource()
    await touchRecent(r, src)
    await logSnapshots(r, [{ snapshot: src }], '2026-11-11', 'almuerzo')
    const rec = (await r.get('recents', recentId(r.profileId, SNAP.foodRef)))!
    expect(rec.count).toBe(2)
    expect(rec.lastQty).toBe(1.5)
    expect(rec.lastPortionId).toBe('p:taza')
  })

  it('undo deletes exactly the created rows and restores recents', async () => {
    const src = await seedSource()
    await touchRecent(r, src)
    const keep = await r.add('foodLogs', { ...SNAP, date: '2026-11-03', meal: 'cena', time: null, origin: 'app' })
    const before = (await r.get('recents', recentId(r.profileId, SNAP.foodRef)))!
    const batch = await logSnapshots(r, [{ snapshot: src }, { snapshot: { ...SNAP, foodRef: 'icbf:other', name: 'Otro' } }], '2026-11-03', 'cena')
    expect((await r.onDate('foodLogs', '2026-11-03')).map((l) => l.id).sort()).toEqual([keep.id, ...batch.ids].sort())
    expect((await r.get('recents', recentId(r.profileId, 'icbf:other')))?.count).toBe(1)
    await batch.undo()
    expect((await r.onDate('foodLogs', '2026-11-03')).map((l) => l.id)).toEqual([keep.id])
    expect(await r.get('recents', recentId(r.profileId, 'icbf:other'))).toBeUndefined()
    const after = (await r.get('recents', recentId(r.profileId, SNAP.foodRef)))!
    const { updatedAt: _a, ...a } = after
    const { updatedAt: _b, ...b } = before
    void [_a, _b]
    expect(a).toEqual(b)
    await batch.undo() // a second tap on "Deshacer" changes nothing
    expect((await r.onDate('foodLogs', '2026-11-03')).map((l) => l.id)).toEqual([keep.id])
  })

  it('keeps approx on a copy and leaves the key absent otherwise', async () => {
    const approx = await r.add('foodLogs', { ...SNAP, date: '2026-11-10', meal: 'cena', approx: true, sourceRef: 'x', excludeFromStats: true, origin: 'app' })
    const plain = await seedSource()
    const b = await logSnapshots(r, [{ snapshot: approx }, { snapshot: plain }], '2026-11-11', 'cena')
    const [a, p] = await Promise.all(b.ids.map((id) => r.get('foodLogs', id)))
    expect(a!.approx).toBe(true)
    expect('sourceRef' in a!).toBe(false)
    expect('excludeFromStats' in a!).toBe(false)
    expect('approx' in p!).toBe(false)
  })

  it('undo leaves recents alone when the food was used again afterwards', async () => {
    const src = await seedSource()
    const batch = await logSnapshots(r, [{ snapshot: src }], '2026-11-11', 'cena')
    await logSnapshots(r, [{ snapshot: src }], '2026-11-12', 'cena')
    await batch.undo()
    expect((await r.get('recents', recentId(r.profileId, SNAP.foodRef)))!.count).toBe(2)
    expect(await r.onDate('foodLogs', '2026-11-11')).toHaveLength(0)
    expect(await r.onDate('foodLogs', '2026-11-12')).toHaveLength(1)
  })

  it('copying a meal is one batch that can be undone', async () => {
    await seedSource()
    await r.add('foodLogs', { ...SNAP, foodRef: 'icbf:two', name: 'Dos', date: '2026-11-10', meal: 'almuerzo', time: '12:40', origin: 'app' })
    const batch = await copyMeal(r, '2026-11-10', '2026-11-12', 'almuerzo')
    expect(batch.ids).toHaveLength(2)
    expect(await r.count('recents')).toBe(2)
    await batch.undo()
    expect(await r.onDate('foodLogs', '2026-11-12')).toHaveLength(0)
    expect(await r.count('recents')).toBe(0)
  })

  it('undoing two uses in creation order does not resurrect the first recent', async () => {
    const a = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-11', 'cena')
    const b = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-12', 'cena')
    await a.undo()
    await b.undo()
    expect(await r.count('foodLogs')).toBe(0)
    expect(await r.get('recents', recentId(r.profileId, SNAP.foodRef))).toBeUndefined()
  })

  it('undo refuses to delete a log edited after the quick add', async () => {
    const b = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-11', 'cena')
    await r.update('foodLogs', b.ids[0]!, { meal: 'almuerzo', note: 'Cambio posterior' })
    await expect(b.undo()).rejects.toThrow(/cambiado/)
    expect(await r.get('foodLogs', b.ids[0]!)).toMatchObject({ meal: 'almuerzo', note: 'Cambio posterior' })
    expect(await r.count('recents')).toBe(1)
  })

  it('can undo in reverse order and preserves an independent recent edit', async () => {
    const a = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-11', 'cena')
    const b = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-12', 'cena')
    await b.undo()
    await a.undo()
    expect(await r.count('recents')).toBe(0)
    const c = await logSnapshots(r, [{ snapshot: SNAP }], '2026-11-11', 'cena')
    const id = recentId(r.profileId, SNAP.foodRef)
    await r.update('recents', id, { lastQty: 7 })
    await c.undo()
    expect(await r.get('recents', id)).toMatchObject({ lastQty: 7 })
  })

  it('captures each concurrent batch recent inside its write transaction', async () => {
    const [a, b] = await Promise.all([
      logSnapshots(r, [{ snapshot: SNAP }], '2026-11-11', 'cena'),
      logSnapshots(r, [{ snapshot: SNAP }], '2026-11-12', 'cena'),
    ])
    await a.undo()
    expect(await r.get('recents', recentId(r.profileId, SNAP.foodRef))).toMatchObject({ count: 2 })
    await b.undo()
    expect(await r.count('recents')).toBe(0)
  })

  it('never writes across profiles and rejects an invalid date', async () => {
    const src = await seedSource()
    await expect(logSnapshots(r, [{ snapshot: src }], '2026-02-30', 'cena')).rejects.toThrow(/fecha/)
    expect(await r.count('foodLogs')).toBe(1)
  })
})

describe('editing an entry whose food is not on this device', () => {
  it('scales every stored nutrient exactly in proportion through resizeSnapshot', async () => {
    const src = await seedSource()
    const out = resizeSnapshot(src, 3)
    expect('error' in out).toBe(false)
    if ('error' in out) return
    expect(out.qty).toBe(3)
    expect(out.grams).toBeCloseTo(480, 10)
    expect(out.nutrients).toEqual(scaleNutrients(src.nutrients, 2))
    expect(out.nutrients.kcal).toBeCloseTo(624, 10)
    expect(out.missing).toEqual(['fat', 'fiber']) // unknown stays unknown
    expect(out.nutrients.fat).toBeUndefined()
    expect(out.portionId).toBe('p:taza')
    await r.update('foodLogs', src.id, { ...out, meal: 'cena', date: '2026-11-11' })
    const saved = (await r.get('foodLogs', src.id))!
    expect(saved.meal).toBe('cena')
    expect(saved.date).toBe('2026-11-11')
    expect(saved.nutrients.protein).toBeCloseTo(12.6, 10)
    expect(resizeSnapshot(src, 0)).toHaveProperty('error')
  })
})

describe('where recipe and label logging goes', () => {
  it('returns to the day being viewed, not today', () => {
    expect(diaryPath('2026-01-05', '2026-11-15')).toBe('/comida?d=2026-01-05')
    expect(diaryPath('2026-11-15', '2026-11-15')).toBe('/comida')
    expect(searchPath('2026-01-05', 'cena', '2026-11-15')).toBe('/comida/buscar?d=2026-01-05&meal=cena')
    expect(searchPath('2026-11-15', undefined, '2026-11-15')).toBe('/comida/buscar')
  })

  it('a log made for the viewed date lands on that date only', async () => {
    const src = await seedSource()
    await logSnapshots(r, [{ snapshot: src, time: null }], '2026-01-05', 'cena')
    expect(await r.onDate('foodLogs', '2026-01-05')).toHaveLength(1)
    expect(await r.onDate('foodLogs', '2026-11-15')).toHaveLength(0)
  })
})
