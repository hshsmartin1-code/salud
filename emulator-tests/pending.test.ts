import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../src/db/profiles'
import { repo } from '../src/db/repo'
import { createDB, type SaludDB } from '../src/db/schema'
import { adoptPendingSession, currentAccount, signInPending, signInProfile, signOutPending } from '../src/sync/auth'
import { PENDING_SESSION } from '../src/sync/firebase'
import { createProfileFromAccount, linkProfile, previewAccount } from '../src/sync/link'
import { remoteFor } from '../src/sync/service'

// "Google first": a session that belongs to no profile, read before anything local exists (Auth + Firestore emulators).
const uniq = Date.now().toString(36)
const ID_NEW = { sub: `pend-new-${uniq}`, email: `nueva.${uniq}@example.test`, name: 'Cuenta Nueva' }
const ID_OLD = { sub: `pend-old-${uniq}`, email: `vieja.${uniq}@example.test`, name: 'Cuenta Vieja' }

const dbs: SaludDB[] = []
const mkdb = async (tag: string) => {
  const db = createDB(`pending-${tag}-${uniq}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  await signOutPending().catch(() => undefined)
  for (const db of dbs.splice(0)) await db.delete()
})
const mk = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'emerald', settings: { addActivityKcal: false } }, db)

describe('pending session (Google before any profile)', () => {
  it('an empty account: profile first, then the session moves and the link verifies', async () => {
    const db = await mkdb('empty')
    const account = await signInPending({ emulatorIdentity: ID_NEW })
    const preview = await previewAccount(db, await remoteFor(PENDING_SESSION))
    expect(preview.hasData).toBe(false)
    expect(preview.total).toBe(0)

    const p = await mk(db, 'Persona Nueva')
    await repo(p.id, db).add('hydrationLogs', { date: '2026-11-10', time: '08:00', ml: 300 } as never)
    await adoptPendingSession(p.id)
    expect((await currentAccount(p.id))?.uid).toBe(account.uid)
    expect(await currentAccount(PENDING_SESSION)).toBeNull()
    const r = await linkProfile(db, p.id, await remoteFor(p.id), account)
    expect(r.verify.ok).toBe(true)
    expect((await db.syncLinks.get(p.id))?.verifiedAt).toBeTruthy()
  })

  it('an account with data is read without a profile, restored into a NEW profile, and a second device cannot link it again', async () => {
    const dev1 = await mkdb('dev1')
    const p1 = await mk(dev1, 'Persona Vieja')
    await repo(p1.id, dev1).add('hydrationLogs', { date: '2026-11-10', time: '08:00', ml: 300 } as never)
    await repo(p1.id, dev1).add('hydrationLogs', { date: '2026-11-10', time: '09:00', ml: 200 } as never)
    const acc1 = await signInProfile(p1.id, { emulatorIdentity: ID_OLD })
    expect((await linkProfile(dev1, p1.id, await remoteFor(p1.id), acc1)).verify.ok).toBe(true)

    // Another device: nothing local. Read the account, then restore.
    const dev2 = await mkdb('dev2')
    const account = await signInPending({ emulatorIdentity: ID_OLD })
    const preview = await previewAccount(dev2, await remoteFor(PENDING_SESSION))
    expect(preview.hasData).toBe(true)
    expect(preview.meta?.profileName).toBe('Persona Vieja')
    expect(preview.counts.hydrationLogs).toBe(2)
    expect(preview.usedBy).toBeNull()
    expect(await dev2.profiles.count()).toBe(0) // reading created nothing

    const r = await createProfileFromAccount(dev2, await remoteFor(PENDING_SESSION), account)
    await adoptPendingSession(r.profileId)
    expect(r.verify.ok).toBe(true)
    expect(await repo(r.profileId, dev2).count('hydrationLogs')).toBe(2)
    expect((await currentAccount(r.profileId))?.uid).toBe(acc1.uid)

    // The same account cannot be taken by a second profile of that device.
    await signInPending({ emulatorIdentity: ID_OLD })
    const again = await previewAccount(dev2, await remoteFor(PENDING_SESSION))
    expect(again.usedBy).toBe(r.profileId)
    await expect(createProfileFromAccount(dev2, await remoteFor(PENDING_SESSION), account)).rejects.toMatchObject({ code: 'account-in-use' })
    expect(await dev2.profiles.count()).toBe(1)
    await signOutPending()
    expect(await currentAccount(PENDING_SESSION)).toBeNull()
  })
})
