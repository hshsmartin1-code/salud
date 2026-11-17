import { afterEach, beforeEach, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`photos-iso-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = (name: string) => createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'rose', settings: { addActivityKcal: false } }, db)
const URL = 'data:image/jpeg;base64,' + 'A'.repeat(64)

it('progress photos are isolated per profile', async () => {
  const a = repo((await mk('Perfil A')).id, db)
  const b = repo((await mk('Perfil B')).id, db)
  const row = await a.add('progressPhotos', { date: '2026-03-01', pose: 'front', dataUrl: URL, thumbUrl: URL, width: 960, height: 1280, bytes: 48, weightKg: 70.5 })
  expect(await a.onDate('progressPhotos', '2026-03-01')).toHaveLength(1)
  expect((await a.get('progressPhotos', row.id))?.weightKg).toBe(70.5)
  expect(await b.all('progressPhotos')).toEqual([])
  expect(await b.onDate('progressPhotos', '2026-03-01')).toEqual([])
  expect(await b.get('progressPhotos', row.id)).toBeUndefined()
  await expect(b.remove('progressPhotos', row.id)).rejects.toThrow()
  await a.remove('progressPhotos', row.id)
  expect(await a.all('progressPhotos')).toEqual([])
})

it('reads the weight of a date from body measurements (context only)', async () => {
  const a = repo((await mk('Perfil A')).id, db)
  await a.add('bodyMeasurements', { date: '2026-03-01', weightKg: 71, circumferences: {}, skinfolds: {}, protocol: null, derived: null })
  const day = await a.onDate('bodyMeasurements', '2026-03-01')
  expect(day.find((m) => m.weightKg !== null)?.weightKg).toBe(71)
})
