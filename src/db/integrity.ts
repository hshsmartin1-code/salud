/**
 * Local data integrity check. Finds rows that cannot be shown correctly (orphans, broken references,
 * invalid dates, duplicated imports). Reporting never changes anything; `repairIntegrity` only fixes
 * the issue codes the person confirmed, each in a safe, well-defined way.
 */
import { db as defaultDb, type SaludDB } from './schema'
import { DATED_TABLES, PERSONAL_TABLES, type PersonalTable } from './tables'
import { isCalendarDate } from '../domain/dates'

export type IssueCode = 'orphan_rows' | 'set_without_session' | 'invalid_date' | 'dangling_label_image' | 'orphan_label_image' | 'duplicate_health_record'

export interface IntegrityIssue {
  code: IssueCode
  table: PersonalTable
  count: number
  ids: string[]
  message: string
  /** What the repair does. */
  repair: string
}

export interface IntegrityReport {
  checkedAt: string
  rows: number
  issues: IntegrityIssue[]
}

export async function checkIntegrity(database: SaludDB = defaultDb): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = []
  let rows = 0
  await database.transaction('r', [database.profiles, ...PERSONAL_TABLES.map((t) => database.table(t))], async () => {
    const profileIds = new Set((await database.profiles.toArray()).map((p) => p.id))
    const all: Partial<Record<PersonalTable, Record<string, unknown>[]>> = {}
    for (const t of PERSONAL_TABLES) {
      all[t] = (await database.table(t).toArray()) as Record<string, unknown>[]
      rows += all[t]!.length
    }
    for (const t of PERSONAL_TABLES) {
      const orphans = all[t]!.filter((r) => !profileIds.has(r.profileId as string))
      if (orphans.length)
        issues.push({
          code: 'orphan_rows',
          table: t,
          count: orphans.length,
          ids: orphans.map((r) => r.id as string),
          message: `${orphans.length} registros pertenecen a un perfil que ya no existe.`,
          repair: 'Eliminar esos registros (no son visibles desde ningún perfil).',
        })
    }
    for (const t of DATED_TABLES) {
      const bad = all[t]!.filter((r) => !isCalendarDate(r.date))
      if (bad.length)
        issues.push({
          code: 'invalid_date',
          table: t,
          count: bad.length,
          ids: bad.map((r) => r.id as string),
          message: `${bad.length} registros no tienen una fecha válida y no aparecen en el diario ni en las gráficas.`,
          repair: 'Solo se informa: revisa el respaldo de origen (no se borra nada).',
        })
    }
    const sessions = new Set(all.trainingSessions!.map((s) => s.id as string))
    const loose = all.exerciseSets!.filter((s) => !sessions.has(s.sessionId as string))
    if (loose.length)
      issues.push({
        code: 'set_without_session',
        table: 'exerciseSets',
        count: loose.length,
        ids: loose.map((r) => r.id as string),
        message: `${loose.length} series no tienen una sesión de entreno asociada.`,
        repair: 'Eliminar esas series sueltas.',
      })
    const images = new Map(all.labelImages!.map((i) => [i.id as string, i]))
    const foods = new Map(all.customFoods!.map((f) => [f.id as string, f]))
    const dangling = all.customFoods!.filter((f) => typeof f.labelImageId === 'string' && !images.has(f.labelImageId))
    if (dangling.length)
      issues.push({
        code: 'dangling_label_image',
        table: 'customFoods',
        count: dangling.length,
        ids: dangling.map((r) => r.id as string),
        message: `${dangling.length} alimentos apuntan a una foto de etiqueta que no existe.`,
        repair: 'Quitar la referencia a la foto (el alimento se conserva).',
      })
    const orphanImgs = all.labelImages!.filter((i) => typeof i.foodId === 'string' && !foods.has(i.foodId))
    if (orphanImgs.length)
      issues.push({
        code: 'orphan_label_image',
        table: 'labelImages',
        count: orphanImgs.length,
        ids: orphanImgs.map((r) => r.id as string),
        message: `${orphanImgs.length} fotos de etiqueta pertenecen a alimentos eliminados.`,
        repair: 'Eliminar esas fotos.',
      })
    const seen = new Map<string, Record<string, unknown>>()
    const dups: string[] = []
    for (const r of all.healthRecords!) {
      const ext = r.externalId as string | null
      if (!ext) continue
      const key = `${r.profileId}|${ext}`
      const prev = seen.get(key)
      if (!prev) {
        seen.set(key, r)
        continue
      }
      // Keep the most recently modified copy.
      const keepPrev = String(prev.lastModified ?? prev.updatedAt ?? '') >= String(r.lastModified ?? r.updatedAt ?? '')
      dups.push(keepPrev ? (r.id as string) : (prev.id as string))
      if (!keepPrev) seen.set(key, r)
    }
    if (dups.length)
      issues.push({
        code: 'duplicate_health_record',
        table: 'healthRecords',
        count: dups.length,
        ids: dups,
        message: `${dups.length} registros importados de Health Connect están duplicados.`,
        repair: 'Eliminar las copias y conservar la versión más reciente.',
      })
  })
  return { checkedAt: new Date().toISOString(), rows, issues }
}

/** Repairs the given issues (as returned by checkIntegrity) in one transaction. Returns rows changed. */
export async function repairIntegrity(issues: IntegrityIssue[], database: SaludDB = defaultDb): Promise<number> {
  let changed = 0
  const tables = [...new Set(issues.map((i) => i.table))]
  if (!tables.length) return 0
  await database.transaction('rw', tables.map((t) => database.table(t)), async () => {
    for (const i of issues) {
      const tbl = database.table(i.table)
      switch (i.code) {
        case 'orphan_rows':
        case 'set_without_session':
        case 'orphan_label_image':
        case 'duplicate_health_record':
          await tbl.bulkDelete(i.ids)
          changed += i.ids.length
          break
        case 'dangling_label_image':
          for (const id of i.ids) changed += await tbl.update(id, { labelImageId: null })
          break
        case 'invalid_date':
          break // report only
      }
    }
  })
  return changed
}
