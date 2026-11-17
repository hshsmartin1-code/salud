import { afterEach, expect, it, vi } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { createProfileFromAccount, linkProfile } from './link'
import { MemoryServer } from './memoryRemote'

const account = { uid: 'synthetic-restore', email: null, displayName: 'Perfil sintetico' }
const dbs: SaludDB[] = []
async function device() {
  const db = createDB(`restore-review-${crypto.randomUUID()}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete() })

it('rolls back a new restore after a connection loss and permits retry with the same account', async () => {
  const server = new MemoryServer()
  const source = await device()
  const target = await device()
  const profile = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, source)
  await repo(profile.id, source).add('hydrationLogs', { date: '2026-11-10', time: null, ml: 250 })
  await linkProfile(source, profile.id, server.remote(account.uid), account)
  const before = [...server.docs(account.uid)]
  const broken = server.remote(account.uid)
  vi.spyOn(broken, 'pull').mockRejectedValue(new Error('synthetic offline'))
  await expect(createProfileFromAccount(target, broken, account)).rejects.toThrow('synthetic offline')
  expect(await target.profiles.count()).toBe(0)
  expect(await target.syncLinks.count()).toBe(0)
  expect(await target.syncShadow.count()).toBe(0)
  expect(await target.syncConflicts.count()).toBe(0)
  expect([...server.docs(account.uid)]).toEqual(before)
  const restored = await createProfileFromAccount(target, server.remote(account.uid), account)
  expect(restored.verify.ok).toBe(true)
  expect(await target.profiles.count()).toBe(1)
  expect(await repo(restored.profileId, target).count('hydrationLogs')).toBe(1)
})

it('does not finish a restore that could not verify all cloud records', async () => {
  const server = new MemoryServer()
  const source = await device()
  const target = await device()
  const profile = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, source)
  await repo(profile.id, source).add('hydrationLogs', { date: '2026-11-10', time: null, ml: 250 })
  await linkProfile(source, profile.id, server.remote(account.uid), account)
  const unreadable = [...server.docs(account.uid).values()].find((doc) => doc.t === 'hydrationLogs')!
  server.docs(account.uid).set(unreadable.key, { ...unreadable, d: '{broken' })
  await expect(createProfileFromAccount(target, server.remote(account.uid), account)).rejects.toThrow('verificar')
  expect(await target.profiles.count()).toBe(0)
  expect(await target.syncLinks.count()).toBe(0)
})
