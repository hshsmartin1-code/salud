/**
 * Control center model: combines the person's own records with imported data under explicit,
 * conservative rules. Pure functions (tested); the page only renders the result.
 *
 * Source rules (no double counting):
 * - Steps / active kcal / distance of a day: the Health Connect daily aggregate (already de-duplicated
 *   across apps by Health Connect) when present and not excluded; otherwise the sum of hand-entered
 *   activity logs. Never both added together.
 * - Sleep of a night: a hand-entered sleep log wins (explicit correction); otherwise Health Connect.
 * - Weight of a day: a hand-entered measurement wins; otherwise a Health Connect weigh-in.
 * - Active kcal are informational: never treated as total expenditure.
 */
import type { ActivityLog, BodyMeasurement, HealthRecord, SleepLog } from '../../db/types'
import { addDays, dateRange } from '../../domain/dates'

export type Source = 'manual' | 'health-connect' | 'phase0'

export interface DayValue {
  date: string
  value: number | null
  source: Source | null
}

const usable = (h: HealthRecord) => h.provider === 'health-connect' && !h.excluded && h.value !== null

function hcDaily(health: HealthRecord[], metric: HealthRecord['metric']): Map<string, number> {
  const m = new Map<string, number>()
  for (const h of health) if (usable(h) && h.kind === 'daily' && h.metric === metric) m.set(h.date, h.value as number)
  return m
}

function manualSum(acts: ActivityLog[], key: 'steps' | 'activeKcal' | 'distanceKm'): Map<string, { v: number; phase0: boolean }> {
  const m = new Map<string, { v: number; phase0: boolean }>()
  for (const a of acts) {
    const v = a[key]
    if (a.excludeFromStats || v === null || v === undefined) continue
    const cur = m.get(a.date)
    m.set(a.date, { v: (cur?.v ?? 0) + v, phase0: (cur?.phase0 ?? true) && a.origin === 'phase0' })
  }
  return m
}

function combineDaily(dates: string[], hc: Map<string, number>, manual: Map<string, { v: number; phase0: boolean }>, scale = 1): DayValue[] {
  return dates.map((date) => {
    if (hc.has(date)) return { date, value: hc.get(date)!, source: 'health-connect' as const }
    const m = manual.get(date)
    if (m) return { date, value: m.v * scale, source: m.phase0 ? ('phase0' as const) : ('manual' as const) }
    return { date, value: null, source: null }
  })
}

export function stepsByDay(acts: ActivityLog[], health: HealthRecord[], dates: string[]): DayValue[] {
  return combineDaily(dates, hcDaily(health, 'steps'), manualSum(acts, 'steps'))
}

export function activeKcalByDay(acts: ActivityLog[], health: HealthRecord[], dates: string[]): DayValue[] {
  return combineDaily(dates, hcDaily(health, 'activeKcal'), manualSum(acts, 'activeKcal'))
}

/** Hours of sleep per wake-up date. */
export function sleepByDay(sleep: SleepLog[], health: HealthRecord[], dates: string[]): DayValue[] {
  const manual = new Map<string, { v: number; phase0: boolean }>()
  for (const s of sleep) {
    if (s.excludeFromStats || s.hours === null) continue
    const cur = manual.get(s.date)
    manual.set(s.date, { v: (cur?.v ?? 0) + s.hours, phase0: s.origin === 'phase0' })
  }
  const hc = new Map<string, number>()
  // Health Connect sleep comes as sessions (value = minutes asleep, date = wake-up date); naps add up.
  for (const h of health) if (usable(h) && h.metric === 'sleep') hc.set(h.date, (hc.get(h.date) ?? 0) + (h.value as number) / 60)
  return dates.map((date) => {
    const m = manual.get(date)
    if (m) return { date, value: m.v, source: m.phase0 ? ('phase0' as const) : ('manual' as const) }
    if (hc.has(date)) return { date, value: hc.get(date)!, source: 'health-connect' as const }
    return { date, value: null, source: null }
  })
}

/**
 * Order of body measurements in time: date, then time of day (a row without time is the earliest of its day),
 * then creation instant, then id. "The latest of the day" is the LAST row in this order, everywhere: the same
 * minute (two weigh-ins in a row) is decided by which one was entered last, never by storage order.
 */
export function byMoment(a: Pick<BodyMeasurement, 'date' | 'time' | 'createdAt' | 'id'>, b: Pick<BodyMeasurement, 'date' | 'time' | 'createdAt' | 'id'>): number {
  return a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** One weight per day (latest of the day, see `byMoment`); hand-entered first, Health Connect as fallback. */
export function weightByDay(body: BodyMeasurement[], health: HealthRecord[]): DayValue[] {
  const out = new Map<string, DayValue>()
  const hcRows = health.filter((h) => usable(h) && h.kind === 'record' && h.metric === 'weight').sort((a, b) => (a.start ?? a.date).localeCompare(b.start ?? b.date))
  for (const h of hcRows) out.set(h.date, { date: h.date, value: h.value as number, source: 'health-connect' })
  const manual = body.filter((m) => m.weightKg !== null && !m.excludeFromStats && !m.approx).sort(byMoment)
  for (const m of manual) out.set(m.date, { date: m.date, value: m.weightKg as number, source: m.origin === 'phase0' ? 'phase0' : 'manual' })
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Exponentially smoothed trend weight (α = 0.1 per day, gaps decay by elapsed days), the usual way
 * to see the direction of body weight through daily water/food noise. Returns one point per input day.
 */
export function trendWeight(points: DayValue[], alpha = 0.1): DayValue[] {
  let prev: { date: string; v: number } | null = null
  return points
    .filter((p) => p.value !== null)
    .map((p) => {
      const v = p.value as number
      if (!prev) {
        prev = { date: p.date, v }
        return { ...p, value: v }
      }
      const days = Math.max(1, Math.round((Date.parse(p.date) - Date.parse(prev.date)) / 86_400_000))
      const a = 1 - Math.pow(1 - alpha, days)
      const t: number = prev.v + a * (v - prev.v)
      prev = { date: p.date, v: t }
      return { ...p, value: t }
    })
}

/** Evenly spaced series for `dates` (null where no value). */
export function seriesFor(dates: string[], values: DayValue[]): (number | null)[] {
  const m = new Map(values.map((v) => [v.date, v.value]))
  return dates.map((d) => m.get(d) ?? null)
}

export interface PeriodStat {
  mean: number | null
  /** Days that have a value. */
  days: number
  total: number
}

export function periodStat(values: (number | null)[]): PeriodStat {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return { mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, days: xs.length, total: values.length }
}

export interface Comparison {
  current: PeriodStat
  previous: PeriodStat
  /** current.mean − previous.mean, only when both periods have enough coverage. */
  delta: number | null
}

/** Compares two periods; the delta is withheld when either period covers fewer than `minDays` days. */
export function compare(current: (number | null)[], previous: (number | null)[], minDays = 3): Comparison {
  const c = periodStat(current)
  const p = periodStat(previous)
  const delta = c.mean !== null && p.mean !== null && c.days >= minDays && p.days >= minDays ? c.mean - p.mean : null
  return { current: c, previous: p, delta }
}

/** The two comparison windows: the last 7 complete days (ending yesterday) and the 7 before. */
export function weekWindows(today: string): { current: string[]; previous: string[] } {
  const end = addDays(today, -1)
  return { current: dateRange(addDays(end, -6), end), previous: dateRange(addDays(end, -13), addDays(end, -7)) }
}

export const SOURCE_LABEL: Record<Source, string> = {
  manual: 'Registro propio',
  'health-connect': 'Health Connect',
  phase0: 'Historial importado',
}

/** Label for a set of sources actually used in a series. */
export function sourcesLabel(values: DayValue[]): string {
  const s = [...new Set(values.map((v) => v.source).filter((x): x is Source => !!x))]
  return s.length ? s.map((x) => SOURCE_LABEL[x]).join(' + ') : 'Sin datos'
}

export type AlertTone = 'info' | 'warn' | 'bad'
export interface DashboardAlert {
  key: string
  tone: AlertTone
  text: string
  to: string
}

export interface AlertInput {
  today: string
  lastExport: string | null
  personalRows: number
  hc: { status: 'connected' | 'disconnected'; lastSyncAt: string | null; lastError: string | null } | null
  adaptiveOn: boolean
  lastWeightDate: string | null
  autoAdjustment: { date: string; fromKcal: number; toKcal: number } | null
  now?: Date
}

/** Actionable notices, most important first. Each one links to where it can be resolved. */
export function buildAlerts(i: AlertInput): DashboardAlert[] {
  const out: DashboardAlert[] = []
  const now = i.now ?? new Date()
  const daysSince = (iso: string) => (now.getTime() - Date.parse(iso)) / 86_400_000
  if (i.hc?.status === 'connected' && i.hc.lastError) out.push({ key: 'hc-error', tone: 'bad', text: `La última sincronización con Health Connect falló: ${i.hc.lastError}`, to: '/integraciones' })
  else if (i.hc?.status === 'connected' && (!i.hc.lastSyncAt || daysSince(i.hc.lastSyncAt) > 2))
    out.push({ key: 'hc-stale', tone: 'info', text: 'Health Connect lleva más de 2 días sin sincronizar.', to: '/integraciones' })
  if (i.personalRows >= 20 && (!i.lastExport || daysSince(i.lastExport) > 14))
    out.push({ key: 'backup', tone: 'warn', text: i.lastExport ? `Tu último respaldo tiene ${Math.floor(daysSince(i.lastExport))} días.` : 'Aún no tienes un respaldo.', to: '/respaldo' })
  if (i.autoAdjustment)
    out.push({ key: 'adaptive', tone: 'info', text: `Meta ajustada: ${Math.round(i.autoAdjustment.fromKcal)} → ${Math.round(i.autoAdjustment.toKcal)} kcal (estimación).`, to: '/perfil' })
  if (i.adaptiveOn && (!i.lastWeightDate || Date.parse(i.today) - Date.parse(i.lastWeightDate) > 7 * 86_400_000))
    out.push({ key: 'weigh', tone: 'info', text: 'La adaptación necesita pesos recientes.', to: '/cuerpo/nueva?tipo=peso' })
  return out
}
