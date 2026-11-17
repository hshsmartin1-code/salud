import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importBackup, parseBackup } from '../../db/backup'
import { createDB, type SaludDB } from '../../db/schema'
import { addDays, dateRange } from '../../domain/dates'
import { buildDemoBackup, DEMO_PROFILE_NAME } from './demoSeed'

const TODAY = '2026-11-15'
let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`demo-seed-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const REQUIRED = [
  'goals', 'foodLogs', 'recents', 'favorites', 'recipes', 'mealTemplates', 'bodyMeasurements', 'activityLogs', 'sleepLogs',
  'recoveryLogs', 'vitals', 'hydrationLogs', 'habits', 'habitLogs', 'routines', 'trainingSessions', 'exerciseSets',
] as const

describe('buildDemoBackup', () => {
  it('is deterministic and does not depend on the clock', () => {
    expect(JSON.stringify(buildDemoBackup(TODAY))).toBe(JSON.stringify(buildDemoBackup(TODAY)))
    expect(JSON.stringify(buildDemoBackup('2026-12-01'))).not.toBe(JSON.stringify(buildDemoBackup(TODAY)))
  })

  it('passes the app parser and restores into an empty database', async () => {
    const backup = parseBackup(JSON.stringify(buildDemoBackup(TODAY)))
    expect(backup.profiles).toHaveLength(1)
    expect(backup.profiles[0]!.name).toBe(DEMO_PROFILE_NAME)
    const res = await importBackup(backup, { mode: 'replace', mapping: { [backup.profiles[0]!.id]: 'new' } }, db)
    expect(res.profilesCreated).toBe(1)
    expect(await db.profiles.count()).toBe(1)
    for (const t of REQUIRED) expect(await db.table(t).count(), t).toBeGreaterThan(0)
    const pid = backup.profiles[0]!.id
    expect(await db.table('habits').filter((h) => h.kind === 'supplement').count()).toBe(1)
    expect(await db.table('habits').count()).toBe(4)
    expect(await db.table('routines').count()).toBe(3)
    expect(await db.table('recipes').count()).toBe(2)
    expect(await db.table('mealTemplates').count()).toBe(2)
    // Every set belongs to an existing finished session of the same profile.
    const sessions = new Map((await db.trainingSessions.toArray()).map((s) => [s.id, s]))
    expect(sessions.size).toBeGreaterThanOrEqual(34)
    expect(sessions.size).toBeLessThanOrEqual(38)
    for (const s of await db.exerciseSets.toArray()) {
      const sess = sessions.get(s.sessionId)
      expect(sess, 'exerciseSet without session').toBeDefined()
      expect(sess!.date).toBe(s.date)
      expect(s.profileId).toBe(pid)
    }
    expect([...sessions.values()].every((s) => s.status === 'done')).toBe(true)
    expect((await db.exerciseSets.toArray()).some((s) => s.isWarmup)).toBe(true)
  })

  it('covers about 90 days, with gaps, all relative to today', () => {
    const b = buildDemoBackup(TODAY)
    const t = b.tables as Record<string, { date?: string }[]>
    const window = new Set(dateRange(addDays(TODAY, -89), TODAY))
    const foodDays = new Set(t.foodLogs!.map((r) => r.date!))
    for (const d of foodDays) expect(window.has(d)).toBe(true)
    expect(foodDays.size / 90).toBeGreaterThan(0.7)
    expect(foodDays.size / 90).toBeLessThan(0.92)
    expect(foodDays.has(TODAY)).toBe(true)
    for (const name of ['bodyMeasurements', 'activityLogs', 'sleepLogs', 'recoveryLogs', 'vitals', 'hydrationLogs', 'habitLogs', 'trainingSessions']) {
      const days = new Set(t[name]!.map((r) => r.date!))
      for (const d of days) expect(window.has(d), `${name} ${d}`).toBe(true)
      expect(days.size, name).toBeLessThan(90)
    }
    expect(t.bodyMeasurements!.filter((m) => (m as { skinfolds?: object }).skinfolds && Object.keys((m as { skinfolds: object }).skinfolds).length).length).toBe(3)
  })

  it('has partial foods, a time and a bodyweight exercise, and derived body fat from the app functions', () => {
    const b = buildDemoBackup(TODAY)
    const logs = b.tables.foodLogs as unknown as { missing: string[] }[]
    expect(logs.some((l) => l.missing.length > 0)).toBe(true)
    expect(logs.some((l) => l.missing.length === 0)).toBe(true)
    const routines = b.tables.routines as unknown as { exercises: { trackingType: string }[] }[]
    const kinds = new Set(routines.flatMap((r) => r.exercises.map((e) => e.trackingType)))
    expect(kinds).toEqual(new Set(['weight_reps', 'bodyweight_reps', 'time']))
    const withFat = (b.tables.bodyMeasurements as unknown as { derived: { bodyFatPct?: number } | null }[]).filter((m) => m.derived?.bodyFatPct !== undefined)
    expect(withFat).toHaveLength(3)
    const pcts = withFat.map((m) => m.derived!.bodyFatPct!)
    expect(pcts[0]!).toBeGreaterThan(pcts[2]!)
  })
})

describe('buildDemoBackup(today, now): nothing is later than now', () => {
  // Local times (UTC-5) on 2026-11-16 (a Monday): just after midnight, early morning, mid-afternoon, late evening.
  const MOMENTS = ['00:10', '06:30', '16:30', '23:50'] as const
  type Row = Record<string, unknown>

  for (const hhmm of MOMENTS) {
    it(`${hhmm}: every instant, time of day and counter of the last day is at or before now`, () => {
      const today = '2026-11-16'
      const nowMs = Date.parse(`${today}T${hhmm}:00-05:00`)
      const nowMin = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
      const b = buildDemoBackup(today, nowMs)
      const late: string[] = []
      for (const [table, rows] of Object.entries(b.tables as unknown as Record<string, Row[]>)) {
        for (const row of rows) {
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && Date.parse(v) > nowMs) late.push(`${table}.${k}=${v}`)
          }
          if (row.date === today && typeof row.time === 'string' && Number(row.time.slice(0, 2)) * 60 + Number(row.time.slice(3)) > nowMin) late.push(`${table}.time=${row.time}`)
          if (row.date === today && typeof row.waketime === 'string' && Number(row.waketime.slice(0, 2)) * 60 + Number(row.waketime.slice(3)) > nowMin) late.push(`${table}.waketime=${row.waketime}`)
        }
      }
      expect(Date.parse(b.exportedAt)).toBeLessThanOrEqual(nowMs)
      expect(late).toEqual([])
    })
  }

  it('leaves the days before today untouched and caps the day-long counters of today', () => {
    const today = '2026-11-16'
    const early = buildDemoBackup(today, `${today}T00:10:00-05:00`)
    const late = buildDemoBackup(today, `${today}T23:50:00-05:00`)
    const before = (b: ReturnType<typeof buildDemoBackup>, table: string) => (b.tables as unknown as Record<string, Row[]>)[table]!.filter((r) => (r.date as string) < today)
    for (const table of ['foodLogs', 'bodyMeasurements', 'sleepLogs', 'vitals', 'hydrationLogs', 'trainingSessions']) {
      expect(JSON.stringify(before(early, table))).toBe(JSON.stringify(before(late, table)))
    }
    const steps = (b: ReturnType<typeof buildDemoBackup>) => ((b.tables as unknown as Record<string, Row[]>).activityLogs!.find((r) => r.date === today)?.steps as number) ?? 0
    expect(steps(early)).toBeLessThan(steps(late))
    expect(steps(early)).toBeLessThan(200)
  })
})

describe('buildDemoBackup(today, now): the last day grows with the clock', () => {
  const today = '2026-11-16'
  const rowsOfToday = (hhmm: string, table: string) => {
    const b = buildDemoBackup(today, `${today}T${hhmm}:00-05:00`)
    return ((b.tables as unknown as Record<string, { date: string; meal?: string }[]>)[table] ?? []).filter((r) => r.date === today)
  }
  it('has no meal, weigh-in or water before the morning, and breakfast + lunch by mid-afternoon', () => {
    for (const t of ['foodLogs', 'bodyMeasurements', 'hydrationLogs']) expect(rowsOfToday('00:10', t)).toEqual([])
    const meals = new Set(rowsOfToday('16:30', 'foodLogs').map((r) => r.meal))
    expect([...meals].sort()).toEqual(['almuerzo', 'desayuno'])
    expect(rowsOfToday('09:00', 'foodLogs').every((r) => r.meal === 'desayuno')).toBe(true)
  })
})
