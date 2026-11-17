// V3.1 progressive disclosure on Hoy and Salud: today's progress and the frequent actions above the fold,
// no empty tiles, folded notes that stay reachable. Synthetic demo seed on the suite clock.
import type { Page } from '@playwright/test'
import { demoJson, expect, onboard, test } from './helpers'

async function restoreDemo(page: Page) {
  const json = await demoJson()
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

/** Top of the bottom navigation: what the phone shows is everything above it. */
const foldY = (page: Page) => page.evaluate(() => Math.min(window.innerHeight, [...document.querySelectorAll('nav[aria-label=Principal]')].map((n) => n.getBoundingClientRect()).find((r) => r.height > 0 && r.top > window.innerHeight / 2)?.top ?? window.innerHeight))

const isOpen = (loc: ReturnType<Page['getByTestId']>) => loc.evaluate((el) => (el as HTMLDetailsElement).open)

async function open(page: Page, hash: string) {
  await page.goto('./' + hash)
  await page.reload() // a fresh mount: a note opened on the previous page must not carry over
  await page.waitForTimeout(400)
}

test.describe('Hoy with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
  })

  test('at 412 x 915 the header, Tu día and the quick actions are fully above the fold, in that order, with no training block above them', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await page.reload()
    await expect(page.getByTestId('day-summary')).toBeVisible()
    const fold = await foldY(page)
    const header = page.getByRole('heading', { level: 1 })
    const blocks = [header, page.getByTestId('day-summary'), page.getByTestId('hoy-quick')]
    let previousEnd = 0
    for (const loc of blocks) {
      const b = (await loc.boundingBox())!
      expect(b.y, 'starts in view, below the previous block').toBeGreaterThanOrEqual(previousEnd)
      expect(b.y + b.height, 'ends above the bottom navigation').toBeLessThanOrEqual(fold)
      previousEnd = b.y + b.height - 1
    }
    // No plan and no session in progress: nothing about training above the day summary.
    await expect(page.getByTestId('now-block')).toHaveCount(0)
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    await expect(page.getByTestId('active-session')).toHaveCount(0)
    const summaryTop = (await page.getByTestId('day-summary').boundingBox())!.y
    const training = (await page.getByTestId('training-go').boundingBox())!
    expect(training.y, 'the training row closes the page').toBeGreaterThan(summaryTop)
    expect(await page.getByTestId('week-disclosure').evaluate((el, row) => !!(el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING), await page.getByTestId('training-go').elementHandle())).toBe(true)
    // The header is one line.
    expect((await header.boundingBox())!.height).toBeLessThan(48)
    // The data-source footnote is folded, closed.
    expect(await isOpen(page.getByTestId('day-sources'))).toBe(false)
  })

  test('insights: at most two in view, the rest behind Ver más', async ({ page }) => {
    const rows = page.getByTestId('insights').locator('> ul > li')
    expect(await rows.count()).toBeLessThanOrEqual(2)
    const more = page.getByTestId('insights-more')
    if (await more.count()) {
      expect(await isOpen(more)).toBe(false)
      await more.locator('summary').click()
      await expect(more.locator('li').first()).toBeVisible()
    }
  })

  test('only tiles with data are shown; the rest collapse into one row that opens the customise sheet', async ({ page }) => {
    await expect(page.getByTestId('dashboard-indicators')).toBeVisible()
    const tiles = page.locator('[data-indicator]')
    expect(await tiles.count()).toBeGreaterThan(0)
    await expect(page.getByTestId('dashboard-indicators')).not.toContainText('Sin registros')
    const add = page.getByTestId('dashboard-customize')
    await expect(add).toHaveCount(1)
    if ((await tiles.count()) < 8) {
      await expect(add).toContainText('Agregar indicadores')
      await add.click()
      await expect(page.getByRole('dialog', { name: 'Personalizar indicadores' })).toBeVisible()
    }
  })

  test('at most one notice in view; the weekly summary is folded and its figures match when opened', async ({ page }) => {
    const alerts = page.getByRole('region', { name: 'Avisos' })
    if (await alerts.count()) expect(await alerts.locator('> a').count()).toBe(1)

    const week = page.getByTestId('week-disclosure')
    expect(await isOpen(week)).toBe(false)
    const summary = week.locator('summary')
    await expect(summary).toContainText('Resumen de la semana')
    const lead = (await summary.innerText()).split('\n').slice(1).join(' ')
    await expect(page.getByTestId('range-stats').getByText('Energía consumida')).toBeHidden()
    await summary.click()
    const rows = page.getByTestId('range-stats')
    for (const label of ['Energía consumida', 'Proteína', 'Pasos', 'Sueño', 'Entrenamiento', 'Peso (tendencia)']) await expect(rows.getByText(label, { exact: true })).toBeVisible()
    // Each figure in the summary line is the same number as its row inside.
    const figures = lead
      .split('·')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(figures).toHaveLength(2)
    for (const f of figures) {
      const num = f.split(' ')[0]!
      await expect(rows.locator('.num').filter({ hasText: num }).first()).toBeVisible()
    }
  })

  test('the data-source note is reachable', async ({ page }) => {
    await page.getByTestId('day-sources').locator('summary').click()
    await expect(page.getByTestId('day-sources')).toContainText('Comida: tu diario de hoy')
  })

  test('no horizontal overflow at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.reload()
    await expect(page.getByTestId('day-summary')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})

test('a fresh profile: no empty tiles, no insight placeholder, one sentence', async ({ page }) => {
  await onboard(page)
  await expect(page.getByTestId('now-block')).toHaveCount(0)
  await expect(page.getByTestId('training-go')).toContainText('Ir a Entreno')
  await expect(page.getByTestId('hoy-quick')).toBeVisible()
  await expect(page.getByTestId('hoy-empty')).toBeVisible()
  // Only the weight from the welcome form has data: one real tile, no empty ones.
  await expect(page.locator('[data-indicator]')).toHaveCount(1)
  await expect(page.getByTestId('tile-weight')).toContainText('60')
  await expect(page.getByTestId('insights')).toHaveCount(0)
  await expect(page.getByTestId('range-stats')).toHaveCount(0)
  await expect(page.getByTestId('dashboard')).not.toContainText('Sin registros')
  await expect(page.getByTestId('dashboard-customize')).toContainText('Agregar indicadores')
})

test.describe('Salud with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
    await page.goto('./#/salud')
    await expect(page.getByTestId('hub-panels')).toBeVisible()
  })

  test('period selector, weight panel and six compact panels come before Otras medidas', async ({ page }) => {
    await expect(page.getByRole('radiogroup', { name: 'Periodo' })).toBeVisible()
    await expect(page.getByTestId('hub-weight')).toBeVisible()
    const panels = page.getByTestId('hub-panels').getByTestId('chart-panel')
    expect(await panels.count()).toBeGreaterThanOrEqual(7) // weight + 6 compact
    const others = (await page.getByTestId('hub-others').boundingBox())!
    const grid = (await page.getByTestId('hub-panels').boundingBox())!
    expect(grid.y + grid.height).toBeLessThanOrEqual(others.y)
    // One list of measures with rows as navigation: no old split sections.
    await expect(page.getByRole('region', { name: 'Un solo registro en este periodo' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Sin registros en este periodo' })).toHaveCount(0)
    await expect(page.getByTestId('hub-others').getByRole('button', { name: /SpO/ })).toContainText('Registrar')
    await expect(page.getByTestId('hub-others').getByRole('link', { name: /Temperatura/ })).toContainText('36,6')
  })

  test('the weight panel has one short line: trend and coverage', async ({ page }) => {
    const line = page.getByTestId('weight-sentence')
    await expect(line).toContainText('de 30 días con dato')
    expect((await line.innerText()).length).toBeLessThan(60)
    expect((await line.boundingBox())!.height).toBeLessThan(24) // one line at 412
  })

  test('every folded note is reachable on the detail pages', async ({ page }) => {
    const cases: [string, string, string][] = [
      ['#/cuerpo?p=30', 'metric-how', 'Peso actual'],
      ['#/cuerpo?p=90&m=bodyFat', 'metric-how', 'no es una medición directa'],
      ['#/actividad?p=30&m=activeKcal', 'metric-how', 'informativas'],
      ['#/signos?p=30', 'vital-how', 'orientativas'],
      ['#/sueno?m=schedule&p=30', 'schedule-note', 'Cada barra va de la hora'],
    ]
    for (const [hash, id, text] of cases) {
      await open(page, hash)
      const d = page.getByTestId(id)
      await expect(d, hash).toHaveCount(1)
      expect(await isOpen(d), hash).toBe(false)
      await d.locator('summary').click()
      await expect(d, hash).toContainText(text)
      await expect(d.locator('summary'), hash).toContainText('Cómo se calcula')
    }
  })

  test('no horizontal overflow at 360 px on Salud, Cuerpo, Signos and Agua', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const hash of ['#/salud', '#/cuerpo', '#/signos', '#/agua']) {
      await open(page, hash)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), hash).toBeLessThanOrEqual(0)
    }
  })
})
