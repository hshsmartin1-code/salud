import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, onboard, test } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test('pastes a sentence from food search, reviews the portion, and logs in the chosen meal', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  const input = page.getByTestId('food-search')
  await input.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'Comí media arepa casera de 80 g. Por cada 100 g tiene 210 kcal, 5 g de proteína y 42 g de carbohidratos.')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const editor = page.getByTestId('text-food-editor')
  await expect(editor.getByLabel('Alimento', { exact: true })).toHaveValue('Arepa casera')
  await expect(page.getByTestId('text-food-preview')).toContainText('½ unidad · 40 g · 84 kcal')
  const confirm = editor.getByRole('checkbox', { name: /Revisé los datos señalados/ })
  if (await confirm.isVisible()) await confirm.check()
  const output = process.env.SALUD_TEXT_EVIDENCE
  if (output) {
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, '04-revision-texto-movil.png'), animations: 'disabled' })
  }
  await editor.getByRole('button', { name: /Comida Almuerzo/ }).click()
  await page.getByTestId('chooser').getByRole('radio', { name: 'Cena', exact: true }).click()
  await page.getByTestId('save-text-food').click()
  await page.getByTestId('food-added-count').getByRole('link', { name: 'Ver diario' }).click()
  await expect(page.getByTestId('meal-cena')).toContainText('Arepa casera')
  await expect(page.getByTestId('kcal-total')).toHaveText('84')
  await page.reload()
  await expect(page.getByTestId('meal-cena')).toContainText('40 g')
})

test('asks for the basis of calories mentioned alongside the amount consumed', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  await page.getByTestId('food-search').fill('Yogur 150 g, 120 calorías')
  await page.getByRole('button', { name: 'Revisar alimento escrito' }).click()
  await expect(page.getByTestId('save-text-food')).toBeDisabled()
  await page.getByLabel('¿A qué cantidad corresponden los datos?').selectOption('consumed')
  await expect(page.getByTestId('text-food-preview')).toContainText('150 g · 120 kcal')
  await expect(page.getByTestId('save-text-food')).toBeEnabled()
})

test('marks missing calories as pending and completes only that diary entry', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  await page.getByRole('button', { name: 'Escribir o pegar un alimento' }).click()
  await page.getByTestId('food-text-input').fill('Comí media arepa de la casa')
  await page.getByRole('button', { name: 'Revisar', exact: true }).click()
  await expect(page.getByTestId('text-food-preview')).toContainText('Nutrición pendiente')
  await page.getByTestId('save-text-food').click()
  await page.getByTestId('food-added-count').getByRole('link', { name: 'Ver diario' }).click()
  await expect(page.getByTestId('kcal-total')).toHaveText('—')
  await expect(page.getByTestId('day-summary')).toContainText('Total parcial')
  const row = page.getByTestId('meal-almuerzo').getByRole('button', { name: /Arepa de la casa.*Nutrición pendiente/ })
  await row.click()
  await expect(page.getByRole('textbox', { name: 'Cantidad' })).not.toBeFocused()
  await page.getByRole('button', { name: 'Completar nutrición' }).click()
  await page.getByTestId('food-text-input').fill('Por lo que comí: 84 kcal, proteína 2 g.')
  await page.getByRole('button', { name: 'Revisar', exact: true }).click()
  await expect(page.getByTestId('text-food-preview')).toContainText('84 kcal')
  await page.getByTestId('save-text-food').click()
  await expect(page.getByTestId('kcal-total')).toHaveText('84')
  await expect(page.getByTestId('meal-almuerzo').locator('ul > li')).toHaveCount(1)
})

test('keeps the mobile sheet above the keyboard and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  await page.getByRole('button', { name: 'Escribir o pegar un alimento' }).click()
  const dialog = page.getByRole('dialog', { name: 'Registrar por texto' })
  await expect(dialog).toHaveCSS('animation-name', 'none')
  const input = page.getByTestId('food-text-input')
  await expect(input).not.toBeFocused()
  await input.focus()
  await input.fill('Comí 120 g de avena')
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, value: 430 })
    vv.dispatchEvent(new Event('resize'))
  })
  const review = dialog.getByRole('button', { name: 'Revisar', exact: true })
  await expect.poll(async () => Math.round((await review.boundingBox())!.y + (await review.boundingBox())!.height)).toBeLessThanOrEqual(431)
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
