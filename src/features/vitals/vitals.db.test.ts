import { afterEach, beforeEach, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { latestByKind } from '../../domain/vitals'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`vitals-iso-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = (name: string) => createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)

it('vitals are isolated per profile and queryable by date and kind', async () => {
  const a = repo((await mk('Perfil A')).id, db)
  const b = repo((await mk('Perfil B')).id, db)
  const row = await a.add('vitals', { date: '2026-03-01', time: '08:00', kind: 'bloodPressure', systolic: 118, diastolic: 76, value: null, unit: 'mmHg' })
  await a.add('vitals', { date: '2026-03-01', time: '08:01', kind: 'restingHr', value: 62, unit: 'lpm', context: 'reposo' })
  expect(await a.all('vitals')).toHaveLength(2)
  expect(await a.onDate('vitals', '2026-03-01')).toHaveLength(2)
  expect(await a.byProfileIndex('vitals', 'kind', 'restingHr')).toHaveLength(1)
  expect(latestByKind(await a.all('vitals')).bloodPressure?.systolic).toBe(118)
  expect(await b.all('vitals')).toEqual([])
  expect(await b.onDate('vitals', '2026-03-01')).toEqual([])
  expect(await b.byProfileIndex('vitals', 'kind', 'restingHr')).toEqual([])
  expect(await b.get('vitals', row.id)).toBeUndefined()
  await expect(b.remove('vitals', row.id)).rejects.toThrow()
  await a.update('vitals', row.id, { systolic: 122 })
  expect((await a.get('vitals', row.id))?.systolic).toBe(122)
})
