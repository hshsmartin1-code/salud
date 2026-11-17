import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { addSleep, addWater, addWeight, hoursBetween, saveVital, undoWrite, validateSleep, validateVital, validateWeightKg } from './writers'

let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`writers-${Date.now()}-${n++}`)
  await db.open()
  const p = await createProfile({ name: 'Perfil Sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'rose', settings: { addActivityKcal: false } }, db)
  r = repo(p.id, db)
})
afterEach(async () => {
  await db.delete()
})

describe('quick-log writers and undo', () => {
  it('weight: validates, writes one row and undo removes exactly it', async () => {
    expect(validateWeightKg(null)).toBeTruthy()
    expect(validateWeightKg(401)).toBeTruthy()
    const other = await addWeight(r, 70, { date: '2026-11-01' })
    const u = await addWeight(r, 71.25, { date: '2026-11-02' })
    expect(await r.all('bodyMeasurements')).toHaveLength(2)
    await undoWrite(r, u)
    const left = await r.all('bodyMeasurements')
    expect(left.map((x) => x.id)).toEqual(other.ids)
    await undoWrite(r, u) // already gone: no error
  })
  it('water: undo removes only the added row', async () => {
    const a = await addWater(r, 250, 'vaso', '2026-11-02')
    const b = await addWater(r, 500, 'botella', '2026-11-02')
    await undoWrite(r, b)
    expect((await r.all('hydrationLogs')).map((x) => x.id)).toEqual(a.ids)
  })
  it('sleep: hours come from bed/wake across midnight and need something to save', async () => {
    expect(hoursBetween('23:30', '07:00')).toBe(7.5)
    expect(validateSleep({ date: '2026-11-02', bedtime: null, waketime: null, hours: null, quality: null })).toBeTruthy()
    expect(validateSleep({ date: '2026-11-02', bedtime: null, waketime: null, hours: 30, quality: null })).toBeTruthy()
    const u = await addSleep(r, { date: '2026-11-02', bedtime: '23:30', waketime: '07:00', hours: null, quality: null })
    expect((await r.all('sleepLogs'))[0]!.hours).toBe(7.5)
    await undoWrite(r, u)
    expect(await r.all('sleepLogs')).toHaveLength(0)
  })
  it('blood pressure with pulse writes two rows and undo removes both', async () => {
    expect(validateVital({ kind: 'bloodPressure', date: '2026-11-02', time: null, systolic: 80, diastolic: 120 })).toBeTruthy()
    const u = await saveVital(r, { kind: 'bloodPressure', date: '2026-11-02', time: '07:00', systolic: 120, diastolic: 80, pulse: 60 })
    expect(u!.ids).toHaveLength(2)
    expect((await r.all('vitals')).map((v) => v.kind).sort()).toEqual(['bloodPressure', 'restingHr'])
    await undoWrite(r, u!)
    expect(await r.all('vitals')).toHaveLength(0)
  })
  it('glucose keeps its context; editing returns no undo', async () => {
    const u = await saveVital(r, { kind: 'glucose', date: '2026-11-02', time: '07:00', value: 90, context: 'ayunas' })
    const row = (await r.all('vitals'))[0]!
    expect(row.context).toBe('ayunas')
    expect(await saveVital(r, { kind: 'glucose', date: '2026-11-02', time: '07:00', value: 95, context: 'ayunas' }, row)).toBeNull()
    expect((await r.all('vitals'))[0]!.value).toBe(95)
    await undoWrite(r, u!)
  })
})
