import { expect, onboard, test } from './helpers'

test('quantity sheet keeps its footer and fields reachable in a simulated keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 })
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=desayuno')
  await page.getByTestId('food-search').fill('arroz cocido')
  await page.getByTestId('food-results').locator('button').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.getByRole('textbox', { name: 'Cantidad' }).focus()

  // Chromium desktop does not open an Android keyboard. Shrink visualViewport as a layout simulation.
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, value: 430 })
    vv.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => dialog.evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeLessThanOrEqual(431)
  await expect.poll(() => page.getByTestId('save-food').evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeLessThanOrEqual(431)
  await expect(dialog.getByRole('textbox', { name: 'Cantidad' })).toBeFocused()
  await expect(dialog.getByTestId('save-food')).toBeEnabled()
  const scroll = dialog.locator('.sheet-scroll')
  const dimensions = await scroll.evaluate((el) => ({ content: el.scrollHeight, visible: el.clientHeight }))
  expect(dimensions.content).toBeGreaterThan(dimensions.visible)
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(dialog.getByTestId('save-food')).toBeInViewport()
})
