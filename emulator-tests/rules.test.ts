import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

// Security rules against the Firestore emulator. Synthetic uids only.
let env: RulesTestEnvironment
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-salud', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } })
})
afterAll(() => env.cleanup())
beforeEach(() => env.clearFirestore())

const row = (over: Record<string, unknown> = {}) => ({ t: 'foodLogs', id: 'row-1', rev: 1, del: false, d: '{"qty":100}', h: 'abc', at: serverTimestamp(), ...over })
const fsOf = (uid: string | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore())
const rowRef = (as: string | null, owner: string, key = 'foodLogs~row-1') => doc(fsOf(as), 'users', owner, 'rows', key)

describe('isolation', () => {
  it('denies everything without a session', async () => {
    await assertFails(setDoc(rowRef(null, 'alice'), row()))
    await assertFails(getDoc(rowRef(null, 'alice')))
    await assertFails(getDoc(doc(fsOf(null), 'users', 'alice')))
  })

  it('lets a user write and read only their own tree', async () => {
    await assertSucceeds(setDoc(rowRef('alice', 'alice'), row()))
    await assertSucceeds(getDoc(rowRef('alice', 'alice')))
    await assertSucceeds(getDocs(collection(fsOf('alice'), 'users', 'alice', 'rows')))
    await assertFails(getDoc(rowRef('bob', 'alice')))
    await assertFails(getDocs(collection(fsOf('bob'), 'users', 'alice', 'rows')))
    await assertFails(setDoc(rowRef('bob', 'alice', 'foodLogs~row-2'), row({ id: 'row-2' })))
    await assertFails(deleteDoc(rowRef('bob', 'alice')))
    await assertFails(getDoc(doc(fsOf('bob'), 'users', 'alice')))
  })

  it('denies any other collection', async () => {
    await assertFails(setDoc(doc(fsOf('alice'), 'shared', 'x'), { a: 1 }))
    await assertFails(getDocs(collection(fsOf('alice'), 'users')))
  })
})

describe('row format and revisions', () => {
  it('creates only at revision 1 and updates only to the next revision', async () => {
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ rev: 2 })))
    await assertSucceeds(setDoc(rowRef('alice', 'alice'), row()))
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ rev: 1 }))) // stale: same revision again
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ rev: 3 }))) // skips a revision
    await assertSucceeds(setDoc(rowRef('alice', 'alice'), row({ rev: 2, d: '{"qty":150}' })))
    await assertSucceeds(setDoc(rowRef('alice', 'alice'), row({ rev: 3, del: true, d: null, h: null })))
  })

  it('rejects malformed rows', async () => {
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ extra: 1 })))
    await assertFails(setDoc(rowRef('alice', 'alice', 'secrets~row-1'), row({ t: 'secrets' })))
    await assertFails(setDoc(rowRef('alice', 'alice', 'healthRecords~row-1'), row({ t: 'healthRecords' })))
    await assertFails(setDoc(rowRef('alice', 'alice', 'progressPhotos~row-1'), row({ t: 'progressPhotos' })))
    await assertFails(setDoc(rowRef('alice', 'alice', 'vitals~row-1'), row())) // key does not match table
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ at: Timestamp.fromMillis(0) }))) // client clock
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ del: true }))) // tombstone with data
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ d: 'x'.repeat(200_001) })))
    const noAt: Record<string, unknown> = row()
    delete noAt.at
    await assertFails(setDoc(rowRef('alice', 'alice'), noAt))
  })

  it('cannot change the table or id of an existing row', async () => {
    await assertSucceeds(setDoc(rowRef('alice', 'alice'), row()))
    await assertFails(setDoc(rowRef('alice', 'alice'), row({ rev: 2, id: 'other' })))
    await assertFails(updateDoc(rowRef('alice', 'alice'), { rev: 2, t: 'vitals', at: serverTimestamp() }))
  })
})

describe('account metadata', () => {
  const meta = { profileName: 'Perfil', createdAt: 1, schema: 5, appVersion: '2.2.0' }
  it('validates the meta document and allows deleting only your own', async () => {
    await assertSucceeds(setDoc(doc(fsOf('alice'), 'users', 'alice'), meta))
    await assertFails(setDoc(doc(fsOf('alice'), 'users', 'alice'), { ...meta, email: 'x@example.test' }))
    await assertFails(setDoc(doc(fsOf('bob'), 'users', 'alice'), meta))
    await assertFails(deleteDoc(doc(fsOf('bob'), 'users', 'alice')))
    await assertSucceeds(deleteDoc(doc(fsOf('alice'), 'users', 'alice')))
  })
})
