import type { Page } from '@playwright/test'
import { demoJson as buildDemoJson, expect, test } from './helpers'

// V3 exercise screens (detail page, library). Synthetic demo dataset only (src/test/seed/demoSeed.ts),
// restored through Respaldo -> importar, same as e2e/v3-capture.mjs.
let demoJson = ''

test.beforeAll(async () => {
  demoJson = await buildDemoJson()
})

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(demoJson) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('./')
  await page.getByTestId('dashboard').waitFor()
})

const open = async (page: Page, id: string) => {
  await page.goto(`./#/entreno/ejercicios/${encodeURIComponent(id)}`)
  await expect(page.getByTestId('exercise-detail')).toBeVisible()
}

test('exercise with history: chart, metric switch, estimate label, history and dated records', async ({ page }) => {
  await open(page, 'fedb:Barbell_Squat')
  const progress = page.getByTestId('exercise-progress')
  await expect(progress.getByTestId('ts-chart').first()).toBeVisible()
  const panel = progress.getByTestId('chart-panel').first()
  await expect(panel).toContainText('Peso máximo')
  await expect(panel.getByTestId('panel-value')).toHaveText(/\d/)
  await expect(panel).toContainText('kg')

  await progress.getByRole('radio', { name: '1RM est.' }).click()
  await expect(progress.getByTestId('chart-panel').first()).toContainText('1RM estimado')
  await expect(page.getByTestId('e1rm-note')).toContainText('estimado')
  await expect(page.getByTestId('e1rm-note')).toContainText('Epley')
  // Header numbers use the Spanish formatter (comma decimal, dot thousands), like the records below.
  const headValue = progress.getByTestId('chart-panel').first().getByTestId('panel-value')
  await expect(headValue).toHaveText(/^\d{1,3}(,\d)?$/)
  await progress.getByRole('radio', { name: 'Volumen' }).click()
  await expect(headValue).toHaveText(/^\d{1,3}(\.\d{3})*$/)
  const vol = (await headValue.innerText()).replace(/\./g, '')
  if (Number(vol) >= 1000) expect(await headValue.innerText()).toContain('.')
  await progress.getByRole('radio', { name: '1RM est.' }).click()

  await progress.getByRole('radio', { name: 'Reps', exact: true }).click()
  await expect(progress.getByTestId('chart-panel').first()).toContainText('Repeticiones máximas')
  await expect(progress.getByTestId('chart-panel').first()).toContainText('reps')

  // Touching the chart swaps the header for that point's value and date.
  await progress.getByRole('radio', { name: 'Peso', exact: true }).click()
  const chart = progress.getByRole('img').first()
  await chart.scrollIntoViewIfNeeded()
  const box = (await chart.boundingBox())!
  const before = await progress.getByTestId('panel-sub').first().innerText()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
  await expect(progress.getByTestId('panel-sub').first()).not.toHaveText(before)

  await expect(page.getByTestId('records-summary')).toContainText('Peso máximo')

  await page.getByRole('tab', { name: /Historial/ }).click()
  await expect(page.getByTestId('history-session').first()).toContainText('Pierna A')
  expect(await page.getByTestId('history-set').count()).toBeGreaterThan(4)
  await expect(page.getByTestId('history-set').filter({ hasText: /\d+(,\d)? kg × \d+/ }).first()).toBeVisible()
  await expect(page.getByTestId('set-records').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Récords' }).click()
  const rows = page.getByTestId('record-row')
  expect(await rows.count()).toBeGreaterThanOrEqual(3)
  await expect(rows.first()).toContainText(/\d{4}/) // dated
  await expect(page.getByTestId('rep-records')).toBeVisible()

  await page.getByRole('tab', { name: 'Técnica' }).click()
  await expect(page.getByTestId('exercise-instructions')).toBeVisible()
  await expect(page.getByTestId('exercise-substitutes')).toBeVisible()
})

test('history session opens the session', async ({ page }) => {
  await open(page, 'fedb:Barbell_Squat')
  await page.getByRole('tab', { name: /Historial/ }).click()
  await page.getByTestId('history-session-link').first().click()
  await expect(page).toHaveURL(/#\/entreno\/sesion\//)
})

test('illustrated exercise keeps the RepDB credit; an exercise without one shows the tile', async ({ page }) => {
  await open(page, 'fedb:Barbell_Squat')
  await expect(page.getByTestId('exercise-illustration').getByRole('link', { name: 'Exercise data by RepDB (repdb.co)' })).toHaveAttribute('href', 'https://repdb.co')
  await open(page, 'fedb:Narrow_Stance_Leg_Press')
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await expect(page.getByTestId('exercise-illustration-fallback')).toContainText('Cuádriceps')
  await expect(page.getByTestId('exercise-tile')).toHaveAttribute('data-thumb', 'anatomy')
})

test('exercise without history shows the empty state', async ({ page }) => {
  await open(page, 'fedb:Inchworm')
  await expect(page.getByTestId('exercise-empty-progress')).toContainText('Aún no has registrado este ejercicio')
  await page.getByRole('tab', { name: 'Historial' }).click()
  await expect(page.getByTestId('exercise-empty-progress')).toBeVisible()
})

test('library: muscle and equipment search narrow the results, rows open the page', async ({ page }) => {
  await page.goto('./#/entreno/ejercicios')
  const results = page.getByTestId('exercise-results')
  await expect(results.locator('li').first()).toBeVisible()
  await expect(page.getByTestId('exercise-recent')).toBeVisible()
  await expect(page.getByTestId('exercise-logged').first()).toBeVisible()
  const total = await page.getByTestId('exercise-count').innerText()

  await page.getByTestId('exercise-search').fill('cuadriceps')
  await expect(page.getByTestId('exercise-count')).not.toHaveText(total)
  await expect(results.locator('li').first()).toContainText('Cuádriceps')

  await page.getByTestId('exercise-search').fill('polea')
  await expect(results.locator('li').first()).toContainText('Polea')

  await page.getByTestId('exercise-search').fill('')
  await page.getByTestId('group-legs').click()
  await expect(page.getByTestId('exercise-count')).not.toHaveText(total)
  const legs = await page.getByTestId('exercise-count').innerText()
  await page.getByTestId('equip-barbell').click()
  await expect(page.getByTestId('exercise-count')).not.toHaveText(legs)
  await expect(results.locator('li').first()).toContainText('Barra')

  await results.getByTestId('exercise-row').first().getByRole('link').click()
  await expect(page).toHaveURL(/#\/entreno\/ejercicios\/.+/)
  await expect(page.getByTestId('exercise-detail')).toBeVisible()
})

test('library: favourites are not repeated at the top of the full list, which is alphabetical', async ({ page }) => {
  await page.goto('./#/entreno/ejercicios')
  const results = page.getByTestId('exercise-results')
  await expect(page.getByTestId('exercise-favorites')).toBeVisible()
  await expect(results.locator('li').first()).toBeVisible()
  const names = await results.locator('li').evaluateAll((els) => els.slice(0, 12).map((e) => e.querySelector('.truncate')?.textContent ?? ''))
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es')))
  const favNames = await page.getByTestId('exercise-favorites').locator('li').evaluateAll((els) => els.map((e) => e.querySelector('.truncate')?.textContent ?? ''))
  expect(favNames.length).toBeGreaterThan(0)
  expect(names.slice(0, 3).some((n) => favNames.includes(n))).toBe(false)
})

test('library: end of the list has no blank gap and "Mostrar más" loads more rows', async ({ page }) => {
  await page.addInitScript(() => {
    // Deterministic: paging by the button only (the observer path is covered by the next test).
    class Inert {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'IntersectionObserver', { value: Inert, configurable: true })
  })
  await page.goto('./#/entreno/ejercicios')
  await page.reload() // the init script applies to a new document, not to a hash change
  const rows = page.getByTestId('exercise-results').locator('li')
  await expect(rows.first()).toBeVisible()
  const first = await rows.count()
  expect(first).toBeGreaterThanOrEqual(80)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const last = rows.nth(first - 1)
  await expect(last).toBeInViewport()
  expect((await last.boundingBox())!.height).toBeGreaterThan(56) // rendered, not collapsed
  await expect(last).toContainText(/\S/)
  const more = page.getByRole('button', { name: /Mostrar más/ })
  await more.scrollIntoViewIfNeeded()
  await expect(more).toBeInViewport()
  await more.click()
  await expect.poll(() => rows.count()).toBeGreaterThan(first)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(rows.nth((await rows.count()) - 1)).toBeInViewport()
})

test('library: scrolling to the end also pages automatically', async ({ page }) => {
  await page.goto('./#/entreno/ejercicios')
  const rows = page.getByTestId('exercise-results').locator('li')
  await expect(rows.first()).toBeVisible()
  const first = await rows.count()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(() => rows.count()).toBeGreaterThan(first)
})

test('detail tabs fit at 360 px without sideways scrolling; period select lives in the chart header', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await open(page, 'fedb:Barbell_Squat')
  const fits = await page.getByRole('tablist').evaluate((el) => el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
  const bar = (await page.getByRole('tablist').boundingBox())!
  for (const n of ['Resumen', 'Historial', 'Récords', 'Técnica']) {
    const b = (await page.getByRole('tab', { name: n }).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(bar.x - 0.5)
    expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
  }
  const panel = page.getByTestId('exercise-progress').getByTestId('chart-panel').first()
  await expect(panel.getByTestId('period-select')).toBeVisible()
  await panel.getByTestId('period-select').selectOption('all')
  await expect(page.getByTestId('exercise-progress').getByTestId('chart-panel').first()).toContainText('Todo el historial')
  await expect(panel).toContainText('21 días')
})
