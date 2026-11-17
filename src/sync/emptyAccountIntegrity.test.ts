import { afterEach, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import { linkProfile, previewAccount } from './link'
import { MemoryServer } from './memoryRemote'

const account = { uid: 'synthetic-account', email: null, displayName: 'Perfil sintetico' }
const dbs: SaludDB[] = []
async function profile() {
  const db = createDB(`empty-account-review-${crypto.randomUUID()}`)
  await db.open()
  dbs.push(db)
  const p = await createProfile({ name: 'Perfil sintetico', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
  return { db, id: p.id }
}
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete() })

it('does not merge a newly populated cloud account after confirming an empty-account preview', async () => {
  const server = new MemoryServer()
  const fresh = await profile()
  const remote = server.remote(account.uid)
  expect((await previewAccount(fresh.db, remote)).hasData).toBe(false)
  // Another device fills the account between the preview and the explicit empty-account confirmation.
  const other = await profile()
  await repo(other.id, other.db).add('hydrationLogs', { date: '2026-11-10', time: null, ml: 250 })
  await linkProfile(other.db, other.id, remote, account)
  const written = server.calls.written
  const opts = { expectEmptyAccount: true, now: new Date() }
  await expect(linkProfile(fresh.db, fresh.id, remote, account, opts)).rejects.toThrow('cuenta')
  expect(await fresh.db.syncLinks.count()).toBe(0)
  expect(await repo(fresh.id, fresh.db).count('hydrationLogs')).toBe(0)
  expect(server.calls.written).toBe(written)
})
