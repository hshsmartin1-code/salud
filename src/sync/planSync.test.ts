import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { createDB, type SaludDB } from '../db/schema'
import type { Profile, TrainingPlan } from '../db/types'
import { decodeRow, encodeRow } from './codec'
import { syncProfile } from './engine'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'
import { V221_PROFILE, V221_PROFILE_ID } from '../test/fixtures/v221Rows'

// Synthetic people and accounts only. V3.2: `settings.training.plan` rides inside the profile row (no new table, no new field).
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`plan-sync-test-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const PLAN: TrainingPlan = {
  days: { '1': { routineId: 'routine-a' }, '3': {}, '5': { routineId: 'routine-b' } },
  overrides: { '2026-11-19': { rest: true }, '2026-11-21': { routineId: 'routine-a' } },
  reminder: { on: true, time: '06:45' },
}

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

describe('the weekly plan across devices', () => {
  it('round-trips between two devices, keeps the other settings, and a later edit comes back', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const settings: Profile['settings'] = { addActivityKcal: true, stepGoal: 9000, training: { effort: 'rir', restAlert: false, plan: PLAN } }
    await a.profiles.update(pa, { settings, updatedAt: new Date().toISOString() })
    await sync(a, pa)
    await sync(b, pb)
    expect((await b.profiles.get(pb))?.settings).toEqual(settings)

    const edited: TrainingPlan = { ...PLAN, days: { ...PLAN.days, '2': {} }, reminder: { on: false, time: '06:45' } }
    await b.profiles.update(pb, { settings: { ...settings, training: { ...settings.training, plan: edited } }, updatedAt: new Date().toISOString() })
    await sync(b, pb)
    await sync(a, pa)
    expect((await a.profiles.get(pa))?.settings.training?.plan).toEqual(edited)
    expect((await a.profiles.get(pa))?.settings.training?.effort).toBe('rir')
    expect(await a.syncConflicts.count()).toBe(0)
    expect(await b.syncConflicts.count()).toBe(0)
  })

  it('removing the plan on one device removes it on the other, and nothing else changes', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    await a.profiles.update(pa, { settings: { addActivityKcal: false, training: { effort: 'rpe', plan: PLAN } }, updatedAt: new Date().toISOString() })
    await sync(a, pa)
    await sync(b, pb)
    await b.profiles.update(pb, { settings: { addActivityKcal: false, training: { effort: 'rpe' } }, updatedAt: new Date().toISOString() })
    await sync(b, pb)
    await sync(a, pa)
    const back = (await a.profiles.get(pa))?.settings
    expect(back?.training).toEqual({ effort: 'rpe' })
    expect('plan' in (back?.training ?? {})).toBe(false)
  })
})

describe('profile rows without a plan keep their encoding', () => {
  it('encoding is untouched by the new optional field: no plan key appears and the stored string is the same', () => {
    const row = { ...V221_PROFILE } as Record<string, unknown>
    const enc = encodeRow('_profile', row, V221_PROFILE_ID)
    expect(enc.d).not.toContain('plan')
    expect(enc.h).toBe('fd9c07d6-1487-4a0f-a126-e22e483d8ff7') // the golden hash of src/sync/compat.test.ts: this row is encoded exactly as before
    expect(enc.key).toBe('_profile~%40')
    // Adding unrelated absent keys (what a 3.2 build writes when nobody planned anything) changes nothing.
    const same = encodeRow('_profile', { ...row, settings: { ...(row.settings as object) } }, V221_PROFILE_ID)
    expect(same).toEqual(enc)
    // …and a row with training settings but no plan encodes without it.
    const withTraining = encodeRow('_profile', { ...row, settings: { ...(row.settings as object), training: { effort: 'rir' } } }, V221_PROFILE_ID)
    expect(withTraining.d).toContain('"training":{"effort":"rir"}')
    expect(withTraining.d).not.toContain('plan')
  })

  it('a row with a plan decodes to exactly what was written (unknown future keys inside the plan survive)', () => {
    const plan = { ...PLAN, later: { x: [1, 2] } }
    const row = { ...V221_PROFILE, settings: { ...(V221_PROFILE.settings as object), training: { plan } } } as Record<string, unknown>
    const enc = encodeRow('_profile', row, V221_PROFILE_ID)
    const back = decodeRow('_profile', enc.cloudId, enc.d, V221_PROFILE_ID) as { settings: { training: { plan: unknown } } }
    expect(back.settings.training.plan).toEqual(plan)
  })
})
