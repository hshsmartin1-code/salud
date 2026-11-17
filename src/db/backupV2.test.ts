import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_TABLES, exportBackup, importBackup, parseBackup, previewImport, stableId, type Backup } from './backup'
import { createProfile } from './profiles'
import { repo } from './repo'
import { createDB, type SaludDB } from './schema'
import { PERSONAL_TABLES } from './tables'

// Synthetic data only.
let db: SaludDB
let other: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`backup-v2-${Date.now()}-${n++}`)
  other = createDB(`backup-v2-other-${Date.now()}-${n++}`)
  await db.open()
  await other.open()
})
afterEach(async () => {
  await db.delete()
  await other.delete()
})

const mk = (name: string, database = db) =>
  createProfile({ name, sex: 'male', birthDate: '1992-05-01', heightCm: 175, activity: null, color: 'sky', settings: { addActivityKcal: false } }, database)

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(400)

async function seedV2(profileId: string, database = db) {
  const r = repo(profileId, database)
  await r.add('vitals', { date: '2026-03-01', time: '07:30', kind: 'bloodPressure', systolic: 118, diastolic: 76, value: null, unit: 'mmHg' })
  await r.add('hydrationLogs', { date: '2026-03-01', time: '09:00', ml: 500 })
  await r.add('progressPhotos', { date: '2026-03-01', pose: 'front', dataUrl: PHOTO, thumbUrl: PHOTO.slice(0, 60), width: 800, height: 1200, bytes: 300 })
  await r.put('exerciseFavorites', { id: `${profileId}|fedb:Plank`, exerciseId: 'fedb:Plank', name: 'Plancha' })
  await r.put('healthRecords', {
    id: `${profileId}|hc:daily:steps:2026-03-01`,
    provider: 'health-connect',
    kind: 'daily',
    metric: 'steps',
    date: '2026-03-01',
    start: null,
    end: null,
    value: 8421,
    unit: 'count',
    sources: ['com.example.band'],
    externalId: null,
    lastModified: null,
    importedAt: '2026-03-02T10:00:00.000Z',
  })
  await r.put('integrations', {
    id: `${profileId}|health-connect`,
    provider: 'health-connect',
    status: 'connected',
    categories: { activity: true },
    grantedPermissions: ['android.permission.health.READ_STEPS'],
    linkedAt: '2026-03-01T00:00:00.000Z',
    lastSyncAt: null,
    lastSyncFrom: null,
    lastSyncTo: null,
    changesTokens: { steps: 'device-token' },
    lastError: null,
    log: [],
  })
  await r.add('bodyMeasurements', { date: '2026-03-01', weightKg: 80, circumferences: {}, skinfolds: {}, protocol: null, derived: null })
}

const strip = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))

describe('backups v2', () => {
  it('round-trips every backup table (photos included) into a fresh database', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const b = parseBackup(JSON.stringify(await exportBackup('all', db)))
    expect(b.schemaVersion).toBe(2)
    expect(b.media).toBe(true)
    expect(b.includedTables).toEqual(BACKUP_TABLES)
    await importBackup(b, { mode: 'merge', mapping: { [p.id]: 'new' } }, other)
    for (const t of BACKUP_TABLES) {
      expect(strip(await other.table(t).toArray()), t).toEqual(strip(await db.table(t).toArray()))
    }
    const photo = await other.progressPhotos.toCollection().first()
    expect(photo?.dataUrl).toBe(PHOTO)
  })

  it('never exports device-only state (integration tokens)', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const b = await exportBackup({ profileId: p.id }, db)
    expect(b.tables.integrations).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('device-token')
    expect(b.tables.healthRecords).toHaveLength(1)
  })

  it('a backup without photos cannot wipe existing photos on replace', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const lite = await exportBackup({ profileId: p.id }, db, { includeMedia: false })
    expect(lite.media).toBe(false)
    expect(lite.tables.progressPhotos).toBeUndefined()
    expect(lite.includedTables).not.toContain('progressPhotos')
    await repo(p.id, db).add('vitals', { date: '2026-03-02', time: null, kind: 'restingHr', value: 58, unit: 'lpm' })
    const res = await importBackup(parseBackup(JSON.stringify(lite)), { mode: 'replace', mapping: { [p.id]: p.id } }, db)
    expect(await db.progressPhotos.count()).toBe(1) // untouched
    expect(await db.integrations.count()).toBe(1) // device state untouched
    expect(await db.vitals.count()).toBe(1) // the vital added after the backup is replaced by the backup's content
    expect(res.byTable.vitals).toMatchObject({ removed: 2, inserted: 1 })
  })

  it('an older (v1) backup restores without deleting tables it does not know', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const v2 = await exportBackup({ profileId: p.id }, db)
    const v1 = {
      ...v2,
      schemaVersion: 1,
      appVersion: '1.1.0',
      includedTables: undefined,
      media: undefined,
      tables: { bodyMeasurements: v2.tables.bodyMeasurements, foodLogs: [] },
    }
    const b = parseBackup(JSON.stringify(v1))
    expect(b.includedTables.sort()).toEqual(['bodyMeasurements', 'foodLogs'])
    await importBackup(b, { mode: 'replace', mapping: { [p.id]: p.id } }, db)
    expect(await db.vitals.count()).toBe(1)
    expect(await db.hydrationLogs.count()).toBe(1)
    expect(await db.progressPhotos.count()).toBe(1)
    expect(await db.bodyMeasurements.count()).toBe(1)
  })

  it('previewImport reports exactly what importBackup does, without writing', async () => {
    const a = await mk('Origen')
    await seedV2(a.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    const target = await mk('Destino')
    await repo(target.id, db).add('vitals', { date: '2026-01-01', time: null, kind: 'spo2', value: 97, unit: '%' })
    const plan = { mode: 'replace' as const, mapping: { [a.id]: target.id } }
    const before = await db.vitals.count()
    const preview = await previewImport(b, plan, db)
    expect(await db.vitals.count()).toBe(before)
    const real = await importBackup(b, plan, db)
    expect(preview).toEqual(real)
    expect(real.byTable.vitals).toMatchObject({ removed: 1, inserted: 1 })
  })

  it('importing the same profile backup twice into another profile does not duplicate rows', async () => {
    const a = await mk('Origen')
    await seedV2(a.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: a.id }, db)))
    const target = await mk('Destino')
    const plan = { mode: 'merge' as const, mapping: { [a.id]: target.id } }
    await importBackup(b, plan, db)
    const second = await importBackup(b, plan, db)
    expect(second.inserted).toBe(0)
    const r = repo(target.id, db)
    expect(await r.count('vitals')).toBe(1)
    expect(await r.count('progressPhotos')).toBe(1)
    expect(await r.count('healthRecords')).toBe(1)
    // The source profile is untouched.
    expect(await repo(a.id, db).count('vitals')).toBe(1)
    const fav = await r.all('exerciseFavorites')
    expect(fav[0]?.id).toBe(`${target.id}|fedb:Plank`)
  })

  it('merge keeps a local record that is newer than the backup and reports it', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const b = parseBackup(JSON.stringify(await exportBackup({ profileId: p.id }, db)))
    const r = repo(p.id, db)
    const [v] = await r.all('vitals')
    await new Promise((res) => setTimeout(res, 5))
    await r.update('vitals', v!.id, { systolic: 121 })
    const res = await importBackup(b, { mode: 'merge', mapping: { [p.id]: p.id } }, db)
    expect(res.byTable.vitals).toMatchObject({ conflicts: 1, updated: 0 })
    expect((await r.get('vitals', v!.id))?.systolic).toBe(121)
  })

  it('rejects incoherent files: bad dates, repeated ids, rows of absent profiles', async () => {
    const p = await mk('Perfil sintético')
    await seedV2(p.id)
    const b = await exportBackup({ profileId: p.id }, db)
    const badDate: Backup = { ...b, tables: { ...b.tables, vitals: [{ ...b.tables.vitals![0]!, date: '01/03/2026' }] } }
    expect(() => parseBackup(JSON.stringify(badDate))).toThrow(/fecha válida/)
    const dup: Backup = { ...b, tables: { ...b.tables, vitals: [b.tables.vitals![0]!, b.tables.vitals![0]!] } }
    expect(() => parseBackup(JSON.stringify(dup))).toThrow(/repite/)
    const orphan: Backup = { ...b, tables: { ...b.tables, vitals: [{ ...b.tables.vitals![0]!, profileId: 'nadie' }] } }
    expect(() => parseBackup(JSON.stringify(orphan))).toThrow(/no está en el respaldo/)
  })

  it('stableId is deterministic, UUID-shaped and seed-sensitive', () => {
    expect(stableId('a:b')).toBe(stableId('a:b'))
    expect(stableId('a:b')).not.toBe(stableId('a:c'))
    expect(stableId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('rejects impossible calendar dates and duplicate profiles before any import', async () => {
    const p = await mk('Sintético')
    await seedV2(p.id)
    const b = await exportBackup('all', db)
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01']) {
      const bad = { ...b, tables: { ...b.tables, vitals: [{ ...b.tables.vitals![0], date }] } }
      expect(() => parseBackup(JSON.stringify(bad))).toThrow(/fecha válida/)
    }
    expect(() => parseBackup(JSON.stringify({ ...b, profiles: [p, p] }))).toThrow(/perfil/)
  })

  it('rejects ambiguous v2 table declarations', async () => {
    await mk('Sintético')
    const b = await exportBackup('all', db)
    for (const includedTables of [undefined, [], ['vitals', 'vitals'], [...b.includedTables, 'integrations']]) {
      const tables = includedTables?.includes('integrations') ? { ...b.tables, integrations: [] } : b.tables
      // Device tables are intentionally ignored even if a foreign backup contains them.
      if (includedTables?.includes('integrations')) {
        expect(parseBackup(JSON.stringify({ ...b, includedTables, tables })).includedTables).not.toContain('integrations')
      } else expect(() => parseBackup(JSON.stringify({ ...b, includedTables, tables }))).toThrow(/includedTables/)
    }
  })

  it('an explicitly empty backup never touches existing tables', async () => {
    const p = await mk('Sintético')
    await seedV2(p.id)
    const b = parseBackup(JSON.stringify({ ...await exportBackup('all', db), tables: {}, includedTables: [] }))
    const result = await importBackup(b, { mode: 'replace', mapping: { [p.id]: p.id } }, db)
    expect(result.removed).toBe(0)
    expect(await db.vitals.count()).toBe(1)
    expect(await db.progressPhotos.count()).toBe(1)
  })

  it('rejects mapping two source profiles onto one destination without changing data', async () => {
    const a = await mk('Uno')
    const b = await mk('Dos')
    await seedV2(a.id)
    await seedV2(b.id)
    const backup = await exportBackup('all', db)
    const plan = { mode: 'replace' as const, mapping: { [a.id]: a.id, [b.id]: a.id } }
    await expect(previewImport(backup, plan, db)).rejects.toThrow(/destino diferente/)
    await expect(importBackup(backup, plan, db)).rejects.toThrow(/destino diferente/)
    expect(await db.vitals.count()).toBe(2)
  })

  it('classifies every table: device tables are personal but never part of backups', () => {
    expect(PERSONAL_TABLES).toContain('integrations')
    expect(BACKUP_TABLES).not.toContain('integrations')
  })
})
