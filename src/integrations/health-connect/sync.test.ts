import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { Profile } from '../../db/types'
import { permissionsFor } from './categories'
import { FakeHealthConnect } from './fake'
import { upsertHealthRows } from './merge'
import { rawToRow } from './mapper'
import { connect, disableCategory, disconnect, enableCategory } from './service'
import { getLinkedProfileId, LinkError, loadState } from './state'
import { runSync } from './sync'
import type { HcNativeRecord } from './types'

let db: SaludDB
let fake: FakeHealthConnect
let n = 0
let A: Profile
let B: Profile

const clock = (iso: string) => () => new Date(iso)
const NOW = '2026-11-15T15:00:00Z' // 10:00 in the app time zone → today = 2026-11-15
const mk = (name: string) =>
  createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'emerald', settings: { addActivityKcal: false } }, db)
const deps = (now = NOW) => ({ plugin: fake, db, now: clock(now) })

const weight = (id: string, kg: number, date = '2026-11-14'): HcNativeRecord => ({
  id,
  type: 'Weight',
  lastModified: `${date}T07:00:00Z`,
  origin: 'com.example.scale',
  recordingMethod: 'manual',
  deviceType: 'scale',
  start: `${date}T06:00:00Z`,
  date,
  value: kg,
  unit: 'kg',
})
const session = (id: string, date = '2026-11-14'): HcNativeRecord => ({
  id,
  type: 'ExerciseSession',
  lastModified: `${date}T10:00:00Z`,
  origin: 'com.example.band',
  recordingMethod: 'automatic',
  deviceType: 'watch',
  start: `${date}T08:00:00Z`,
  end: `${date}T08:45:00Z`,
  date,
  value: 45,
  unit: 'min',
  exerciseKey: 'running',
  detail: { activeKcal: 380, distanceM: 6200 },
})

function seedFake() {
  fake.daily = [
    { date: '2026-11-13', values: { steps: 7000, activeKcal: 300, distanceM: 5000 }, origins: { steps: ['android'], activeKcal: ['com.example.band'], distanceM: ['android'] } },
    { date: '2026-11-14', values: { steps: 9000, activeKcal: 420, distanceM: 6500, restingHr: 57 }, origins: { steps: ['android'], activeKcal: ['com.example.band'], distanceM: ['android'], restingHr: ['com.example.band'] } },
  ]
  fake.setRecord(weight('w-1', 70.4))
  fake.setRecord(weight('w-2', 70.1, '2026-11-12'))
  fake.setRecord(weight('w-3', 69.9, '2026-11-10'))
  fake.setRecord(session('s-1'))
}

beforeEach(async () => {
  db = createDB(`hc-test-${Date.now()}-${n++}`)
  await db.open()
  fake = new FakeHealthConnect()
  A = await mk('Perfil Uno')
  B = await mk('Perfil Dos')
})
afterEach(async () => {
  await db.delete()
})

const rows = (p: Profile) => repo(p.id, db).all('healthRecords')

describe('connect / link', () => {
  it('links the profile, asks only for the chosen categories and stores the granted ones', async () => {
    const st = await connect(deps(), A.id, ['activity', 'body'])
    expect(st?.status).toBe('connected')
    expect(st?.categories).toEqual({ activity: true, body: true })
    expect([...fake.granted].sort()).toEqual(permissionsFor(['activity', 'body']).sort())
    expect(await getLinkedProfileId(db)).toBe(A.id)
    expect(st?.id).toBe(`${A.id}|health-connect`)
  })

  it('refuses to link a second profile until the first disconnects', async () => {
    await connect(deps(), A.id, ['activity'])
    await expect(connect(deps(), B.id, ['activity'])).rejects.toBeInstanceOf(LinkError)
    expect(await getLinkedProfileId(db)).toBe(A.id)
    expect(await loadState(repo(B.id, db))).toBeUndefined()
    await disconnect(deps(), A.id)
    expect(await getLinkedProfileId(db)).toBeNull()
    const st = await connect(deps(), B.id, ['activity'])
    expect(st?.status).toBe('connected')
    expect(await getLinkedProfileId(db)).toBe(B.id)
  })

  it('does not link when nothing was granted', async () => {
    fake.grantOnRequest = false
    expect(await connect(deps(), A.id, ['activity'])).toBeNull()
    expect(await getLinkedProfileId(db)).toBeNull()
  })

  it('fails with a clear message when Health Connect is unavailable', async () => {
    fake.status = { available: false, reason: 'not-installed' }
    await expect(connect(deps(), A.id, ['activity'])).rejects.toThrow(/Instala Health Connect/)
    expect(await getLinkedProfileId(db)).toBeNull()
  })

  it('sync refuses a profile that is not the linked one', async () => {
    await connect(deps(), A.id, ['activity'])
    await expect(runSync(deps(), B.id)).rejects.toThrow(/no está vinculado/)
  })
})

describe('sync', () => {
  beforeEach(async () => {
    seedFake()
    await connect(deps(), A.id, ['activity', 'heart', 'exercise', 'sleep', 'body'])
  })

  it('first sync imports daily aggregates and raw records with stable ids', async () => {
    const res = await runSync(deps(), A.id)
    expect(res.ok).toBe(true)
    expect(res.plan.kind).toBe('first')
    expect(res.plan.dailyFrom).toBe('2026-10-17')
    const all = await rows(A)
    const ids = all.map((x) => x.id).sort()
    expect(ids).toContain(`${A.id}|hc:daily:steps:2026-11-14`)
    expect(ids).toContain(`${A.id}|hc:w-1`)
    expect(ids).toContain(`${A.id}|hc:s-1`)
    const w = all.find((x) => x.id === `${A.id}|hc:w-1`)!
    expect(w).toMatchObject({ externalId: 'w-1', metric: 'weight', value: 70.4, sources: ['com.example.scale'], device: 'Báscula' })
    // paging (page size 2) read all three weights
    expect(all.filter((x) => x.metric === 'weight')).toHaveLength(3)
    const st = (await loadState(repo(A.id, db)))!
    expect(st.lastSyncTo).toBe('2026-11-15')
    expect(Object.keys(st.changesTokens).sort()).toEqual(['BodyFat', 'ExerciseSession', 'LeanBodyMass', 'SleepSession', 'Weight'])
    expect(st.log[0]).toMatchObject({ ok: true })
  })

  it('daily active kcal comes only from the aggregate; session kcal stay in detail', async () => {
    await runSync(deps(), A.id)
    const all = await rows(A)
    const dayKcal = all.find((x) => x.id === `${A.id}|hc:daily:activeKcal:2026-11-14`)!
    expect(dayKcal.value).toBe(420) // not 420 + 380
    const sess = all.find((x) => x.id === `${A.id}|hc:s-1`)!
    expect(sess.detail).toMatchObject({ activeKcal: 380 })
    expect(all.filter((x) => x.metric === 'activeKcal')).toHaveLength(2)
  })

  it('re-sync is idempotent', async () => {
    await runSync(deps(), A.id)
    const before = await rows(A)
    const stamp = new Map(before.map((x) => [x.id, x.updatedAt]))
    const res = await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    const after = await rows(A)
    expect(after).toHaveLength(before.length)
    expect(res.counts.records).toBe(0)
    for (const x of after) expect(x.updatedAt).toBe(stamp.get(x.id))
    expect(res.plan.kind).toBe('incremental')
  })

  it("keeps the person's excluded flag when data is refreshed", async () => {
    await runSync(deps(), A.id)
    const r = repo(A.id, db)
    await r.update('healthRecords', `${A.id}|hc:daily:steps:2026-11-14`, { excluded: true })
    await r.update('healthRecords', `${A.id}|hc:w-1`, { excluded: true })
    fake.daily[1]!.values.steps = 9500
    fake.setRecord({ ...weight('w-1', 70.6), lastModified: '2026-11-14T09:00:00Z' })
    await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    const steps = (await r.get('healthRecords', `${A.id}|hc:daily:steps:2026-11-14`))!
    const w = (await r.get('healthRecords', `${A.id}|hc:w-1`))!
    expect(steps.value).toBe(9500)
    expect(steps.excluded).toBe(true)
    expect(w.value).toBe(70.6)
    expect(w.excluded).toBe(true)
  })

  it('removes a row when Health Connect reports its deletion', async () => {
    await runSync(deps(), A.id)
    fake.removeRecord('w-1')
    const res = await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    expect(res.counts.deleted).toBe(1)
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:w-1`)).toBeUndefined()
    expect((await rows(A)).filter((x) => x.metric === 'weight')).toHaveLength(2)
  })

  it('prunes a daily row when the aggregate no longer has the day', async () => {
    await runSync(deps(), A.id)
    fake.daily = fake.daily.filter((d) => d.date !== '2026-11-13')
    await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:daily:steps:2026-11-13`)).toBeUndefined()
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:daily:steps:2026-11-14`)).toBeDefined()
  })

  it('picks up new and changed records incrementally through the Changes API', async () => {
    await runSync(deps(), A.id)
    fake.setRecord(weight('w-4', 70.0, '2026-11-15'))
    fake.calls = []
    await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    expect(fake.calls.filter((c) => c.startsWith('getChanges')).length).toBeGreaterThan(0)
    expect(fake.calls.some((c) => c.startsWith('readRecords'))).toBe(false)
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:w-4`)).toBeDefined()
  })

  it('an expired token falls back to a re-read without duplicating rows', async () => {
    await runSync(deps(), A.id)
    const before = (await rows(A)).length
    fake.expireAllTokens()
    fake.setRecord(weight('w-5', 69.5, '2026-11-14'))
    fake.calls = []
    const res = await runSync(deps('2026-11-20T15:00:00Z'), A.id)
    expect(res.ok).toBe(true)
    expect(fake.calls.some((c) => c.startsWith('readRecords:Weight'))).toBe(true)
    const after = await rows(A)
    expect(after.filter((x) => x.metric === 'weight').map((x) => x.externalId).sort()).toEqual(['w-1', 'w-2', 'w-3', 'w-5'])
    expect(after.length).toBeGreaterThanOrEqual(before)
    expect(new Set(after.map((x) => x.id)).size).toBe(after.length)
  })

  it('stores the token only after writing: a failing read leaves no token and the range does not advance', async () => {
    const real = fake.readRecords.bind(fake)
    fake.readRecords = (o) => (o.type === 'Weight' ? Promise.reject(new Error('boom')) : real(o))
    const res = await runSync(deps(), A.id)
    expect(res.ok).toBe(false)
    const st = (await loadState(repo(A.id, db)))!
    expect(st.changesTokens.Weight).toBeUndefined()
    expect(st.changesTokens.ExerciseSession).toBeDefined()
    expect(st.lastSyncTo).toBeNull()
    expect(st.lastError).toMatch(/Weight: boom/)
    expect(st.log[0]).toMatchObject({ ok: false })
    fake.readRecords = real
    const again = await runSync(deps(), A.id)
    expect(again.ok).toBe(true)
    expect(again.plan.kind).toBe('first')
  })

  it('skips categories whose permission was revoked in Health Connect', async () => {
    for (const p of permissionsFor(['body'])) fake.granted.delete(p)
    fake.calls = []
    await runSync(deps(), A.id)
    expect(fake.calls.some((c) => c.includes('Weight'))).toBe(false)
    expect((await rows(A)).some((x) => x.metric === 'weight')).toBe(false)
    expect((await rows(A)).some((x) => x.metric === 'steps')).toBe(true)
  })

  it('reports metrics Health Connect refused as a partial error', async () => {
    fake.skipped = ['distanceM']
    const res = await runSync(deps(), A.id)
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toMatch(/distanceM/)
    expect((await rows(A)).some((x) => x.metric === 'steps')).toBe(true)
    expect((await rows(A)).some((x) => x.metric === 'distanceM')).toBe(false)
  })

  it('reports externally revoked permissions and does not advance the successful sync range', async () => {
    await runSync(deps(), A.id)
    fake.granted.clear()
    fake.calls = []
    const res = await runSync(deps('2026-11-16T15:00:00Z'), A.id)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/revocaron permisos/)
    expect(fake.calls.some((c) => c.startsWith('read'))).toBe(false)
    const state = (await loadState(repo(A.id, db)))!
    expect(state.lastSyncTo).toBe('2026-11-15')
    expect(state.grantedPermissions).toEqual([])
  })

  it('never saves an initial change token after an incomplete paginated read', async () => {
    fake.readRecords = async (o) => o.type === 'Weight'
      ? { records: [], pageToken: 'still-more' }
      : { records: [], pageToken: undefined }
    const res = await runSync(deps(), A.id)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/límite de páginas/)
    expect((await loadState(repo(A.id, db)))!.changesTokens.Weight).toBeUndefined()
    expect((await loadState(repo(A.id, db)))!.lastSyncTo).toBeNull()
  })
})

describe('profile isolation', () => {
  it('sync of A never writes to B and B keeps its own rows', async () => {
    seedFake()
    const rb = repo(B.id, db)
    await upsertHealthRows(rb, [rawToRow(B.id, weight('w-1', 99), NOW)]) // same Health Connect id, other profile
    await connect(deps(), A.id, ['activity', 'body'])
    await runSync(deps(), A.id)
    const forA = await rows(A)
    expect(forA.length).toBeGreaterThan(0)
    expect(forA.every((x) => x.profileId === A.id && x.id.startsWith(`${A.id}|hc:`))).toBe(true)
    const forB = await rows(B)
    expect(forB).toHaveLength(1)
    expect(forB[0]).toMatchObject({ id: `${B.id}|hc:w-1`, value: 99 })
    // a deletion reported for A does not touch B's row with the same external id
    fake.removeRecord('w-1')
    await runSync(deps('2026-11-15T18:00:00Z'), A.id)
    expect(await rb.get('healthRecords', `${B.id}|hc:w-1`)).toBeDefined()
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:w-1`)).toBeUndefined()
    // B has no integration state
    expect(await loadState(rb)).toBeUndefined()
  })

  it('refuses to upsert over another profile row', async () => {
    const rb = repo(B.id, db)
    await upsertHealthRows(rb, [rawToRow(B.id, weight('w-1', 99), NOW)])
    const forged = rawToRow(A.id, weight('w-1', 50), NOW)
    await expect(upsertHealthRows(repo(A.id, db), [{ ...forged, id: `${B.id}|hc:w-1` }])).rejects.toThrow()
  })
})

describe('categories and disconnect', () => {
  it('reads the available history of a newly enabled category after other categories synced', async () => {
    seedFake()
    await connect(deps(), A.id, ['activity'])
    await runSync(deps(), A.id)
    fake.setRecord(weight('older-weight', 71, '2026-10-20'))
    await enableCategory(deps(), A.id, 'body')
    const result = await runSync(deps(), A.id)
    expect(result.plan.kind).toBe('first')
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:older-weight`)).toBeDefined()
  })

  it('reconnecting reads the available history even after a previous successful sync', async () => {
    seedFake()
    await connect(deps(), A.id, ['body'])
    await runSync(deps(), A.id)
    await disconnect(deps(), A.id)
    fake.setRecord(weight('older-weight', 71, '2026-10-20'))
    await connect(deps(), A.id, ['body'])
    const result = await runSync(deps(), A.id)
    expect(result.plan.kind).toBe('first')
    expect(await repo(A.id, db).get('healthRecords', `${A.id}|hc:older-weight`)).toBeDefined()
  })
  it('enabling a category asks only for its permissions; disabling keeps data unless asked and drops its tokens', async () => {
    seedFake()
    await connect(deps(), A.id, ['activity'])
    expect(await enableCategory(deps(), A.id, 'body')).toBe(true)
    await runSync(deps(), A.id)
    expect((await rows(A)).some((x) => x.metric === 'weight')).toBe(true)
    expect((await loadState(repo(A.id, db)))!.changesTokens.Weight).toBeDefined()

    expect(await disableCategory(deps(), A.id, 'body', false)).toBe(0)
    expect((await rows(A)).some((x) => x.metric === 'weight')).toBe(true)
    const st = (await loadState(repo(A.id, db)))!
    expect(st.categories.body).toBe(false)
    expect(st.changesTokens.Weight).toBeUndefined()

    const removed = await disableCategory(deps(), A.id, 'body', true)
    expect(removed).toBe(3)
    expect((await rows(A)).some((x) => x.metric === 'weight')).toBe(false)
    expect((await rows(A)).some((x) => x.metric === 'steps')).toBe(true)
  })

  it('disconnect revokes, marks disconnected, clears tokens, and keeps data by default', async () => {
    seedFake()
    await connect(deps(), A.id, ['activity', 'body'])
    await runSync(deps(), A.id)
    const count = (await rows(A)).length
    const res = await disconnect(deps(), A.id)
    expect(res).toEqual({ revokeFailed: null, deleted: 0 })
    expect(fake.calls).toContain('revokeAll')
    const st = (await loadState(repo(A.id, db)))!
    expect(st).toMatchObject({ status: 'disconnected', categories: {}, grantedPermissions: [], changesTokens: {} })
    expect(await getLinkedProfileId(db)).toBeNull()
    expect(await rows(A)).toHaveLength(count)
  })

  it('disconnect can also delete the imported data, only for that profile', async () => {
    seedFake()
    await upsertHealthRows(repo(B.id, db), [rawToRow(B.id, weight('w-1', 80), NOW)])
    await connect(deps(), A.id, ['activity', 'body'])
    await runSync(deps(), A.id)
    const res = await disconnect(deps(), A.id, true)
    expect(res.deleted).toBeGreaterThan(0)
    expect(await rows(A)).toHaveLength(0)
    expect(await rows(B)).toHaveLength(1)
  })

  it('still disconnects when revoking fails', async () => {
    seedFake()
    await connect(deps(), A.id, ['activity'])
    fake.revokeAll = () => Promise.reject(new Error('no se pudo revocar'))
    const res = await disconnect(deps(), A.id)
    expect(res.revokeFailed).toMatch(/no se pudo revocar/)
    expect((await loadState(repo(A.id, db)))!.status).toBe('disconnected')
    expect(await getLinkedProfileId(db)).toBeNull()
  })
})
