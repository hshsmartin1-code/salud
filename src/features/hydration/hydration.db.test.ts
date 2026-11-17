import { afterEach, beforeEach, expect, it } from 'vitest'
import { createProfile, updateProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { dailyTotals } from '../../domain/hydration'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`hydration-iso-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = (name: string) => createProfile({ name, sex: 'male', birthDate: null, heightCm: null, activity: null, color: 'amber', settings: { addActivityKcal: false } }, db)

it('hydration logs are isolated per profile', async () => {
  const pa = await mk('Perfil A')
  const pb = await mk('Perfil B')
  const a = repo(pa.id, db)
  const b = repo(pb.id, db)
  const row = await a.add('hydrationLogs', { date: '2026-03-01', time: '09:00', ml: 250, drink: 'vaso' })
  await a.add('hydrationLogs', { date: '2026-03-01', time: '12:00', ml: 500, drink: 'botella' })
  expect(dailyTotals(await a.onDate('hydrationLogs', '2026-03-01'))).toEqual({ '2026-03-01': 750 })
  expect(await a.range('hydrationLogs', '2026-02-25', '2026-03-05')).toHaveLength(2)
  expect(await b.all('hydrationLogs')).toEqual([])
  expect(await b.onDate('hydrationLogs', '2026-03-01')).toEqual([])
  expect(await b.range('hydrationLogs', '2026-02-25', '2026-03-05')).toEqual([])
  await expect(b.remove('hydrationLogs', row.id)).rejects.toThrow()
  await a.remove('hydrationLogs', row.id)
  expect(await a.all('hydrationLogs')).toHaveLength(1)
})

it('the water goal is stored per profile', async () => {
  const pa = await mk('Perfil A')
  const pb = await mk('Perfil B')
  await updateProfile(pa.id, { settings: { ...pa.settings, waterGoalMl: 2500 } }, db)
  const [la, lb] = await Promise.all([db.profiles.get(pa.id), db.profiles.get(pb.id)])
  expect(la?.settings.waterGoalMl).toBe(2500)
  expect(lb?.settings.waterGoalMl ?? null).toBeNull()
})
