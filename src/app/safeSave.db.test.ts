import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { addWater, saveVital } from '../features/health/writers'
import { SAVE_FAILED, SAVE_FAILED_RESULT, trySave, tryWrite } from './safeSave'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`safe-save-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const mk = () => createProfile({ name: 'Perfil Prueba', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)

it('a rejected Dexie write reports the standard message and no success', async () => {
  const r = repo((await mk()).id, db)
  db.hydrationLogs.hook('creating', () => {
    throw new Error('QuotaExceededError')
  })
  const onError = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const out = await tryWrite(() => addWater(r, 250, null, '2026-11-15'), onError)
  expect(out).toBe(SAVE_FAILED_RESULT)
  expect(onError).toHaveBeenCalledWith(SAVE_FAILED)
  expect(SAVE_FAILED).toBe('No se pudo guardar. Inténtalo de nuevo.')
  expect(await r.all('hydrationLogs')).toEqual([])
  expect(await trySave(() => db.hydrationLogs.add({} as never), onError)).toBe(false)
  warn.mockRestore()
})

it('a resolved write returns its value and calls no error', async () => {
  const r = repo((await mk()).id, db)
  const onError = vi.fn()
  const undo = await tryWrite(() => addWater(r, 250, null, '2026-11-15'), onError)
  expect(undo).not.toBe(SAVE_FAILED_RESULT)
  expect(onError).not.toHaveBeenCalled()
  expect(await r.all('hydrationLogs')).toHaveLength(1)
})

it('pressure and pulse are written atomically', async () => {
  const r = repo((await mk()).id, db)
  db.vitals.hook('creating', (_pk, row) => {
    if ((row as { kind?: string }).kind === 'restingHr') throw new Error('falla al guardar el pulso')
  })
  await expect(saveVital(r, { kind: 'bloodPressure', date: '2026-11-15', time: '07:00', systolic: 118, diastolic: 76, pulse: 62 })).rejects.toThrow()
  expect(await r.all('vitals')).toEqual([])
})
