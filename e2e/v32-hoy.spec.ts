// V3.2 Hoy: training is state or plan, never a default recommendation; the day's numbers come first; no step progress
// without a goal. Synthetic demo profile on the suite clock (Wednesday 2026-11-18 16:30, America/Bogota).
import type { Page } from '@playwright/test'
import { demoWith, expect, restoreJson, test, type DemoOptions } from './helpers'

const PLAN_WED = { 3: { routine: 'Pierna A' }, 5: { routine: 'Torso A' } } // Wednesday (today) and Friday
const PLAN_REST = { 1: { routine: 'Torso A' }, 4: { routine: 'Pierna A' } } // Monday and Thursday: today is a rest day
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const fold = (page: Page) => page.evaluate(() => Math.min(window.innerHeight, [...document.querySelectorAll('nav[aria-label=Principal]')].map((n) => n.getBoundingClientRect()).find((r) => r.height > 0 && r.top > window.innerHeight / 2)?.top ?? window.innerHeight))
const top = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!.y
const sessionRows = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ total: number; active: number }>((resolve, reject) => {
        const req = indexedDB.open('salud-pho')
        req.onsuccess = () => {
          const all = req.result.transaction('trainingSessions').objectStore('trainingSessions').getAll()
          all.onsuccess = () => resolve({ total: all.result.length, active: all.result.filter((s: { status: string }) => s.status === 'active').length })
          all.onerror = () => reject(all.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
async function restore(page: Page, o: DemoOptions) {
  await restoreJson(page, await demoWith(o))
}

test.describe('the four training cases on Hoy', () => {
  test('planned today with a routine: the card sits directly under the greeting, above the day summary', async ({ page }) => {
    await restore(page, { plan: PLAN_WED })
    const card = page.getByTestId('training-due')
    await expect(card).toContainText('Hoy toca')
    await expect(card).toContainText('Pierna A')
    const header = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    const box = (await card.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(await top(page, 'day-summary'))
    await expect(page.getByTestId('training-done')).toHaveCount(0)
    await expect(page.getByTestId('training-next')).toHaveCount(0)
  })

  test('planned today, days only: «Entrenamiento de hoy» with the habitual routine behind it', async ({ page }) => {
    await restore(page, { plan: { 3: {}, 5: {} } })
    const card = page.getByTestId('training-due')
    await expect(card).toContainText('Entrenamiento de hoy')
    await expect(page.getByTestId('start-last-routine')).toHaveAccessibleName(/^Iniciar \S/)
  })

  test('planned today and done: one quiet row at the end, «Entrenamiento hecho», linking to the session', async ({ page }) => {
    await restore(page, { plan: PLAN_WED, doneToday: true })
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    const row = page.getByTestId('training-done')
    await expect(row).toContainText('Entrenamiento hecho')
    await expect(row).toContainText('Pierna A')
    await expect(row).toHaveAttribute('href', /#\/entreno\/sesion\/hoy-done-today$/)
    expect(await top(page, 'training-done')).toBeGreaterThan(await top(page, 'hoy-quick'))
    await row.click()
    await expect(page.getByTestId('done-session')).toBeVisible()
  })

  test('a finished session today without any plan shows the same quiet row', async ({ page }) => {
    await restore(page, { doneToday: true })
    await expect(page.getByTestId('training-done')).toContainText('Entrenamiento hecho')
    await expect(page.getByTestId('training-due')).toHaveCount(0)
  })

  test('a rest day: one quiet row with the next session, no recommendation anywhere', async ({ page }) => {
    await restore(page, { plan: PLAN_REST })
    await expect(page.getByTestId('training-next')).toHaveText(/Próxima sesión: jue 19 · Pierna A/)
    await expect(page.getByTestId('training-next')).toHaveAttribute('href', /#\/entreno$/)
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
    expect(await top(page, 'training-next')).toBeGreaterThan(await top(page, 'hoy-quick'))
  })

  test('no plan: «Ir a Entreno», never a routine name or a start button', async ({ page }) => {
    await restore(page, {})
    await expect(page.getByTestId('training-go')).toHaveText('Ir a Entreno')
    await expect(page.getByTestId('training-go')).toHaveAttribute('href', /#\/entreno$/)
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
    await expect(page.getByTestId('now-block')).toHaveCount(0)
  })

  test('a session in progress: Hoy adds nothing (the shell shows the single «Sesión en curso» bar), even on a rest day', async ({ page }) => {
    await restore(page, { plan: PLAN_REST })
    await page.goto('./#/entreno')
    await page.getByTestId('start-last-routine').click()
    await expect(page.getByTestId('live-session')).toBeVisible()
    await page.goto('./')
    await expect(page.getByTestId('session-ongoing-bar').filter({ visible: true })).toHaveCount(1)
    await expect(page.getByTestId('active-session')).toHaveCount(0)
    await expect(page.getByTestId('training-next')).toHaveCount(0)
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    await expect(page.getByTestId('training-go')).toHaveCount(0)
  })
})

test('starting from Hoy creates exactly one session, even on a double tap', async ({ page }) => {
  await restore(page, { plan: PLAN_WED })
  const before = await sessionRows(page)
  await page.getByTestId('start-last-routine').dblclick()
  await expect(page.getByTestId('live-session')).toBeVisible()
  const after = await sessionRows(page)
  expect(after.total).toBe(before.total + 1)
  expect(after.active).toBe(1)
  // Back on Hoy there is the shell's bar and no way to start a second one.
  await page.goto('./')
  await expect(page.getByTestId('session-ongoing-bar').filter({ visible: true })).toHaveCount(1)
  await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
  expect((await sessionRows(page)).total).toBe(before.total + 1)
})

test.describe('Hoy, the Entreno dock and the + tile offer the same routine', () => {
  for (const [label, plan, expected] of [
    ['today planned with Pierna A', { 3: { routine: 'Pierna A' } }, 'Pierna A'],
    ['today planned with Torso A', { 3: { routine: 'Torso A' } }, 'Torso A'],
  ] as const) {
    test(label, async ({ page }) => {
      await restore(page, { plan })
      await expect(page.getByTestId('start-last-routine')).toHaveAccessibleName(`Iniciar ${expected}`)
      await page.goto('./#/entreno')
      await expect(page.getByTestId('start-last-routine')).toHaveAccessibleName(`Iniciar ${expected}`)
      await expect(page.getByTestId('dock-bar')).toContainText('Iniciar · hoy')
      // On a phone the plan block keeps its text and drops the duplicate «Iniciar».
      await expect(page.getByTestId('plan-next')).toContainText(`Próxima sesión: hoy · ${expected}`)
      await expect(page.getByTestId('plan-start')).toHaveCount(0)
      await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Registrar' }).click()
      await expect(page.getByTestId('plus-training')).toBeEnabled()
      await expect(page.getByTestId('plus-training')).toHaveAttribute('data-mode', 'start')
      await expect(page.getByTestId('plus-training')).toHaveAccessibleName(`Iniciar ${expected}`)
      await expect(page.getByTestId('plus-training')).toContainText(`Iniciar · ${expected}`)
    })
  }

  test('on a rest day the dock and the + tile still agree (the habitual routine), and Hoy offers none', async ({ page }) => {
    await restore(page, { plan: PLAN_REST })
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
    await page.goto('./#/entreno')
    const dock = await page.getByTestId('start-last-routine').getAttribute('aria-label')
    expect(dock).toMatch(/^Iniciar \S/)
    await expect(page.getByTestId('dock-bar')).not.toContainText('hoy')
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByTestId('plus-training')).toBeEnabled()
    await expect(page.getByTestId('plus-training')).toHaveAttribute('aria-label', dock!)
  })

  test('a days-only plan offers the habitual routine in the dock, as without a plan (the inline «Iniciar» stays: it starts a free session)', async ({ page }) => {
    await restore(page, { plan: { 3: {} } })
    await page.goto('./#/entreno')
    await expect(page.getByTestId('start-last-routine')).toHaveAccessibleName(/^Iniciar \S/)
    await expect(page.getByTestId('plan-start')).toHaveAccessibleName(/^Iniciar/)
  })
})

test.describe('midnight rollover from a planned day to a rest day', () => {
  test.use({ clockAt: '2026-11-18T23:58:00-05:00' })
  test('the card goes away and the next session takes its place', async ({ page }) => {
    await restoreJson(page, await demoWith({ plan: PLAN_WED, at: '2026-11-18T23:58:00-05:00' }))
    await expect(page.getByTestId('training-due')).toContainText('Pierna A')
    await page.clock.fastForward('02:00')
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    await expect(page.getByTestId('training-next')).toHaveText(/Próxima sesión: vie 20 · Torso A/)
  })
})

test.describe('steps without a goal', () => {
  test('no goal: two rings, only the figure with its unit, nothing announced about a goal', async ({ page }) => {
    await restore(page, { stepGoal: null })
    const summary = page.getByTestId('day-summary')
    await expect(summary.locator('svg[role="img"]')).toHaveCount(2)
    const steps = page.getByTestId('hero-steps')
    await expect(steps).toContainText('Pasos')
    await expect(steps).toContainText(/\d.?pasos$/)
    await expect(steps).not.toContainText(/Sin meta|Sin objetivo|Faltan|\//)
    const label = (await summary.locator('div[role="img"][aria-label^="Energía"]').getAttribute('aria-label'))!
    expect(label).not.toMatch(/pasos/i)
    // The tile keeps the weekday bars, with no goal line and no «Meta».
    await expect(page.locator('[data-indicator=steps]')).not.toContainText('Meta')
    // Nothing else on the screen draws a percentage of steps.
    await expect(page.getByTestId('dashboard')).not.toContainText(/pasos[^.\n]{0,20}\d+ ?%/i)
  })

  test('with a goal the third ring, its target and what is left come back', async ({ page }) => {
    await restore(page, {})
    const summary = page.getByTestId('day-summary')
    await expect(summary.locator('svg[role="img"]')).toHaveCount(3)
    await expect(page.getByTestId('hero-steps')).toContainText('/ 8.000')
    await expect(page.getByTestId('hero-steps')).toContainText(/Faltan|Objetivo alcanzado|por encima/)
    expect(await summary.locator('div[role="img"][aria-label^="Energía"]').getAttribute('aria-label')).toMatch(/pasos \d.* de 8\.000/)
    await expect(page.locator('[data-indicator=steps]')).toContainText('Meta 8.000')
  })
})

test.describe('layout', () => {
  for (const [label, o] of [
    ['rest day', { plan: PLAN_REST }],
    ['no plan', {}],
    ['planned today', { plan: PLAN_WED }],
    ['done today', { plan: PLAN_WED, doneToday: true }],
    ['no step goal', { stepGoal: null }],
  ] as [string, DemoOptions][]) {
    test(`360 x 800, ${label}: greeting, day numbers and quick actions fit without scrolling; no horizontal overflow; tiles keep their own height`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 })
      await restore(page, o)
      await expect(page.getByTestId('day-summary')).toBeVisible()
      const limit = await fold(page)
      for (const id of ['day-summary', 'hoy-quick']) {
        const b = (await page.getByTestId(id).boundingBox())!
        expect(b.y + b.height, id).toBeLessThanOrEqual(limit)
      }
      expect(await noOverflow(page)).toBe(true)
      for (const t of await page.locator('[data-indicator] > a').all()) expect((await t.boundingBox())!.height).toBeLessThan(260)
    })
  }

  test('at 1280 px: today in the left column, the indicator tiles in the right one', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await restore(page, { plan: PLAN_WED })
    const col = async (id: string) => (await page.getByTestId(id).boundingBox())!.x
    const tilesX = (await page.getByTestId('dashboard-indicators').boundingBox())!.x
    for (const id of ['training-due', 'day-summary', 'hoy-quick']) expect(await col(id), id).toBeLessThan(tilesX - 100)
    expect(await noOverflow(page)).toBe(true)
  })
})
