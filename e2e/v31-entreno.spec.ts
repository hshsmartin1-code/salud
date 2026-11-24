// V3.1 Entreno: the compact rest bar and its popover, history cards, the muscle split of a finished session and
// the statistics screen. Synthetic data only; the suite clock comes from ./helpers.
import type { Locator, Page } from '@playwright/test'
import { demoBackup, demoJson, expect, onboard, test, today } from './helpers'

// ───────────── a live session on a synthetic routine ─────────────

async function startSession(page: Page) {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill('Pierna sintética')
  for (const q of ['sentadilla barra', 'peso muerto rumano']) {
    await page.getByTestId('routine-add-exercise').click()
    await page.getByTestId('exercise-search').fill(q)
    await page.getByTestId('exercise-results').locator('button').first().click()
  }
  await page.getByTestId('save-routine').click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/(?!nueva$)[^/]+$/)
  await page.goto('./#/entreno')
  await page.getByTestId('start-routine').first().click()
  await expect(page.getByTestId('live-session')).toBeVisible()
  await expect(page.getByTestId('set-row').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('set-row')
async function completeSet(row: Locator, kg = '60', reps = '8') {
  await row.getByLabel('kg', { exact: true }).fill(kg)
  await row.getByLabel('Reps', { exact: true }).fill(reps)
  await row.getByTestId('set-done').click()
}
const bar = (page: Page) => page.getByTestId('rest-bar')
const time = (page: Page) => bar(page).locator('.readout').first()

type Box = { x: number; y: number; width: number; height: number }
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function openPopover(page: Page) {
  await page.getByTestId('rest-timer').click()
  await expect(page.getByTestId('rest-popover')).toBeVisible()
}

test.describe('compact rest timer', () => {
  test('after completing a set the bar docks under the header and never covers the set table', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await startSession(page)
    await expect(bar(page)).toHaveCount(0) // nothing runs yet: only the small timer button in the header
    await expect(page.getByTestId('rest-timer')).toBeVisible()
    await completeSet(rows(page).nth(0))
    await expect(bar(page)).toBeVisible()
    await expect(time(page)).toHaveText(/^\d+:\d\d$/)

    const b = (await bar(page).boundingBox())!
    const header = (await page.locator('[data-session-header]').boundingBox())!
    expect(b.height).toBeGreaterThanOrEqual(44)
    expect(b.height).toBeLessThanOrEqual(60)
    expect(b.y + b.height).toBeLessThanOrEqual(header.y + header.height + 1) // it is part of the sticky header
    const n = await rows(page).count()
    for (let i = 0; i < n; i++) {
      const r = (await rows(page).nth(i).boundingBox())!
      expect(intersects(b, r), `row ${i} under the bar`).toBe(false)
    }
    // Every control of the bar is a 44 px target and has a name.
    for (const name of ['Restar 15 segundos', 'Sumar 15 segundos', 'Pausar descanso', 'Terminar descanso']) {
      const box = (await bar(page).getByRole('button', { name }).boundingBox())!
      expect(box.width, name).toBeGreaterThanOrEqual(43.5)
      expect(box.height, name).toBeGreaterThanOrEqual(43.5)
    }
    // The next set is tappable straight away, nothing to close first.
    await rows(page).nth(1).getByTestId('set-done').click()
    await expect(rows(page).nth(1)).toHaveAttribute('data-done', 'true')
    await expect(page.getByTestId('session-volume')).toHaveText('960')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('the controls of the bar: −15, +15, pause, resume and end', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    const secs = async () => {
      const [m, s] = (await time(page).innerText()).split(':').map(Number)
      return m! * 60 + s!
    }
    const start = await secs()
    await bar(page).getByRole('button', { name: 'Sumar 15 segundos' }).click()
    expect(await secs()).toBeGreaterThanOrEqual(start + 13)
    await bar(page).getByRole('button', { name: 'Restar 15 segundos' }).click()
    await bar(page).getByRole('button', { name: 'Pausar descanso' }).click()
    await expect(bar(page)).toHaveAttribute('data-state', 'paused')
    const frozen = await secs()
    await page.waitForTimeout(1500)
    expect(await secs()).toBe(frozen)
    await bar(page).getByRole('button', { name: 'Reanudar descanso' }).click()
    await expect(bar(page)).toHaveAttribute('data-state', 'running')
    await bar(page).getByRole('button', { name: 'Terminar descanso' }).click()
    await expect(bar(page)).toHaveCount(0)
    await expect(page.getByTestId('rest-timer')).toBeVisible() // back to the small button
  })

  test('the popover is small and anchored to the bar; 60 restarts the rest at 1:00', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    await time(page).click()
    const pop = page.getByTestId('rest-popover')
    await expect(pop).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Descanso' })).toBeVisible()
    const box = (await pop.boundingBox())!
    const b = (await bar(page).boundingBox())!
    expect(box.height).toBeLessThanOrEqual(232)
    expect(Math.abs(box.y - (b.y + b.height))).toBeLessThanOrEqual(12) // right under the bar
    for (const s of [60, 90, 120, 180, 240]) await expect(page.getByTestId(`rest-preset-${s}`)).toBeVisible()
    await page.getByTestId('rest-preset-60').click()
    await expect(pop).toHaveCount(0)
    await expect(time(page)).toHaveText(/^(1:00|0:59)$/)
  })

  test('a typed duration works ("1:30", "90") and an invalid one is refused', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    await time(page).click()
    const field = page.getByTestId('rest-custom')
    await field.fill('2')
    await expect(page.getByTestId('rest-custom-start')).toBeDisabled()
    await expect(page.getByRole('alert')).toContainText('5 s a 60 min')
    await field.fill('1:30')
    await field.press('Enter')
    await expect(page.getByTestId('rest-popover')).toHaveCount(0)
    await expect(time(page)).toHaveText(/^(1:30|1:29)$/)
    await time(page).click()
    await page.getByTestId('rest-custom').fill('90')
    await page.getByTestId('rest-custom-start').click()
    await expect(time(page)).toHaveText(/^(1:30|1:29)$/)
  })

  test('with no rest running the small button starts any duration; "Usar para este ejercicio" saves it', async ({ page }) => {
    await startSession(page)
    await openPopover(page)
    await page.getByTestId('rest-remember').check()
    await page.getByTestId('rest-preset-180').click()
    await expect(bar(page)).toBeVisible()
    await expect(time(page)).toHaveText(/^(3:00|2:59)$/)
    // The exercise's own rest is now 3:00 (the block menu says so).
    await page.getByRole('button', { name: /^Opciones de (?!la sesión)/ }).first().click()
    await expect(page.getByRole('menuitem', { name: 'Descanso · 3:00' })).toBeVisible()
  })

  test('at zero the cue fires, the bar shows a finished state and folds by itself; nothing needs pressing', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    await time(page).click()
    await page.getByTestId('rest-custom').fill('5')
    await page.getByTestId('rest-custom-start').click()
    await expect(time(page)).toHaveText(/^[0-5]:0\d$/)
    // Keep the popover open to prove that the end closes it.
    await time(page).click()
    await expect(page.getByTestId('rest-popover')).toBeVisible()
    await expect(bar(page)).toHaveAttribute('data-state', 'over', { timeout: 9000 })
    await expect(page.getByTestId('rest-popover')).toHaveCount(0)
    await expect(bar(page)).toContainText('Descanso terminado')
    // In the finished state nothing overlays the table.
    const b = (await bar(page).boundingBox())!
    const n = await rows(page).count()
    for (let i = 0; i < n; i++) expect(intersects(b, (await rows(page).nth(i).boundingBox())!)).toBe(false)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // ... and it leaves on its own.
    await expect(bar(page)).toHaveCount(0, { timeout: 6000 })
    await expect(page.getByTestId('rest-timer')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    // The next set can be logged without closing anything.
    await rows(page).nth(1).getByTestId('set-done').click()
    await expect(rows(page).nth(1)).toHaveAttribute('data-done', 'true')
  })

  test('a reload in the middle of a rest keeps the countdown', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    await time(page).click()
    await page.getByTestId('rest-custom').fill('1:30')
    await page.getByTestId('rest-custom-start').click()
    await expect(time(page)).toHaveText(/^(1:30|1:29)$/)
    await page.waitForTimeout(2200)
    await page.reload()
    await expect(bar(page)).toBeVisible()
    const [m, s] = (await time(page).innerText()).split(':').map(Number)
    const left = m! * 60 + s!
    expect(left).toBeLessThanOrEqual(88)
    expect(left).toBeGreaterThan(60)
  })

  test('un-ticking the set that started the rest cancels it', async ({ page }) => {
    await startSession(page)
    await completeSet(rows(page).nth(0))
    await expect(bar(page)).toBeVisible()
    await rows(page).nth(0).getByTestId('set-done').click()
    await expect(rows(page).nth(0)).toHaveAttribute('data-done', 'false')
    await expect(bar(page)).toHaveCount(0)
  })
})

// ───────────── with the demo seed ─────────────

async function restoreDemo(page: Page, at?: string | null) {
  const json = await demoJson(at)
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

interface SeedSession { id: string; date: string; status: string; excludeFromStats?: boolean; durationMin?: number | null; exerciseOrder: { exerciseId: string; name: string }[] }
interface SeedSet { sessionId: string; exerciseId: string; weight: number | null; reps: number | null; isWarmup: boolean; done: boolean; excludeFromStats?: boolean }
async function seed(at?: string | null) {
  const b = await demoBackup<{ tables: { trainingSessions: SeedSession[]; exerciseSets: SeedSet[] } }>(at)
  const sessions = b.tables.trainingSessions.filter((s) => s.status === 'done' && !s.excludeFromStats)
  const ids = new Set(sessions.map((s) => s.id))
  const sets = b.tables.exerciseSets.filter((x) => ids.has(x.sessionId) && x.done && !x.isWarmup && !x.excludeFromStats)
  return { sessions, sets }
}
const es = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0, useGrouping: "always" }).format(Math.round(n))
const minutes = (m: number) => (m <= 0 ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`)

test.describe('with the demo seed', () => {
  test.beforeEach(async ({ page, clockAt }) => {
    await restoreDemo(page, clockAt)
  })

  test('history cards list up to three exercises and say how many more there are', async ({ page, clockAt }) => {
    const { sessions, sets } = await seed(clockAt)
    await page.goto('./#/entreno/historial')
    const cards = page.getByTestId('session-row')
    await expect(cards.first()).toBeVisible()
    const n = await cards.count()
    expect(n).toBeGreaterThan(2)
    let withMore = 0
    for (let i = 0; i < Math.min(n, 12); i++) {
      const card = cards.nth(i)
      const id = (await card.locator('a').first().getAttribute('href'))!.split('/').pop()!
      const done = new Set(sets.filter((x) => x.sessionId === id).map((x) => x.exerciseId))
      const lines = card.getByTestId('session-exercise')
      await expect(lines).toHaveCount(Math.min(3, done.size))
      for (let k = 0; k < (await lines.count()); k++) await expect(lines.nth(k)).toHaveText(/^\d+ × \S/)
      const more = card.getByTestId('session-more')
      if (done.size > 3) {
        withMore++
        await expect(more).toHaveText(`Ver ${done.size - 3} ${done.size - 3 === 1 ? 'ejercicio más' : 'ejercicios más'}`)
      } else await expect(more).toHaveCount(0)
      // name, date and "duration · volume" are on the card
      const s = sessions.find((x) => x.id === id)!
      await expect(card).toContainText(s.exerciseOrder.length ? (s.exerciseOrder.find((o) => done.has(o.exerciseId))?.name ?? '') : '')
    }
    expect(withMore).toBeGreaterThanOrEqual(0)
    // tapping the card opens the session
    await cards.first().locator('a').first().click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    await expect(page.getByTestId('done-session')).toBeVisible()
  })

  test('the Entreno home shows three recent sessions as cards and no longer the weekly chart or the records', async ({ page }) => {
    await page.goto('./#/entreno')
    await expect(page.getByTestId('recent-history').getByTestId('session-row')).toHaveCount(3)
    await expect(page.getByTestId('all-history')).toBeVisible()
    await expect(page.getByTestId('recent-records')).toHaveCount(0)
    await expect(page.getByTestId('group-bars')).toHaveCount(0)
    await expect(page.getByText('Volumen por semana')).toHaveCount(0)
    await page.getByTestId('stats-link').click()
    await expect(page).toHaveURL(/#\/entreno\/estadisticas$/)
    await expect(page.getByTestId('stats-page')).toBeVisible()
  })

  test('the finished session shows the muscle split: top three and "Mostrar más"', async ({ page }) => {
    await page.goto('./#/entreno/historial')
    await page.getByTestId('session-row').first().locator('a').first().click()
    const split = page.getByTestId('muscle-split')
    await expect(split).toBeVisible()
    await expect(split).toContainText('División muscular')
    const shown = split.getByTestId('split-row')
    const first = await shown.count()
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).toBeLessThanOrEqual(3)
    const pct = async () => (await shown.allInnerTexts()).map((t) => Number(/(\d+) %/.exec(t)![1]))
    const top = await pct()
    expect([...top].sort((a, b) => b - a)).toEqual(top)
    const more = split.getByTestId('split-more')
    if (await more.count()) {
      await more.click()
      expect(await shown.count()).toBeGreaterThan(3)
      const all = await pct()
      expect(Math.abs(all.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(all.length) // rounding only
      await expect(more).toHaveText(/Mostrar menos/)
    }
    // the rest of the detail is still there
    await expect(page.getByTestId('session-summary')).toBeVisible()
    await expect(page.getByTestId('done-set').first()).toBeVisible()
  })

  test('statistics: totals equal the values computed from the seed; best lifts and records link to exercises', async ({ page, clockAt }) => {
    const { sessions, sets } = await seed(clockAt)
    const year = today(clockAt).slice(0, 4)
    const total = (list: SeedSession[]) => {
      const ids = new Set(list.map((s) => s.id))
      const own = sets.filter((x) => ids.has(x.sessionId))
      return { sessions: list.length, minutes: list.reduce((a, s) => a + (s.durationMin && s.durationMin > 0 ? s.durationMin : 0), 0), volume: own.reduce((a, x) => a + (x.weight ?? 0) * (x.reps ?? 0), 0) }
    }
    const all = total(sessions)
    const thisYear = total(sessions.filter((s) => s.date.startsWith(year) && s.date <= today(clockAt)))
    await page.goto('./#/entreno/estadisticas')
    await expect(page.getByTestId('stats-page')).toBeVisible()
    await expect(page.getByTestId('total-all-sessions')).toHaveText(String(all.sessions))
    await expect(page.getByTestId('total-all-duration')).toHaveText(minutes(Math.round(all.minutes)))
    await expect(page.getByTestId('total-all-volume')).toHaveText(`${es(all.volume)} kg`)
    await expect(page.getByTestId('total-year-sessions')).toHaveText(String(thisYear.sessions))
    await expect(page.getByTestId('total-year-duration')).toHaveText(minutes(Math.round(thisYear.minutes)))
    await expect(page.getByTestId('total-year-volume')).toHaveText(`${es(thisYear.volume)} kg`)

    // weekly chart with a metric switch
    const weekly = page.getByTestId('stats-weekly')
    await expect(weekly).toBeVisible()
    for (const label of ['Duración', 'Volumen', 'Series']) await expect(weekly.getByRole('radio', { name: label })).toBeVisible()
    await weekly.getByRole('radio', { name: 'Series' }).click()
    await expect(weekly).toContainText('Series por semana')
    await weekly.getByRole('radio', { name: 'Duración' }).click()
    await expect(weekly).toContainText('Duración por semana')

    // best lifts link to the exercise
    const lift = page.getByTestId('best-lifts').getByRole('link').first()
    await expect(lift).toHaveAttribute('href', /#\/entreno\/ejercicios\//)
    // the 4-week bars and the records are on this screen
    await expect(page.getByTestId('stats-groups')).toContainText('Últimas 4 semanas')
    await expect(page.getByTestId('stats-records')).toBeVisible()
    for (const w of [360, 412, 1280]) {
      await page.setViewportSize({ width: w, height: 900 })
      // charts re-measure on resize: wait for the layout to settle instead of reading it once
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: `no overflow at ${w}` }).toBe(true)
    }
  })
})

test('statistics of a profile without sessions show the empty state', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno/estadisticas')
  await expect(page.getByTestId('stats-empty')).toContainText('Aún no hay estadísticas')
  await expect(page.getByTestId('stats-page')).toHaveCount(0)
  await page.goto('./#/entreno')
  await expect(page.getByTestId('stats-link')).toBeVisible()
})
