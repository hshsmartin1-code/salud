import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importBackup, parseBackup } from '../../db/backup'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { dateRange } from '../../domain/dates'
import { seriesFor, sleepByDay, stepsByDay, trendWeight, weightByDay } from '../dashboard/controlCenter'
import { buildDemoBackup } from '../../test/seed/demoSeed'
import { loadHealthInput, metricsWithData } from './loadHealth'
import { METRIC_IDS } from './metrics'
import { buildSeries, describe as describeMetric, periodRange, previousRange, sleepConsistency, splitByMethod, summarize, weightHistory } from './series'

const TODAY = '2026-11-15'
let db: SaludDB
let r: Repo
let n = 0
beforeEach(async () => {
  db = createDB(`health-load-${n++}`)
  await db.open()
  const backup = parseBackup(JSON.stringify(buildDemoBackup(TODAY)))
  await importBackup(backup, { mode: 'replace', mapping: { [backup.profiles[0]!.id]: 'new' } }, db)
  const profile = (await db.profiles.toArray())[0]!
  r = repo(profile.id, db)
})
afterEach(async () => {
  await db.delete()
})

describe('loadHealthInput + metricsWithData on the demo seed', () => {
  it('loads the window, the profile and the habits', async () => {
    const range = periodRange(TODAY, 30)
    const input = await loadHealthInput(r, range.from, range.to, 0)
    expect(input.profile?.heightCm).toBeGreaterThan(100)
    expect(input.profile?.settings.stepGoal).toBe(8000)
    expect(input.habits).toHaveLength(4)
    for (const rows of [input.body, input.activity, input.sleep, input.vitals, input.hydration, input.habitLogs]) {
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect((row as { date: string }).date >= range.from && (row as { date: string }).date <= range.to).toBe(true)
    }
    expect(input.health).toEqual([]) // the demo has no Health Connect rows
  })

  it('reports which metrics have data and which have none, covering every metric once', async () => {
    const range = periodRange(TODAY, 90)
    const input = await loadHealthInput(r, range.from, range.to)
    const { withData, withoutData } = metricsWithData(input, range.from, range.to)
    expect([...withData, ...withoutData].sort()).toEqual([...METRIC_IDS].sort())
    for (const m of ['weight', 'waist', 'bodyFat', 'steps', 'activeMinutes', 'sleep', 'bedtime', 'wakeTime', 'water', 'restingHr', 'bloodPressure', 'glucose', 'habits', 'energyScale', 'moodScale', 'ffmi'] as const)
      expect(withData, m).toContain(m)
    expect(withoutData).not.toContain('weight')
  })

  it('a short window without data lists the metrics as empty', async () => {
    const input = await loadHealthInput(r, '2025-01-01', '2025-01-07')
    const { withData, withoutData } = metricsWithData(input, '2025-01-01', '2025-01-07')
    expect(withData).toEqual([])
    expect(withoutData).toHaveLength(METRIC_IDS.length)
  })

  it('numbers equal the dashboard helpers on the same rows', async () => {
    const range = periodRange(TODAY, 90)
    const input = await loadHealthInput(r, range.from, range.to)
    const dates = dateRange(range.from, range.to)
    const v = (m: Parameters<typeof buildSeries>[0]) => buildSeries(m, input, range.from, range.to).map((p) => p.value)
    expect(v('weight')).toEqual(seriesFor(dates, weightByDay(input.body, input.health)))
    expect(v('steps')).toEqual(seriesFor(dates, stepsByDay(input.activity, input.health, dates)))
    expect(v('sleep')).toEqual(seriesFor(dates, sleepByDay(input.sleep, input.health, dates)))
  })

  it('summary, description, estimates and sleep consistency on the seed', async () => {
    const cur = periodRange(TODAY, 30)
    const prev = previousRange(cur)
    const input = await loadHealthInput(r, prev.from, cur.to)
    const now = buildSeries('steps', input, cur.from, cur.to)
    const before = buildSeries('steps', input, prev.from, prev.to)
    const s = summarize(now, before, { metricId: 'steps' })
    expect(s.coverage.total).toBe(30)
    expect(s.coverage.days).toBeGreaterThan(15)
    const text = describeMetric('steps', s, cur)
    expect(text).toMatch(/^Media de [\d.]+ pasos al día, (\d+ % (más|menos)|igual) que en los 30 días anteriores; \d+ de 30 días con dato\.$/)

    const fat = splitByMethod('bodyFat', input, prev.from, cur.to)
    expect(fat.length).toBe(1)
    expect(fat[0]!.points.filter((p) => p.value !== null)).toHaveLength(2) // skinfold sessions 45 and 5 days ago
    expect(fat[0]!.points.every((p) => p.value === null || (p.estimated === true && p.method === fat[0]!.method))).toBe(true)

    const c = sleepConsistency(input, cur.from, cur.to)
    expect(c).not.toBeNull()
    expect(c!.bedtimeSdMin).toBeGreaterThan(0)
    expect(c!.bedtimeSdMin!).toBeLessThan(120) // bedtimes run 22:00–00:30 across midnight
  })
})

describe('weight trend warm-up', () => {
  it('the trend value on a date is the same in the 7-day and 30-day views and equals trendWeight over the history', async () => {
    const wide = periodRange(TODAY, 30)
    const input = await loadHealthInput(r, wide.from, wide.to) // default warm-up: 60 days
    const history = weightHistory(input)
    expect(history[0]!.date < wide.from).toBe(true) // warm-up rows were loaded
    const trendOver = (range: { from: string; to: string }) => summarize(buildSeries('weight', input, range.from, range.to), null, { metricId: 'weight', history }).trend!.points
    const seven = trendOver(periodRange(TODAY, 7))
    const thirty = trendOver(wide)
    expect(seven.length).toBeGreaterThan(0)
    const t30 = new Map(thirty.map((p) => [p.date, p.value]))
    for (const p of seven) expect(t30.get(p.date)).toBe(p.value)
    const dash = new Map(trendWeight(weightByDay(input.body, input.health)).map((d) => [d.date, d.value]))
    for (const p of seven) expect(dash.get(p.date)).toBe(p.value)
    // Without history the trend restarts at the first visible day and differs.
    const cold = summarize(buildSeries('weight', input, periodRange(TODAY, 7).from, TODAY), null, { metricId: 'weight' }).trend!.points
    expect(cold[0]!.value).not.toBe(seven[0]!.value)
  })
  it('warmupDays 0 loads only the window', async () => {
    const w = periodRange(TODAY, 30)
    const input = await loadHealthInput(r, w.from, w.to, 0)
    expect(input.body.every((b) => b.date >= w.from)).toBe(true)
  })
})
