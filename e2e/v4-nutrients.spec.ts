// Nutrientes: intake against reference values. Uses the synthetic demo seed restored through the app's own import flow.
import type { Page } from '@playwright/test'
import { demoJson, expect, test } from './helpers'

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

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.describe('Nutrientes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await restoreDemo(page)
  })

  test('opens from the diary and lists the sections with references and statuses', async ({ page }) => {
    await page.goto('./#/comida')
    await page.getByTestId('nutrients-link').click()
    await expect(page).toHaveURL(/#\/comida\/nutrientes$/)
    await expect(page.getByRole('heading', { name: 'Nutrientes', level: 1 })).toBeVisible()
    await expect(page.getByTestId('nutrients-report')).toBeVisible()
    for (const title of ['Energía y macronutrientes', 'Minerales', 'Vitaminas', 'Límites', 'Distribución por comida']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }
    const iron = page.getByTestId('nutrient-iron')
    await expect(iron).toContainText('Hierro')
    await expect(iron).toContainText(/RDA \d+ mg/)
    await expect(page.getByTestId('status-iron')).toHaveText(/^(\d+ %|Sin dato|Por encima del UL)$/)
    await expect(page.getByTestId('nutrients-refset')).toHaveText('Referencia: NASEM/IOM (EE. UU.)')
    await expect(page.getByTestId('nutrient-folate')).toContainText('no DFE')
    await expect(page.getByTestId('nutrient-sodium')).toContainText('CDRR')
    await expect(page.getByTestId('nutrient-cholesterol')).toContainText('Sin valor de referencia')
    expect(await noOverflow(page)).toBe(true)
  })

  test('period control switches to averages and says how many days', async ({ page }) => {
    await page.goto('./#/comida/nutrientes')
    await expect(page.getByTestId('nutrients-report')).toBeVisible()
    await page.getByRole('radio', { name: '7 días' }).click()
    await expect(page.getByTestId('nutrients-scope')).toContainText(/Promedio por día de \d+ días? con registro/)
    expect(await noOverflow(page)).toBe(true)
    await page.getByRole('radio', { name: '30 días' }).click()
    await expect(page.getByTestId('nutrients-scope')).toContainText(/Promedio por día de \d+ días? con registro/)
  })

  test('method disclosure carries the caveats', async ({ page }) => {
    await page.goto('./#/comida/nutrientes')
    await page.getByTestId('nutrients-method').locator('summary').click()
    await expect(page.getByTestId('nutrients-method')).toContainText('no un diagnóstico')
    await expect(page.getByTestId('nutrients-method')).toContainText('Embarazo y lactancia no están')
    await expect(page.getByTestId('nutrients-method')).toContainText('DFE')
    await expect(page.getByTestId('nutrients-method')).toContainText('RIEN')
  })

  test('a day without entries shows the empty state', async ({ page }) => {
    await page.goto('./#/comida/nutrientes?d=2020-01-01')
    await expect(page.getByText('Sin registros en este periodo')).toBeVisible()
    await expect(page.getByTestId('nutrients-report')).toHaveCount(0)
  })
})
