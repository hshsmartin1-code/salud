import { afterEach, describe, expect, it } from 'vitest'
import { createProfile, updateProfile } from '../db/profiles'
import { createDB, type SaludDB } from '../db/schema'
import type { MealSlotPref } from '../db/types'
import { V221_PROFILE, V221_PROFILE_ID } from '../test/fixtures/v221Rows'
import { resolveSlots, toPrefs } from '../features/nutrition/mealSlots'
import { encodeRow } from './codec'
import { syncProfile } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

// Synthetic people and accounts only.
const ANA = { uid: 'uid-ana-meals', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`meal-slots-sync-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

async function linkedPair() {
  const server = new MemoryServer()
  const a = await device()
  const pa = (await createProfile({ name: 'Ana', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, a)).id
  await linkProfile(a, pa, server.remote(ANA.uid), ANA)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
  const sync = (db: SaludDB, pid: string) => syncProfile(db, pid, server.remote(ANA.uid))
  return { a, b, pa, pb, sync }
}

describe('meal slots across devices (settings.meals)', () => {
  it('round-trips between two devices, and a change on the second comes back', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const meals: MealSlotPref[] = toPrefs(resolveSlots([
      { key: 'cena', on: true, name: 'Comida de la noche', time: '19:30' },
      { key: 'desayuno', on: true },
      { key: 'onces', on: false },
    ]))
    const settings = { ...(await a.profiles.get(pa))!.settings, meals }
    await updateProfile(pa, { settings }, a)
    await sync(a, pa)
    await sync(b, pb)
    expect((await b.profiles.get(pb))?.settings.meals).toEqual(meals)
    expect((await b.profiles.get(pb))?.settings.addActivityKcal).toBe(false) // unknown-to-this-feature keys travel along

    const renamed = meals.map((m) => (m.key === 'desayuno' ? { ...m, name: 'Primera comida' } : m))
    await updateProfile(pb, { settings: { ...(await b.profiles.get(pb))!.settings, meals: renamed } }, b)
    await sync(b, pb)
    await sync(a, pa)
    expect((await a.profiles.get(pa))?.settings.meals).toEqual(renamed)
  })

  it('a profile row without the field keeps its golden encoding', () => {
    expect('meals' in V221_PROFILE.settings).toBe(false)
    const enc = encodeRow('_profile', V221_PROFILE as never, V221_PROFILE_ID)
    expect(enc.d).toBe(
      '{"activity":"moderate","birthDate":"1991-03-04","color":"violet","createdAt":"2026-10-01T10:00:00.000Z","heightCm":166,"name":"Perfil Sintético","settings":{"addActivityKcal":false,"dashboard":{"hidden":["pressure"],"hideEmpty":true,"order":["weight","training"]},"stepGoal":8000,"waterGoalMl":2000,"weekStartsMonday":true},"sex":"female","updatedAt":"2026-11-01T10:00:00.000Z"}',
    )
    expect(enc.h).toBe('fd9c07d6-1487-4a0f-a126-e22e483d8ff7')
  })

  it('a profile that carries the field encodes it inside settings only, leaving every other key as it was', () => {
    const plain = JSON.parse(encodeRow('_profile', V221_PROFILE as never, V221_PROFILE_ID).d)
    const withMeals = JSON.parse(
      encodeRow('_profile', { ...V221_PROFILE, settings: { ...V221_PROFILE.settings, meals: [{ key: 'cena', on: true }] } } as never, V221_PROFILE_ID).d,
    )
    const { meals, ...settings } = withMeals.settings
    expect(meals).toEqual([{ key: 'cena', on: true }])
    expect({ ...withMeals, settings }).toEqual(plain)
  })
})
