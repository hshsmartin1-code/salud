/**
 * Versioned JSON backups. Export one profile or everything; import with replace or merge.
 * A profile export can be imported into a different profile: ids are remapped so rows never
 * collide with (or overwrite) another profile's data.
 */
import { z } from 'zod'
import { db as defaultDb, SCHEMA_VERSION, type SaludDB } from './schema'
import { PERSONAL_TABLES, type PersonalTable } from './tables'
import type { Profile } from './types'

export const BACKUP_FORMAT = 'pho-backup'
export const BACKUP_VERSION = 1
export const APP_VERSION = '1.0.0'

type Row = Record<string, unknown> & { id: string; profileId: string; updatedAt?: string }

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  appVersion: string
  exportedAt: string
  scope: 'profile' | 'all'
  profiles: Profile[]
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
  tables: z.record(z.string(), z.array(rowSchema)),
})

/** Upgrade older backup versions step by step. v1 is current. */
const MIGRATIONS: Record<number, (b: Backup) => Backup> = {}

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
  for (const t of Object.keys(b.tables)) if (!(PERSONAL_TABLES as readonly string[]).includes(t)) delete (b.tables as Record<string, unknown>)[t]
  const ids = new Set(b.profiles.map((p) => p.id))
  for (const [t, rows] of Object.entries(b.tables)) {
    const bad = rows!.filter((r) => !ids.has(r.profileId)).length
    if (bad) throw new Error(`La tabla ${t} tiene ${bad} filas de un perfil que no está en el respaldo.`)
  }
  return migrateBackup(b)
}

export async function exportBackup(scope: { profileId: string } | 'all', database: SaludDB = defaultDb): Promise<Backup> {
  const profiles = scope === 'all' ? await database.profiles.toArray() : [await database.profiles.get(scope.profileId)].filter((p): p is Profile => !!p)
  if (!profiles.length) throw new Error('Perfil no encontrado')
  const tables: Backup['tables'] = {}
  await database.transaction('r', [database.profiles, ...PERSONAL_TABLES.map((t) => database.table(t))], async () => {
    for (const t of PERSONAL_TABLES) {
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
    tables,
  }
}

export function backupFileName(b: Backup, label: string): string {
  const d = b.exportedAt.slice(0, 10)
  const safe = label.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'perfil'
  return `salud-respaldo-${b.scope === 'all' ? 'todo' : safe}-${d}.json`
}

export function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function backupStats(b: Backup): { table: PersonalTable; count: number }[] {
  return PERSONAL_TABLES.map((t) => ({ table: t, count: b.tables[t]?.length ?? 0 })).filter((x) => x.count > 0)
}

/**
 * Rewrites ids inside rows: exact id matches, `custom:<id>` / `recipe:<id>` food & exercise refs,
 * and `<profileId>|…` composite ids (favorites/recents).
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

export interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  profilesCreated: number
}

/** Applies a backup in one transaction. */
export async function importBackup(b: Backup, plan: ImportPlan, database: SaludDB = defaultDb): Promise<ImportResult> {
  const res: ImportResult = { inserted: 0, updated: 0, skipped: 0, profilesCreated: 0 }
  const now = new Date().toISOString()
  await database.transaction('rw', [database.profiles, ...PERSONAL_TABLES.map((t) => database.table(t))], async () => {
    for (const src of b.profiles) {
      const target = plan.mapping[src.id]
      if (!target) continue
      let targetId: string
      if (target === 'new') {
        const exists = await database.profiles.get(src.id)
        targetId = exists ? crypto.randomUUID() : src.id
        await database.profiles.add({ ...src, id: targetId, createdAt: src.createdAt ?? now, updatedAt: now })
        res.profilesCreated++
      } else {
        targetId = target
        if (!(await database.profiles.get(targetId))) throw new Error('Perfil de destino no encontrado')
      }
      const sameProfile = targetId === src.id

      if (plan.mode === 'replace' && target !== 'new') {
        for (const t of PERSONAL_TABLES) await database.table(t).where('profileId').equals(targetId).delete()
      }

      // Ids of other profiles must never be touched: remap when importing into a different profile.
      const idMap = new Map<string, string>()
      // Composite ids (`<profileId>|<foodRef>`) are rewritten by remapRows instead.
      if (!sameProfile)
        for (const t of PERSONAL_TABLES)
          for (const r of b.tables[t] ?? []) if (r.profileId === src.id && !r.id.startsWith(src.id + '|')) idMap.set(r.id, crypto.randomUUID())

      for (const t of PERSONAL_TABLES) {
        let rows = (b.tables[t] ?? []).filter((r) => r.profileId === src.id)
        if (!rows.length) continue
        if (!sameProfile) rows = remapRows(rows, idMap, src.id, targetId)
        const tbl = database.table(t)
        if (plan.mode === 'replace') {
          await tbl.bulkPut(rows)
          res.inserted += rows.length
          continue
        }
        const existing = (await tbl.bulkGet(rows.map((r) => r.id))) as (Row | undefined)[]
        const toPut: Row[] = []
        rows.forEach((r, i) => {
          const cur = existing[i]
          if (!cur) {
            toPut.push(r)
            res.inserted++
          } else if (cur.profileId !== targetId) {
            res.skipped++ // belongs to someone else: never overwrite
          } else if ((r.updatedAt ?? '') > (cur.updatedAt ?? '')) {
            toPut.push(r)
            res.updated++
          } else res.skipped++
        })
        if (toPut.length) await tbl.bulkPut(toPut)
      }
    }
  })
  return res
}

export const SCHEMA = SCHEMA_VERSION
