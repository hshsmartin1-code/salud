// "Estado muscular" on the Entreno home. Synthetic data only: the demo seed is restored through the app's
// own import flow. Expected values are computed here, independently of the app code, from the seed's
// sessions and the exercise catalog, using the documented rules (docs/V3_MUSCLE_RECOVERY.md).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { demoBackup, expect, nowDate, onboard, TZ, test } from './helpers'

interface SeedSession { id: string; name: string; date: string; status: string; endedAt: string | null; startedAt: string | null }
interface SeedSet { sessionId: string; exerciseId: string; isWarmup: boolean; done: boolean }
interface Backup { tables?: Record<string, unknown[]>; [k: string]: unknown }

/**
 * Test-side only: moves the latest session of `routine` so that it ended `hoursAgo` hours ago (dates of
 * the session and its sets follow), to show the "recent" and "in window" looks with the demo seed.
 */
function moveLatest(sessions: (SeedSession & { durationMin?: number | null })[], sets: (SeedSet & { date?: string })[], routine: string, hoursAgo: number): SeedSession {
  const s = sessions.filter((x) => x.name === routine).sort((a, b) => (a.date < b.date ? 1 : -1))[0]!
  const end = new Date(nowDate().getTime() - hoursAgo * 3_600_000)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(end)
  s.endedAt = end.toISOString()
  s.startedAt = new Date(end.getTime() - (s.durationMin ?? 60) * 60_000).toISOString()
  s.date = date
  for (const x of sets) if (x.sessionId === s.id) x.date = date
  return s
}

/**
 * Test-side only: removes every session (and its sets) that ended less than `hoursAgo` hours ago, except `keep`.
 * The state of a muscle is decided by the LATEST session that trained it, so a test about "the session 30 h ago"
 * must first make sure no other session of the seed (e.g. "Cuerpo completo" yesterday evening, which trains the
 * quadriceps too) ended after it: whether one does depends on the day of the week the suite runs.
 */
function dropRecentExcept(sessions: SeedSession[], sets: SeedSet[], hoursAgo: number, keep: SeedSession[]) {
  const limit = nowDate().getTime() - hoursAgo * 3_600_000
  const gone = new Set(sessions.filter((s) => !keep.includes(s) && Date.parse(s.endedAt ?? s.startedAt ?? `${s.date}T12:00:00`) > limit).map((s) => s.id))
  for (let i = sessions.length - 1; i >= 0; i--) if (gone.has(sessions[i]!.id)) sessions.splice(i, 1)
  for (let i = sets.length - 1; i >= 0; i--) if (gone.has(sets[i]!.sessionId)) sets.splice(i, 1)
}

async function demo(move?: (sessions: SeedSession[], sets: SeedSet[]) => void): Promise<{ json: string; sessions: SeedSession[]; sets: SeedSet[] }> {
  const backup = await demoBackup<Backup>()
  const find = (name: string): unknown[] => {
    const stack: unknown[] = [backup]
    while (stack.length) {
      const v = stack.pop()
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (Array.isArray(o[name])) return o[name] as unknown[]
        stack.push(...Object.values(o))
      }
    }
    return []
  }
  const sessions = find('trainingSessions') as SeedSession[]
  const sets = find('exerciseSets') as SeedSet[]
  move?.(sessions, sets)
  return { json: JSON.stringify(backup), sessions, sets }
}

const catalog = new Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>(
  (JSON.parse(readFileSync(join(process.cwd(), 'public/data/exercises.json'), 'utf8')).exercises as { id: string; primaryMuscles: string[]; secondaryMuscles: string[] }[]).map((e) => [e.id, e]),
)

/** Independent re-implementation of the documented rule for one muscle. */
function expected(muscle: string, sessions: SeedSession[], sets: SeedSet[], now: number) {
  const loads = sessions
    .filter((s) => s.status === 'done')
    .map((s) => {
      let n = 0
      for (const x of sets) {
        if (x.sessionId !== s.id || x.isWarmup || !x.done) continue
        const e = catalog.get(x.exerciseId)
        if (!e) continue
        if (e.primaryMuscles.includes(muscle)) n += 1
        else if (e.secondaryMuscles.includes(muscle)) n += 0.5
      }
      return { s, n, at: Date.parse(s.endedAt ?? s.startedAt ?? `${s.date}T12:00:00`) }
    })
    .filter((l) => l.at <= now)
    .sort((a, b) => b.at - a.at)
  const last = loads.find((l) => l.n >= 1)!
  const hours = (now - last.at) / 3_600_000
  const window = last.n >= 8 ? 72 : 48
  const state = hours < 24 ? 'recent' : hours < window ? 'recovering' : hours <= 168 ? 'ready' : 'rested'
  const week = loads.filter((l) => l.at > now - 7 * 24 * 3_600_000).reduce((a, l) => a + l.n, 0)
  return { last, hours, window, state, week }
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

/** The browser's own clock (the suite's fake clock, or the real one): what the app calls "now". */
const appNow = (page: Page): Promise<number> => page.evaluate(() => Date.now())

async function restore(page: Page, json: string) {
  await page.goto('./')
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('./')
  await page.reload()
  await expect(page.getByTestId('dashboard')).toBeVisible()
}

test.describe('Estado muscular with the demo seed', () => {
  test('states, sets and the sheet match the seed; list and figure agree', async ({ page }) => {
    const { json, sessions, sets } = await demo()
    await restore(page, json)
    const before = await appNow(page)
    await page.goto('./#/entreno')
    const section = page.getByTestId('recovery-section')
    await expect(section).toBeVisible()
    const after = await appNow(page)

    // Compact summary first: six group rows, real buttons with the state in their names; no muscle rows.
    await expect(section.getByTestId('recovery-group')).toHaveCount(6)
    await expect(section.getByTestId('recovery-row')).toHaveCount(0)
    await expect(section.getByRole('button', { name: /^Piernas y glúteos, (ventana cumplida|en ventana|menos de 24 horas), hace \d+ (horas|días)\. Mostrar sus músculos$/ })).toBeVisible()
    // One group expands in place; then "Ver los 17 músculos" shows everything and is remembered.
    await section.locator('[data-testid="recovery-group"][data-group="arms"]').click()
    await expect(section.getByTestId('recovery-row')).toHaveCount(3)
    await section.getByTestId('recovery-show-all').click()
    await page.reload()
    await expect(section.getByTestId('recovery-row')).toHaveCount(17)
    await expect(section.getByTestId('recovery-show-all')).toHaveAttribute('aria-expanded', 'true')

    for (const muscle of ['quadriceps', 'chest', 'biceps']) {
      // The app captures "now" between `before` and `after`; the state must match either bound.
      const a = expected(muscle, sessions, sets, before)
      const b = expected(muscle, sessions, sets, after)
      const row = section.locator(`[data-testid="recovery-row"][data-muscle="${muscle}"]`)
      expect([a.state, b.state]).toContain(await row.getAttribute('data-state'))
      await expect(row).toContainText(`${fmt(a.last.n)} ${a.last.n === 1 ? 'serie' : 'series'}`)
      await expect(row).toContainText(`${fmt(a.week)} en 7 d`)
    }

    // Every muscle of the list is painted in the figure with the same state, and vice versa.
    const rows = await section.getByTestId('recovery-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-muscle'), e.getAttribute('data-state')]))
    expect(rows.length).toBe(17)
    const figureIds = await section.locator('svg path[data-muscle]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-muscle')))])
    expect(new Set(figureIds)).toEqual(new Set(rows.map(([m]) => m)))
    for (const [m, st] of rows) {
      const fills = await section.locator(`svg path[data-muscle="${m}"]`).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill')))])
      expect(fills.length, `${m} painted with one style`).toBe(1)
      if (st === 'recent') expect(fills[0]).toBe('rgb(var(--train))')
      if (st === 'recovering') expect(fills[0]).toContain('hatch')
      if (st === 'ready') expect(fills[0]).toContain('dots')
    }

    // Tapping a row opens its sheet with the rule in plain words.
    const q = expected('quadriceps', sessions, sets, before)
    await section.locator('[data-testid="recovery-row"][data-muscle="quadriceps"]').click()
    const sheet = page.getByTestId('recovery-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(`Ventana orientativa de ${q.window} h tras ${fmt(q.last.n)} series`)
    await expect(sheet).toContainText(q.last.s.name)
    await page.getByTestId('recovery-method-toggle').click()
    await expect(page.getByTestId('recovery-method')).toContainText('no es consejo médico')
    await expect(page.getByTestId('recovery-method')).toContainText('10.2478/hukin-2022-0017')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // Tapping a shape of the figure opens the same sheet.
    await section.locator('[data-testid="figure-back"] path[data-muscle="glutes"]').first().click({ force: true })
    await expect(page.getByRole('dialog')).toContainText('Glúteos')
  })

  test('a session a few hours ago shows "Menos de 24 h" and one the day before shows "En ventana"', async ({ page }) => {
    const { json, sessions, sets } = await demo((ss, xs) => {
      const legs = moveLatest(ss, xs, 'Pierna A', 30)
      const torso = moveLatest(ss, xs, 'Torso A', 4)
      dropRecentExcept(ss, xs, 30, [legs, torso])
    })
    await restore(page, json)
    const now = await appNow(page)
    await page.goto('./#/entreno')
    const section = page.getByTestId('recovery-section')
    await expect(section.locator('[data-testid="recovery-group"][data-group="chest"]')).toHaveAttribute('data-state', 'recent')
    await expect(section.locator('[data-testid="recovery-group"][data-group="chest"]')).toContainText('Menos de 24 h · hace 4 h')
    const q = expected('quadriceps', sessions, sets, now)
    expect(q.state).toBe('recovering')
    await section.getByTestId('recovery-show-all').click()
    await expect(section.locator('[data-testid="recovery-row"][data-muscle="quadriceps"]')).toHaveAttribute('data-state', 'recovering')
    await expect(section.locator('[data-testid="recovery-row"][data-muscle="quadriceps"]')).toHaveAccessibleName(/^Cuádriceps, en ventana, hace (29|30) horas$/)
  })

  test('no horizontal overflow at 360 px', async ({ page }) => {
    const { json } = await demo()
    await page.setViewportSize({ width: 360, height: 800 })
    await restore(page, json)
    await page.goto('./#/entreno')
    await page.getByTestId('recovery-section').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('recovery-show-all').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.locator('[data-testid="recovery-row"][data-muscle="chest"]').click()
    await page.getByTestId('recovery-method-toggle').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test('empty profile shows the neutral figure and one line', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno')
  await expect(page.getByTestId('recovery-section')).toBeVisible()
  await expect(page.getByTestId('recovery-empty')).toBeVisible()
  await expect(page.getByTestId('recovery-row')).toHaveCount(0)
  await expect(page.getByTestId('recovery-group')).toHaveCount(0)
  await expect(page.getByTestId('recovery-legend')).toHaveCount(0)
})

test('collapsed section stays compact at 412 px', async ({ page }) => {
  const { json } = await demo()
  await restore(page, json)
  await page.goto('./#/entreno')
  const box = await page.getByTestId('recovery-section').boundingBox()
  expect(box!.height).toBeLessThan(700)
  console.log(`recovery section collapsed height: ${Math.round(box!.height)} px`)
})

test('the figure opens large from "Ampliar"; muscles stay tappable; Escape closes and focus returns', async ({ page }) => {
  const { json } = await demo()
  await restore(page, json)
  await page.goto('./#/entreno')
  const section = page.getByTestId('recovery-section')
  const front = section.getByTestId('figure-front')
  expect((await front.boundingBox())!.height).toBeGreaterThanOrEqual(250)
  const expand = section.getByTestId('figure-expand')
  await expand.focus()
  await page.keyboard.press('Enter')
  const big = page.getByTestId('figure-big')
  await expect(big).toBeVisible()
  const bigFront = big.getByTestId('figure-front')
  expect((await bigFront.boundingBox())!.height).toBeGreaterThan(400)
  await expect(big.getByTestId('recovery-legend')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(big).toHaveCount(0)
  await expect(expand).toBeFocused()
  // Tap on the figure background (not a muscle) also opens it; a muscle there opens its sheet.
  await section.getByTestId('figure-views').click({ position: { x: 4, y: 4 } })
  await expect(big).toBeVisible()
  await big.locator('path[data-muscle="quadriceps"]').first().click({ force: true })
  await expect(page.getByTestId('recovery-sheet')).toBeVisible()
})
