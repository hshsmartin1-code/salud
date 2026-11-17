import Dexie from 'dexie'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProfile } from '../../db/profiles'
import { db } from '../../db/schema'
import type { Profile } from '../../db/types'
import { setWeekday } from '../training/plan/plan'
import { usePlan } from '../training/plan/usePlan'
import { renameSlot } from './mealSlots'
import { useMealSlots } from './useMealSlots'

const view = vi.hoisted(() => ({ profile: undefined as unknown as Profile }))
vi.mock('../../app/profile', () => ({ useProfile: () => view.profile, useRepo: () => ({}) }))
vi.mock('../../app/useToday', () => ({ useToday: () => '2026-11-16' }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }))
// Exercise the save callbacks captured by an unchanged render, using real IndexedDB transactions.
vi.mock('react', () => ({
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useRef: (current: unknown) => ({ current }),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))

beforeEach(async () => {
  await db.profiles.clear()
  view.profile = await createProfile({ name: 'Perfil sintético', sex: 'female', birthDate: null, heightCm: null,
    activity: null, color: 'sky', settings: { addActivityKcal: false, training: { restAlert: false },
      ...{ futureSetting: { keep: true } } } })
})
afterAll(async () => { await db.delete() })

describe('independent meals and plan settings writes', () => {
  it('a meal edit captured before a plan edit preserves that plan', async () => {
    const meals = useMealSlots()
    const plan = usePlan()
    await plan.edit((p) => setWeekday(p, 1, { kind: 'train', routineId: 'routine-a' }))
    await meals.save(renameSlot(meals.slots, 'cena', 'Noche'))
    const settings = (await db.profiles.get(view.profile.id))!.settings
    expect(settings.training?.plan?.days).toEqual({ '1': { routineId: 'routine-a' } })
    expect(settings.training?.restAlert).toBe(false)
    expect(settings).toHaveProperty('futureSetting', { keep: true })
    expect(settings.meals?.find((m) => m.key === 'cena')?.name).toBe('Noche')
  })

  it('a plan write cannot overwrite meals saved after its profile read', async () => {
    const meals = useMealSlots()
    const plan = usePlan()
    const originalGet = db.profiles.get.bind(db.profiles)
    let mealWrite: Promise<unknown> | undefined
    const read = vi.spyOn(db.profiles, 'get').mockImplementationOnce((...args: Parameters<typeof originalGet>) => Dexie.Promise.resolve().then(async () => {
      const p = await originalGet(...args)
      mealWrite = Dexie.ignoreTransaction(() => meals.save(renameSlot(meals.slots, 'cena', 'Noche')))
      // Keep a real transaction alive while an independent writer queues for the same table.
      await Dexie.waitFor(new Promise((resolve) => setTimeout(resolve, 20)))
      return p
    }))
    try {
      await plan.edit((p) => setWeekday(p, 1, { kind: 'train', routineId: null }))
      await mealWrite
    } finally { read.mockRestore() }
    const settings = (await db.profiles.get(view.profile.id))!.settings
    expect(settings.meals?.find((m) => m.key === 'cena')?.name).toBe('Noche')
    expect(settings.training?.plan?.days).toEqual({ '1': {} })
  })

  it('reading defaults and opening both features does not rewrite the profile', async () => {
    const before = await db.profiles.get(view.profile.id)
    const writes = vi.fn()
    db.profiles.hook('updating', writes)
    try {
      useMealSlots()
      usePlan()
      await Promise.resolve()
      expect(writes).not.toHaveBeenCalled()
      expect(await db.profiles.get(view.profile.id)).toEqual(before)
    } finally { db.profiles.hook('updating').unsubscribe(writes) }
  })
})
