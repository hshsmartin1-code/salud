import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, importBackup, parseBackup } from './backup'
import { listProfiles, normalizeProfile } from './profiles'
import { createDB, type SaludDB } from './schema'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`profile-settings-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const backupWithoutSettings = () =>
  JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: 2,
    appVersion: '3.0.0',
    exportedAt: '2026-01-01T00:00:00.000Z',
    scope: 'profile',
    profiles: [{ id: 'p1', name: 'Ana', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'emerald', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    includedTables: [],
    media: true,
    tables: {},
  })

describe('profile settings are always present', () => {
  it('normalizeProfile fills missing or malformed settings and keeps valid ones', () => {
    expect(normalizeProfile({ settings: undefined } as unknown as { settings: { addActivityKcal: boolean } }).settings).toEqual({ addActivityKcal: false })
    expect(normalizeProfile({ settings: null } as unknown as { settings: { addActivityKcal: boolean } }).settings).toEqual({ addActivityKcal: false })
    const ok = { settings: { addActivityKcal: true } }
    expect(normalizeProfile(ok)).toBe(ok)
  })

  it('parseBackup + restore of a profile without settings yields a readable settings object', async () => {
    const b = parseBackup(backupWithoutSettings())
    expect(b.profiles[0].settings).toEqual({ addActivityKcal: false })
    await importBackup(b, { mode: 'replace', mapping: { p1: 'new' } }, db)
    const [p] = await listProfiles(db)
    expect(p.settings.adaptive?.mode).toBeUndefined()
    expect(p.settings.addActivityKcal).toBe(false)
  })

  it('listProfiles repairs a row already stored without settings', async () => {
    await db.profiles.add({ id: 'x', name: 'Sin ajustes', sex: 'male', createdAt: 'a', updatedAt: 'a' } as never)
    const [p] = await listProfiles(db)
    expect(p.settings).toEqual({ addActivityKcal: false })
  })
})
