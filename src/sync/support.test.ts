import rules from '../../firestore.rules?raw'
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { SyncLink } from '../db/types'
import { mapAuthError } from './auth'
import { readSyncConfig } from './config'
import { fromMicros, mapFirestoreError, toMicros } from './firestoreRemote'
import { backoff, RETRY_MAX_MS } from './service'
import { deriveStatus } from './status'
import { PROFILE_TABLE, SYNC_TABLES } from './syncTables'

describe('build configuration', () => {
  it('is off unless the four web values are present', () => {
    expect(readSyncConfig({})).toBeNull()
    expect(readSyncConfig({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: 'p' })).toBeNull()
    const c = readSyncConfig({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: 'a' })
    expect(c?.emulatorHost).toBeNull()
    expect(c?.firebase.projectId).toBe('p')
  })

  it('VITE_SYNC_DISABLED=1 switches sync off even with a complete real configuration or emulator host', () => {
    const real = { VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: 'a' }
    expect(readSyncConfig({ ...real, VITE_SYNC_DISABLED: '1' })).toBeNull()
    expect(readSyncConfig({ VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1', VITE_SYNC_DISABLED: '1' })).toBeNull()
    expect(readSyncConfig({ ...real, VITE_SYNC_DISABLED: '0' })?.firebase.projectId).toBe('p')
  })

  it('emulator mode only targets local hosts and demo projects', () => {
    expect(readSyncConfig({ VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' })?.firebase.projectId).toBe('demo-salud')
    expect(readSyncConfig({ VITE_FIREBASE_EMULATOR_HOST: 'evil.example.com' })).toBeNull()
    expect(readSyncConfig({ VITE_FIREBASE_EMULATOR_HOST: 'localhost', VITE_FIREBASE_EMULATOR_PROJECT_ID: 'real-project' })).toBeNull()
    // A real project configured in .env.local is ignored by emulator builds (never mixed in).
    const emu = readSyncConfig({ VITE_FIREBASE_EMULATOR_HOST: 'localhost', VITE_FIREBASE_PROJECT_ID: 'real-project', VITE_FIREBASE_API_KEY: 'real-key', VITE_FIREBASE_APP_ID: 'real-app', VITE_FIREBASE_AUTH_DOMAIN: 'real.example' })
    expect(emu?.firebase).toEqual({ apiKey: 'demo-api-key', authDomain: 'demo-salud.firebaseapp.com', projectId: 'demo-salud', appId: 'demo-app' })
    // A real build can never be configured with a demo project.
    expect(readSyncConfig({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'd', VITE_FIREBASE_PROJECT_ID: 'demo-x', VITE_FIREBASE_APP_ID: 'a' })).toBeNull()
  })
})

describe('security rules stay in step with the code', () => {
  it('lists exactly the synced tables', () => {
    const block = rules.match(/function syncedTables\(\) \{\s*return \[([^\]]+)\]/)![1]!
    const listed = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    expect(listed).toEqual([PROFILE_TABLE, ...SYNC_TABLES].sort())
  })
})

describe('timestamps', () => {
  it('converts Firestore timestamps to exact microseconds and back', () => {
    const t = new Timestamp(1_800_000_000, 123_456_000)
    expect(toMicros(t)).toBe(1_800_000_000_123_456)
    expect(fromMicros(toMicros(t)).isEqual(t)).toBe(true)
    expect(Number.isSafeInteger(toMicros(new Timestamp(4_000_000_000, 999_999_000)))).toBe(true)
  })
})

describe('error mapping never keeps data', () => {
  it('maps Firestore codes to retry decisions', () => {
    expect(mapFirestoreError({ code: 'permission-denied' }).code).toBe('permission')
    expect(mapFirestoreError({ code: 'unauthenticated' }).code).toBe('auth')
    expect(mapFirestoreError({ code: 'unavailable' }).code).toBe('offline')
    expect(mapFirestoreError({ code: 'resource-exhausted' }).code).toBe('quota')
    expect(mapFirestoreError({ code: 'weird' }).code).toBe('unknown')
    expect(mapFirestoreError({ code: 'unknown', message: 'x'.repeat(500) }).message.length).toBeLessThanOrEqual(160)
  })

  it('maps sign-in failures to actionable messages', () => {
    expect(mapAuthError({ code: 'auth/popup-closed-by-user' }).code).toBe('cancelled')
    expect(mapAuthError({ code: 'auth/network-request-failed' }).code).toBe('offline')
    expect(mapAuthError({ code: 'auth/unauthorized-domain' }).code).toBe('domain')
    expect(mapAuthError({ code: 'auth/popup-blocked' }).code).toBe('popup-blocked')
    expect(mapAuthError(new Error('boom')).code).toBe('failed')
  })
})

describe('status and retries', () => {
  const link = (over: Partial<SyncLink> = {}): SyncLink => ({
    profileId: 'p',
    uid: 'u',
    email: null,
    displayName: null,
    linkedAt: '',
    state: 'linked',
    cursor: 0,
    tablesVersion: '',
    lastSyncAt: '2026-11-15T00:00:00Z',
    lastError: null,
    lastErrorCode: null,
    pending: 0,
    heldDeletes: 0,
    verifiedAt: '2026-11-15T00:00:00Z',
    ...over,
  })
  const on = { syncing: false, sessionUid: 'u' }
  it('derives the visible state', () => {
    expect(deriveStatus(undefined, on, 0, true)).toBe('not-linked')
    expect(deriveStatus(link(), on, 0, true)).toBe('synced')
    expect(deriveStatus(link(), { syncing: true, sessionUid: 'u' }, 0, true)).toBe('syncing')
    expect(deriveStatus(link(), { syncing: false, sessionUid: null }, 0, true)).toBe('signed-out')
    expect(deriveStatus(link(), { syncing: false, sessionUid: 'other' }, 0, true)).toBe('account-mismatch')
    expect(deriveStatus(link(), on, 2, true)).toBe('conflicts')
    expect(deriveStatus(link({ heldDeletes: 30 }), on, 0, true)).toBe('held')
    expect(deriveStatus(link({ pending: 3 }), on, 0, false)).toBe('offline')
    expect(deriveStatus(link({ pending: 3 }), on, 0, true)).toBe('pending')
    expect(deriveStatus(link({ lastErrorCode: 'auth' }), on, 0, true)).toBe('auth')
    expect(deriveStatus(link({ lastErrorCode: 'quota' }), on, 0, true)).toBe('error')
    expect(deriveStatus(link({ state: 'linking' }), on, 0, true)).toBe('linking')
  })

  it('backs off exponentially up to a ceiling', () => {
    expect(backoff(1)).toBe(30_000)
    expect(backoff(2)).toBe(60_000)
    expect(backoff(20)).toBe(RETRY_MAX_MS)
  })
})
