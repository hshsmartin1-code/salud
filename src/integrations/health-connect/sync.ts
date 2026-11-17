import { repo, type Repo } from '../../db/repo'
import type { SaludDB } from '../../db/schema'
import type { HealthMetric, IntegrationState, SyncLogEntry } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { activeCategories, dailyMetricsFor, rawTypesFor } from './categories'
import { dailyToRows, rawToRows } from './mapper'
import { deleteByExternalIds, pruneDaily, upsertHealthRows } from './merge'
import { planSync, type SyncPlan } from './plan'
import { getLinkedProfileId, loadState, saveState } from './state'
import type { HcRawType, HealthConnectPlugin } from './types'

export interface SyncDeps {
  plugin: HealthConnectPlugin
  db: SaludDB
  /** Injectable clock (tests). */
  now?: () => Date
}

export interface SyncCounts {
  daily: number
  records: number
  deleted: number
}

export interface SyncResult {
  ok: boolean
  plan: SyncPlan
  counts: SyncCounts
  errors: string[]
}

const LOG_MAX = 20
const PAGE_GUARD = 500

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Error desconocido')

/**
 * Manual + incremental sync (no background work).
 *  - Daily totals: Health Connect aggregates (already de-duplicated between apps), recomputed for the last 7 days
 *    (the whole 30-day window the first time). Active kcal comes ONLY from here.
 *  - Raw records (sessions, weight…): Changes API with one token per type. The token is stored only after the rows
 *    are written. No token or an expired one → re-read from max(lastSync − 1 day, today − 30 days), de-duplicated by id.
 */
export async function runSync(deps: SyncDeps, profileId: string): Promise<SyncResult> {
  const { plugin, db } = deps
  const r = repo(profileId, db)
  if ((await getLinkedProfileId(db)) !== profileId) throw new Error('Health Connect no está vinculado a este perfil.')
  let state = await loadState(r)
  if (!state || state.status !== 'connected') throw new Error('La integración no está conectada.')

  const status = await plugin.getStatus()
  if (!status.available) throw new Error('Health Connect no está disponible en este dispositivo.')
  const { granted } = await plugin.getGrantedPermissions()
  const active = activeCategories(state.categories, granted)

  const now = deps.now?.() ?? new Date()
  const nowIsoStr = now.toISOString()
  const today = todayLocal(now)
  const plan = planSync(today, state.lastSyncTo)
  const counts: SyncCounts = { daily: 0, records: 0, deleted: 0 }
  const errors: string[] = []
  const revoked = Object.entries(state.categories).some(([category, enabled]) => enabled && !active.some((c) => c === category))
  if (revoked) errors.push('Se revocaron permisos de Health Connect. Revisa las categorías antes de sincronizar.')

  const saveToken = async (type: HcRawType, token: string) => {
    const tokens = { ...state!.changesTokens, [type]: token }
    await r.update('integrations', state!.id, { changesTokens: tokens })
    state = { ...state!, changesTokens: tokens }
  }

  // 1) daily aggregates
  const metrics = dailyMetricsFor(active)
  if (metrics.length) {
    try {
      const { days, skipped } = await plugin.readDailyAggregates({ from: plan.dailyFrom, to: today, metrics })
      const okMetrics = metrics.filter((m) => !skipped.includes(m))
      const rows = dailyToRows(profileId, days, okMetrics, nowIsoStr)
      await upsertHealthRows(r, rows)
      await pruneDaily(r, plan.dailyFrom, today, okMetrics as HealthMetric[], new Set(rows.map((x) => x.id)))
      counts.daily += rows.length
      if (skipped.length) errors.push(`Sin permiso para: ${skipped.join(', ')}`)
    } catch (e) {
      errors.push(`Totales diarios: ${errMsg(e)}`)
    }
  }

  // 2) raw records
  for (const type of rawTypesFor(active)) {
    try {
      await syncRawType(type)
    } catch (e) {
      errors.push(`${type}: ${errMsg(e)}`)
    }
  }

  async function fullRead(type: HcRawType) {
    // token first, so nothing that changes during the read is missed
    const { token } = await plugin.getChangesToken({ type })
    let pageToken: string | undefined
    for (let i = 0; i < PAGE_GUARD; i++) {
      const page = await plugin.readRecords({ type, from: plan.rawFrom, to: today, pageToken })
      const m = await upsertHealthRows(r, rawToRows(profileId, page.records, nowIsoStr))
      counts.records += m.added + m.updated
      pageToken = page.pageToken || undefined
      if (!pageToken) {
        await saveToken(type, token)
        return
      }
    }
    throw new Error('Se alcanzó el límite de páginas; la lectura se reintentará sin omitir registros.')
  }

  async function syncRawType(type: HcRawType) {
    const token = state!.changesTokens[type]
    if (!token) return fullRead(type)
    let t = token
    for (let i = 0; i < PAGE_GUARD; i++) {
      const ch = await plugin.getChanges({ token: t })
      if (ch.expired) return fullRead(type)
      const m = await upsertHealthRows(r, rawToRows(profileId, ch.upserts, nowIsoStr))
      counts.records += m.added + m.updated
      t = ch.nextToken
      // delete first, then persist the token: if we crash in between, the next run just repeats this page
      if (ch.deletedIds.length) counts.deleted += await deleteByExternalIds(r, ch.deletedIds)
      await saveToken(type, t)
      if (!ch.hasMore) return
    }
    throw new Error('Quedan páginas de cambios; vuelve a sincronizar para continuar.')
  }

  const ok = errors.length === 0
  const entry: SyncLogEntry = {
    at: nowIsoStr,
    ok,
    message: ok ? (plan.kind === 'first' ? 'Primera sincronización' : 'Sincronización') : errors.join(' · '),
    counts: { diarios: counts.daily, registros: counts.records, borrados: counts.deleted },
  }
  const fresh = (await loadState(r)) ?? (state as IntegrationState)
  await saveState(r, {
    ...fresh,
    grantedPermissions: granted,
    lastSyncAt: nowIsoStr,
    // the sync range only advances when nothing failed, so a failed type is retried over the same window
    lastSyncFrom: ok ? plan.dailyFrom : fresh.lastSyncFrom,
    lastSyncTo: ok ? today : fresh.lastSyncTo,
    lastError: ok ? null : errors.join(' · '),
    log: [entry, ...fresh.log].slice(0, LOG_MAX),
  })
  return { ok, plan, counts, errors }
}

export type { Repo }
