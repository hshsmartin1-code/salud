// Salud analytics centre: overview panels, period in the URL, chart read-out, in-place quick logging.
// Uses the synthetic demo seed (src/test/seed/demoSeed.ts) restored through the app's own import flow.
import type { Page } from '@playwright/test'
import { clickUndo, demoJson, expect, onboard, test } from './helpers'

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

const period = (page: Page, label: string) => page.getByRole('radiogroup', { name: 'Periodo' }).getByRole('radio', { name: label })

test.describe('Salud overview with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
    await page.goto('./#/salud')
    await expect(page.getByTestId('hub-panels')).toBeVisible()
  })

  test('shows the weight panel and at least six compact panels, none for metrics without data', async ({ page }) => {
    await expect(page.getByTestId('hub-weight')).toContainText('Peso')
    await expect(page.getByTestId('hub-weight')).toContainText('Tendencia')
    const panels = page.getByTestId('hub-panels').getByTestId('chart-panel')
    expect(await panels.count()).toBeGreaterThanOrEqual(7) // weight + 6 compact
    for (const t of ['Pasos', 'Sueño', 'Agua', 'FC en reposo', 'Presión']) await expect(page.getByTestId('hub-panels')).toContainText(t)
    // SpO2 has no reading in the seed: no panel, listed under "Otras medidas" with "Registrar".
    await expect(page.getByTestId('hub-panels')).not.toContainText('SpO')
    await expect(page.getByTestId('hub-others')).toContainText('SpO')
    // One reading in the period: listed with its last value, not a chart panel.
    await expect(page.getByTestId('hub-others')).toContainText('Temperatura')
    await expect(page.getByTestId('hub-panels')).not.toContainText('Temperatura')
  })

  test('period switch updates coverage and survives a detail page and back', async ({ page }) => {
    const sentence = page.getByTestId('weight-sentence')
    await period(page, '7 d').click()
    await expect(sentence).toContainText('de 7 días con dato')
    await period(page, '90 d').click()
    await expect(sentence).toContainText('de 90 días con dato')
    await period(page, '30 d').click()
    await expect(sentence).toContainText('de 30 días con dato')
    await period(page, '7 d').click()
    await expect(sentence).toContainText('de 7 días con dato')
    // Into the weight detail: same period, same coverage.
    await page.getByTestId('hub-weight').getByRole('link', { name: 'Peso' }).click()
    await expect(page).toHaveURL(/#\/cuerpo\?.*p=7/)
    await expect(period(page, '7 d')).toBeChecked()
    await expect(page.getByTestId('metric-sentence')).toContainText('de 7 días con dato')
    await period(page, '90 d').click()
    await expect(page.getByTestId('metric-sentence')).toContainText('de 90 días con dato')
    await page.getByRole('link', { name: 'Volver' }).click()
    await expect(page).toHaveURL(/#\/salud\?.*p=90/)
    await expect(period(page, '90 d')).toBeChecked()
    await expect(page.getByTestId('weight-sentence')).toContainText('de 90 días con dato')
  })

  test('compact panels open their detail with the period', async ({ page }) => {
    await period(page, '90 d').click()
    await page.getByTestId('hub-panels').getByRole('link', { name: /Sueño/ }).click()
    await expect(page).toHaveURL(/#\/sueno\?.*p=90/)
    await expect(page.getByTestId('metric-sentence')).toContainText('de sueño por noche')
  })

  test('keyboard and drag on a chart change the header read-out', async ({ page }) => {
    await page.goto('./#/cuerpo?p=30')
    const chart = page.getByTestId('body-page').getByTestId('ts-chart').locator('[role=img]').first()
    await expect(chart).toBeVisible()
    const sub = page.getByTestId('panel-sub')
    const before = await sub.innerText()
    await chart.focus()
    await chart.press('ArrowLeft')
    await chart.press('ArrowLeft')
    await expect(sub).not.toHaveText(before)
    await expect(page.getByTestId('point-caption')).toContainText('Fuente: Manual')
    const keyed = await sub.innerText()
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(sub).not.toHaveText(keyed)
  })

  test('comparison toggle adds the previous period to the chart legend', async ({ page }) => {
    await page.goto('./#/cuerpo?p=30&m=waist')
    await expect(page.getByTestId('body-page').getByTestId('ts-chart')).toBeVisible()
    await page.getByTestId('compare-toggle').click()
    await expect(page.getByTestId('compare-note')).toContainText('Línea fina')
    await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('quick weight log takes two taps, shows Deshacer and removes exactly that row', async ({ page }) => {
    await page.getByTestId('quick-weight').click() // tap 1: opens the sheet, prefilled with the latest weight
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Peso' }).fill('79,3')
    await dialog.getByTestId('quick-save').click() // tap 2
    await expect(page.locator('.toast-host')).toContainText('Peso guardado: 79,3 kg')
    await page.goto('./#/cuerpo')
    await expect(page.getByTestId('latest-weight')).toContainText('79,3')
    await page.goto('./#/salud')
    await page.getByTestId('quick-weight').click()
    await page.getByRole('dialog').getByRole('textbox', { name: 'Peso' }).fill('78,8')
    await page.getByRole('dialog').getByTestId('quick-save').click()
    await clickUndo(page)
    await page.goto('./#/cuerpo')
    await expect(page.getByTestId('latest-weight')).toContainText('79,3') // the 78,8 row is gone, 79,3 stays
    await expect(page.getByTestId('measurement-list')).not.toContainText('78,8')
  })

  test('quick water log is one tap after opening, with undo', async ({ page }) => {
    await page.goto('./#/agua')
    const read = async () => Number((await page.getByTestId('hydration-today').innerText()).replace(/\D/g, '').replace(/^Hoy/, '') || 0)
    await page.waitForTimeout(800) // the live query has landed
    const base = await read()
    await page.goto('./#/salud')
    await page.getByTestId('quick-water').click()
    await page.getByTestId('quick-water-250').click() // one tap
    await expect(page.locator('.toast-host')).toContainText('+250 ml de agua')
    await page.goto('./#/agua')
    await expect.poll(read).toBe(base + 250)
    await page.goto('./#/salud')
    await page.getByTestId('quick-water').click()
    await page.getByTestId('quick-water-500').click()
    await clickUndo(page)
    await page.goto('./#/agua')
    await expect.poll(read).toBe(base + 250)
  })

  test('?tipo=peso opens the quick weight sheet', async ({ page }) => {
    await page.goto('./#/cuerpo/nueva?tipo=peso')
    await expect(page.getByRole('dialog', { name: 'Registrar peso' })).toBeVisible()
  })

  test('detail pages have no horizontal overflow at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const hash of ['#/salud', '#/cuerpo', '#/actividad', '#/sueno?m=schedule', '#/signos?m=glucose', '#/agua', '#/habitos']) {
      await page.goto('./' + hash)
      await expect(page.locator('[data-testid=ts-chart], [data-testid=schedule-chart]').first()).toBeVisible()
      await page.waitForTimeout(300)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(over, hash).toBeLessThanOrEqual(0)
    }
  })
})

test('a fresh profile gets the real empty state with the quick actions', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/salud')
  await expect(page.getByTestId('hub-empty')).toBeVisible()
  await expect(page.getByTestId('chart-panel')).toHaveCount(0)
  await expect(page.getByTestId('quick-water')).toBeVisible()
  await page.getByTestId('quick-water').click()
  await page.getByTestId('quick-water-500').click()
  await expect(page.locator('.toast-host')).toContainText('+500 ml de agua')
})
