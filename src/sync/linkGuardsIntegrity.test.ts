import { afterEach, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

const account = { uid: 'synthetic-guard', email: null, displayName: 'Perfil sintetico' }
const dbs: SaludDB[] = []
async function device() {
  const db = createDB(`link-guard-review-${crypto.randomUUID()}`)
  await db.open()
  dbs.push(db)
  return db
}
const addProfile = (db: SaludDB) => createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete() })

it('reserves an account atomically when two local profiles try to link concurrently', async () => {
  const db = await device()
  const server = new MemoryServer()
  const profiles = [await addProfile(db), await addProfile(db)]
  for (const [i, p] of profiles.entries()) await repo(p.id, db).add('hydrationLogs', { date: '2026-11-10', time: null, ml: (i + 1) * 100 })
  const results = await Promise.allSettled(profiles.map((p) => linkProfile(db, p.id, server.remote(account.uid), account)))
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await db.syncLinks.count()).toBe(1)
  expect([...server.docs(account.uid).values()].filter((d) => d.t === 'hydrationLogs')).toHaveLength(1)
})

it('creates only one profile for concurrent restores of the same account', async () => {
  const server = new MemoryServer()
  const source = await device()
  const p = await addProfile(source)
  await linkProfile(source, p.id, server.remote(account.uid), account)
  const db = await device()
  const results = await Promise.allSettled([createProfileFromAccount(db, server.remote(account.uid), account), createProfileFromAccount(db, server.remote(account.uid), account)])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await db.profiles.count()).toBe(1)
  expect(await db.syncLinks.count()).toBe(1)
})

it('refuses restoration when the selected account differs from the remote session', async () => {
  const db = await device()
  const server = new MemoryServer()
  await expect(createProfileFromAccount(db, server.remote('synthetic-other-account'), account)).rejects.toThrow('sesión')
  expect(await db.profiles.count()).toBe(0)
  expect(server.calls.written).toBe(0)
})
