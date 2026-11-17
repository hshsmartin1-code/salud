import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../src/db/profiles'
import { repo } from '../src/db/repo'
import { createDB, type SaludDB } from '../src/db/schema'
import { currentAccount, signInProfile, signOutProfile } from '../src/sync/auth'
import { SYNC_CONFIG } from '../src/sync/config'
import { linkProfile } from '../src/sync/link'
import { remoteFor, runSync } from '../src/sync/service'

// Per-profile sessions against the Auth emulator (fake Google identities, synthetic data).
const ID_A = { sub: 'google-a', email: 'persona.a@example.test', name: 'Persona A' }
const ID_B = { sub: 'google-b', email: 'persona.b@example.test', name: 'Persona B' }

const dbs: SaludDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})
const mk = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'male', birthDate: null, heightCm: null, activity: null, color: 'emerald', settings: { addActivityKcal: false } }, db)

describe('per-profile Google sessions (emulator)', () => {
  it('uses emulator mode with a demo project only', () => {
    expect(SYNC_CONFIG?.emulatorHost).toBe('127.0.0.1')
    expect(SYNC_CONFIG?.firebase.projectId.startsWith('demo-')).toBe(true)
  })

  it('two local profiles hold two different accounts at once and sync only their own data', async () => {
    const db = createDB(`auth-${Date.now()}`)
    await db.open()
    dbs.push(db)
    const pa = await mk(db, 'Persona A')
    const pb = await mk(db, 'Persona B')
    await repo(pa.id, db).add('hydrationLogs', { date: '2026-11-10', time: '08:00', ml: 300 } as never)
    await repo(pb.id, db).add('hydrationLogs', { date: '2026-11-10', time: '09:00', ml: 500 } as never)

    const accA = await signInProfile(pa.id, { emulatorIdentity: ID_A })
    const accB = await signInProfile(pb.id, { emulatorIdentity: ID_B })
    expect(accA.uid).not.toBe(accB.uid)
    expect((await currentAccount(pa.id))?.uid).toBe(accA.uid)
    expect((await currentAccount(pb.id))?.uid).toBe(accB.uid)

    await linkProfile(db, pa.id, await remoteFor(pa.id), accA)
    await linkProfile(db, pb.id, await remoteFor(pb.id), accB)
    const ra = await remoteFor(pa.id)
    const rb = await remoteFor(pb.id)
    expect((await ra.liveCounts()).hydrationLogs).toBe(1)
    expect((await rb.liveCounts()).hydrationLogs).toBe(1)
    const mlOf = async (r: typeof ra) => (await r.pull(null, null, 50)).filter((d) => d.t === 'hydrationLogs').map((d) => JSON.parse(d.d!).ml)
    expect(await mlOf(ra)).toEqual([300])
    expect(await mlOf(rb)).toEqual([500])

    // Signing out one profile leaves the other signed in; its data stays on the device.
    await signOutProfile(pa.id)
    expect(await currentAccount(pa.id)).toBeNull()
    expect((await currentAccount(pb.id))?.uid).toBe(accB.uid)
    await expect(runSync(pa.id, {}, db)).rejects.toThrow()
    expect(await repo(pa.id, db).count('hydrationLogs')).toBe(1)

    // Signing the profile back in with the other person's account is refused by the engine.
    await signInProfile(pa.id, { emulatorIdentity: ID_B })
    await expect(runSync(pa.id, {}, db)).rejects.toMatchObject({ code: 'account-mismatch' })
    expect((await db.syncLinks.get(pa.id))?.uid).toBe(accA.uid)
    await signOutProfile(pa.id)
    await signOutProfile(pb.id)
  })
})
