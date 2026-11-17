import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup, parseBackup } from '../../../db/backup'
import { createProfile, updateProfile } from '../../../db/profiles'
import { createDB, type SaludDB } from '../../../db/schema'
import type { TrainingPlan } from '../../../db/types'
import { hasPlan, planFor } from './plan'

// Synthetic data only. The weekly plan is a field of the profile settings: a backup must carry it, and importing a
// backup must not invent, drop or rewrite it.
let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`plan-backup-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const PLAN: TrainingPlan = { days: { '1': { routineId: 'r-1' }, '4': {} }, overrides: { '2026-11-19': { rest: true } }, reminder: { on: true, time: '07:15' } }

describe('backup keeps the weekly plan', () => {
  it('export → wipe the plan → import (replace) brings the plan back unchanged, with the other settings', async () => {
    const p = await createProfile({ name: 'Perfil sintético', sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: null, color: 'sky', settings: { addActivityKcal: false, stepGoal: 9000, training: { restAlert: false, plan: PLAN } } }, db)
    const text = JSON.stringify(await exportBackup({ profileId: p.id }, db))
    expect(text).toContain('"07:15"')
    await updateProfile(p.id, { settings: { addActivityKcal: false } }, db)
    expect((await db.profiles.get(p.id))?.settings.training).toBeUndefined()

    await importBackup(parseBackup(text), { mode: 'replace', mapping: { [p.id]: p.id } }, db)
    const settings = (await db.profiles.get(p.id))!.settings
    expect(settings.training?.plan).toEqual(PLAN)
    expect(settings.training?.restAlert).toBe(false)
    expect(settings.stepGoal).toBe(9000)
    expect(hasPlan(settings.training?.plan)).toBe(true)
    expect(planFor(settings.training?.plan, '2026-11-16')).toEqual({ kind: 'train', routineId: 'r-1' })
  })

  it('a backup of a profile without a plan imports without creating one', async () => {
    const p = await createProfile({ name: 'Perfil sintético', sex: 'male', birthDate: null, heightCm: null, activity: null, color: 'rose', settings: { addActivityKcal: true } }, db)
    const text = JSON.stringify(await exportBackup({ profileId: p.id }, db))
    expect(text).not.toContain('"plan"')
    await importBackup(parseBackup(text), { mode: 'replace', mapping: { [p.id]: p.id } }, db)
    expect((await db.profiles.get(p.id))?.settings).toEqual({ addActivityKcal: true })
  })
})
