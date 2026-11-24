/**
 * Versioned JSON backups. Export one profile or everything; import with replace or merge.
 * A profile export can be imported into a different profile: ids are remapped (deterministically,
 * so importing the same file twice never duplicates rows) and never collide with another profile.
 *
 * Safety rules:
 * - A restore never touches tables that are not in the backup (a backup without photos, or one made by
 *   an older version, cannot wipe newer data).
 * - Device-only state (integration connections, sync tokens) is never exported nor overwritten.
 * - Everything is applied in a single IndexedDB transaction: it is all-or-nothing.
 * - `previewImport` computes exactly what an import would do without writing anything.
 */
import { z } from 'zod'
import { isCalendarDate, todayLocal } from '../domain/dates'
import { validHouseholdPortion } from '../domain/portions'
import { db as defaultDb, SCHEMA_VERSION, type SaludDB } from './schema'
import { DATED_TABLES, MEDIA_TABLES, PERSONAL_TABLES, type PersonalTable } from './tables'
import { normalizeProfile } from './profiles'
import { APP_VERSION } from '../appVersion'
import { stableId } from './stableId'
import type { Profile } from './types'

export const BACKUP_FORMAT = 'pho-backup'
/** v2 (app 2.0): adds `includedTables` / `media`; new tables (vitals, photos, Health Connect…). */
export const BACKUP_VERSION = 2
/** Re-exported for existing importers; the constant lives in a tiny module so eager code does not pull zod. */
export { APP_VERSION, stableId }

/** Per-device state that must never travel inside a backup. */
export const DEVICE_TABLES = ['integrations'] as const satisfies readonly PersonalTable[]
const isDeviceTable = (t: string) => (DEVICE_TABLES as readonly string[]).includes(t)
/** Tables a backup can carry. */
export const BACKUP_TABLES = PERSONAL_TABLES.filter((t) => !isDeviceTable(t))

type Row = Record<string, unknown> & { id: string; profileId: string; updatedAt?: string }

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  appVersion: string
  exportedAt: string
  scope: 'profile' | 'all'
  profiles: Profile[]
  /** Tables contained in this file. A restore only replaces these. */
  includedTables: PersonalTable[]
  /** false when photos were left out on purpose. */
  media: boolean
  tables: Partial<Record<PersonalTable, Row[]>>
}

const rowSchema = z.looseObject({ id: z.string().min(1), profileId: z.string().min(1) })
const profileSchema = z.looseObject({ id: z.string().min(1), name: z.string(), sex: z.enum(['male', 'female']) })
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  appVersion: z.string(),
  exportedAt: z.string(),
  scope: z.enum(['profile', 'all']),
  profiles: z.array(profileSchema).min(1),
  includedTables: z.array(z.string()).optional(),
  media: z.boolean().optional(),
  tables: z.record(z.string(), z.array(rowSchema)),
})

/** Upgrade older backup versions step by step. */
const MIGRATIONS: Record<number, (b: Backup) => Backup> = {
  // v1 files have no includedTables: they contain exactly the tables present as keys.
  1: (b) => ({ ...b, includedTables: Object.keys(b.tables) as PersonalTable[], media: true }),
}

export function migrateBackup(b: Backup): Backup {
  let cur = b
  while (cur.schemaVersion < BACKUP_VERSION) {
    const step = MIGRATIONS[cur.schemaVersion]
    if (!step) throw new Error(`No hay migración desde la versión ${cur.schemaVersion}`)
    cur = { ...step(cur), schemaVersion: cur.schemaVersion + 1 }
  }
  return cur
}

export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }
  const res = backupSchema.safeParse(raw)
  if (!res.success) {
    const fmt = (raw as { format?: unknown })?.format
    if (fmt && fmt !== BACKUP_FORMAT) throw new Error(`Formato no reconocido: ${String(fmt)}. Se esperaba un respaldo de esta app.`)
    throw new Error('El respaldo no tiene la estructura esperada: ' + res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const b = res.data as unknown as Backup
  if (b.schemaVersion > BACKUP_VERSION) throw new Error('El respaldo es de una versión más nueva de la app. Actualiza la app primero.')
  // Unknown tables (from a future version or tampering) and device-only tables are ignored.
  for (const t of Object.keys(b.tables))
    if (!(BACKUP_TABLES as readonly string[]).includes(t)) delete (b.tables as Record<string, unknown>)[t]
  const declared = b.includedTables?.filter((t) => (BACKUP_TABLES as readonly string[]).includes(t))
  if (b.schemaVersion >= 2 && (!declared || new Set(declared).size !== declared.length ||
    declared.some((t) => !(t in b.tables)) || Object.keys(b.tables).some((t) => !declared.includes(t as PersonalTable)))) {
    throw new Error('El respaldo no es coherente: includedTables no coincide con las tablas incluidas.')
  }
  if (declared) b.includedTables = declared
  const ids = new Set(b.profiles.map((p) => p.id))
  const problems: string[] = []
  if (ids.size !== b.profiles.length) problems.push('El respaldo repite identificadores de perfil.')
  for (const [t, rows] of Object.entries(b.tables)) {
    if (t === 'foodPortions' && rows!.some((row) => !validHouseholdPortion(row)))
      problems.push('Hay porciones personalizadas con medidas o unidades inválidas.')
    const bad = rows!.filter((r) => !ids.has(r.profileId)).length
    if (bad) problems.push(`La tabla ${t} tiene ${bad} filas de un perfil que no está en el respaldo.`)
    if ((DATED_TABLES as readonly string[]).includes(t)) {
      const badDate = rows!.filter((r) => !isCalendarDate(r.date)).length
      if (badDate) problems.push(`La tabla ${t} tiene ${badDate} filas sin una fecha válida (AAAA-MM-DD).`)
    }
    const seen = new Set<string>()
    let dup = 0
    for (const r of rows!) {
      if (seen.has(r.id)) dup++
      seen.add(r.id)
    }
    if (dup) problems.push(`La tabla ${t} repite ${dup} identificadores.`)
  }
  if (problems.length) throw new Error('El respaldo no es coherente y no se importó: ' + problems.slice(0, 4).join(' '))
  b.profiles = b.profiles.map(normalizeProfile)
  return migrateBackup(b)
}

export interface ExportOptions {
  /** Include label and progress photos (default true). */
  includeMedia?: boolean
}

export async function exportBackup(scope: { profileId: string } | 'all', database: SaludDB = defaultDb, opts: ExportOptions = {}): Promise<Backup> {
  const includeMedia = opts.includeMedia ?? true
  const profiles = scope === 'all' ? await database.profiles.toArray() : [await database.profiles.get(scope.profileId)].filter((p): p is Profile => !!p)
  if (!profiles.length) throw new Error('Perfil no encontrado')
  const included = BACKUP_TABLES.filter((t) => includeMedia || !(MEDIA_TABLES as readonly string[]).includes(t))
  const tables: Backup['tables'] = {}
  await database.transaction('r', [database.profiles, ...included.map((t) => database.table(t))], async () => {
    for (const t of included) {
      const tbl = database.table(t)
      tables[t] = (scope === 'all' ? await tbl.toArray() : await tbl.where('profileId').equals(scope.profileId).toArray()) as Row[]
    }
  })
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    scope: scope === 'all' ? 'all' : 'profile',
    profiles,
    includedTables: included,
    media: includeMedia,
    tables,
  }
}

export function backupFileName(b: Backup, label: string): string {
  // The local (APP_TZ) day of the export: after 19:00 in Bogotá the UTC date is already tomorrow.
  const when = new Date(b.exportedAt)
  const d = Number.isFinite(when.getTime()) ? todayLocal(when) : b.exportedAt.slice(0, 10)
  const safe = label.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'perfil'
  return `salud-respaldo-${b.scope === 'all' ? 'todo' : safe}${b.media ? '' : '-sin-fotos'}-${d}.json`
}

export function backupStats(b: Backup): { table: PersonalTable; count: number }[] {
  return BACKUP_TABLES.map((t) => ({ table: t, count: b.tables[t]?.length ?? 0 })).filter((x) => x.count > 0)
}

/** Approximate size of a backup once serialised (bytes). */
export function backupSize(b: Backup): number {
  return new Blob([JSON.stringify(b)]).size
}

/**
 * Rewrites ids inside rows: exact id matches, `custom:<id>` / `recipe:<id>` food & exercise refs,
 * and `<profileId>|…` composite ids (favorites/recents, Health Connect rows).
 */
export function remapRows(rows: Row[], idMap: Map<string, string>, fromProfile: string, toProfile: string): Row[] {
  const fix = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const direct = idMap.get(v)
      if (direct) return direct
      const m = /^(custom|recipe):(.+)$/.exec(v)
      if (m && idMap.has(m[2]!)) return `${m[1]}:${idMap.get(m[2]!)}`
      if (v.startsWith(fromProfile + '|')) return toProfile + '|' + (fix(v.slice(fromProfile.length + 1)) as string)
      return v
    }
    if (Array.isArray(v)) return v.map(fix)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]))
    return v
  }
  return rows.map((r) => ({ ...(fix(r) as Row), profileId: toProfile }))
}

export interface ImportPlan {
  mode: 'replace' | 'merge'
  /** Backup profile id → target profile id (existing) or 'new'. Missing = skip. */
  mapping: Record<string, string | 'new'>
}

export interface TableImportCounts {
  inserted: number
  updated: number
  skipped: number
  /** Records whose local version is MORE RECENT than the backup's: the local version is kept. */
  conflicts: number
  /** Existing rows removed before a replace. */
  removed: number
}

export interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  conflicts: number
  removed: number
  profilesCreated: number
  byTable: Partial<Record<PersonalTable, TableImportCounts>>
}

const emptyCounts = (): TableImportCounts => ({ inserted: 0, updated: 0, skipped: 0, conflicts: 0, removed: 0 })

async function runImport(b: Backup, plan: ImportPlan, database: SaludDB, dry: boolean): Promise<ImportResult> {
  const res: ImportResult = { inserted: 0, updated: 0, skipped: 0, conflicts: 0, removed: 0, profilesCreated: 0, byTable: {} }
  const now = new Date().toISOString()
  const included = (b.includedTables ?? (Object.keys(b.tables) as PersonalTable[])).filter((t) => !isDeviceTable(t))
  const touched = [...new Set(included)]
  const count = (t: PersonalTable, k: keyof TableImportCounts, n = 1) => {
    const c = (res.byTable[t] ??= emptyCounts())
    c[k] += n
    res[k] += n
  }

  // Resolve target profile ids up front (random ids cannot be generated inside the transaction twice).
  const targets = new Map<string, { id: string; isNew: boolean }>()
  const usedTargets = new Set<string>()
  for (const src of b.profiles) {
    const target = plan.mapping[src.id]
    if (!target) continue
    if (target === 'new') {
      const exists = await database.profiles.get(src.id)
      targets.set(src.id, { id: exists ? crypto.randomUUID() : src.id, isNew: true })
    } else {
      if (usedTargets.has(target)) throw new Error('Cada perfil del respaldo debe tener un destino diferente.')
      usedTargets.add(target)
      targets.set(src.id, { id: target, isNew: false })
    }
  }

  await database.transaction(dry ? 'r' : 'rw', [database.profiles, ...touched.map((t) => database.table(t))], async () => {
    for (const src of b.profiles) {
      const tgt = targets.get(src.id)
      if (!tgt) continue
      const targetId = tgt.id
      if (tgt.isNew) {
        if (!dry) await database.profiles.add({ ...src, id: targetId, createdAt: src.createdAt ?? now, updatedAt: now })
        res.profilesCreated++
      } else {
        const current = await database.profiles.get(targetId)
        if (!current) throw new Error('Perfil de destino no encontrado')
        // The profile row itself (name, sex, birth date, height, settings) is restored only onto the SAME
        // profile: always in replace mode, and in merge mode only from a strictly newer backup. Importing
        // another profile's backup into this one brings its records but never renames it or changes its
        // identity or settings. Timestamps are kept so repeated imports are idempotent.
        if (!dry && targetId === src.id && (plan.mode === 'replace' || (src.updatedAt ?? '') > (current.updatedAt ?? ''))) {
          await database.profiles.put({ ...src, id: targetId, createdAt: src.createdAt ?? now, updatedAt: src.updatedAt ?? now })
        }
      }
      const sameProfile = targetId === src.id

      if (plan.mode === 'replace' && !tgt.isNew) {
        for (const t of touched) {
          const n = await database.table(t).where('profileId').equals(targetId).count()
          if (n) count(t, 'removed', n)
          if (!dry) await database.table(t).where('profileId').equals(targetId).delete()
        }
      }

      // Ids of other profiles must never be touched: remap when importing into a different profile.
      const idMap = new Map<string, string>()
      // Composite ids (`<profileId>|…`) are rewritten by remapRows instead.
      if (!sameProfile)
        for (const t of touched)
          for (const r of b.tables[t] ?? []) if (r.profileId === src.id && !r.id.startsWith(src.id + '|')) idMap.set(r.id, stableId(`${targetId}:${r.id}`))

      for (const t of touched) {
        let rows = (b.tables[t] ?? []).filter((r) => r.profileId === src.id)
        if (!rows.length) continue
        if (!sameProfile) rows = remapRows(rows, idMap, src.id, targetId)
        const tbl = database.table(t)
        if (plan.mode === 'replace' && !tgt.isNew) {
          // Rows of OTHER profiles that happen to share an id are never overwritten.
          const existing = (await tbl.bulkGet(rows.map((r) => r.id))) as (Row | undefined)[]
          const toPut = rows.filter((_, i) => !existing[i] || existing[i]!.profileId === targetId)
          count(t, 'inserted', toPut.length)
          if (rows.length - toPut.length) count(t, 'skipped', rows.length - toPut.length)
          if (!dry && toPut.length) await tbl.bulkPut(toPut)
          continue
        }
        const existing = (await tbl.bulkGet(rows.map((r) => r.id))) as (Row | undefined)[]
        const toPut: Row[] = []
        rows.forEach((r, i) => {
          const cur = existing[i]
          if (!cur) {
            toPut.push(r)
            count(t, 'inserted')
          } else if (cur.profileId !== targetId) {
            count(t, 'skipped') // belongs to someone else: never overwrite
          } else if ((r.updatedAt ?? '') > (cur.updatedAt ?? '')) {
            toPut.push(r)
            count(t, 'updated')
          } else {
            count(t, 'skipped')
            if ((r.updatedAt ?? '') < (cur.updatedAt ?? '')) count(t, 'conflicts')
          }
        })
        if (!dry && toPut.length) await tbl.bulkPut(toPut)
      }
    }
  })
  return res
}

/** Applies a backup in one transaction. */
export async function importBackup(b: Backup, plan: ImportPlan, database: SaludDB = defaultDb): Promise<ImportResult> {
  return runImport(b, plan, database, false)
}

/** What `importBackup` would do with the same arguments — nothing is written. */
export async function previewImport(b: Backup, plan: ImportPlan, database: SaludDB = defaultDb): Promise<ImportResult> {
  return runImport(b, plan, database, true)
}

export const SCHEMA = SCHEMA_VERSION
