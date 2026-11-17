import { expect, onboard, test } from './helpers'

// Ajustes → Actualizaciones in the browser build: the browser/PWA keeps its own service-worker prompt, so the page
// shows versions, defers to that prompt, never makes a request to an update server and folds the technical details.
// Every state of the native update service is covered by src/features/updates/updatesPage.test.ts (fake service).

test('Ajustes links to Actualizaciones; the page is calm, short and offline-safe', async ({ page }) => {
  const updateRequests: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).origin !== new URL(page.url() === 'about:blank' ? r.url() : page.url()).origin || /capgo/i.test(r.url())) updateRequests.push(r.url()) })
  await onboard(page)
  await page.goto('./#/ajustes')
  await page.locator('[data-row="actualizaciones"] a').click()
  await expect(page).toHaveURL(/#\/ajustes\/actualizaciones$/)
  await expect(page.getByRole('heading', { name: 'Actualizaciones' })).toBeVisible()
  await expect(page.getByTestId('version-web')).toHaveText(/^\d+\.\d+\.\d+$/)
  await expect(page.getByTestId('version-native')).toHaveCount(0)
  await expect(page.getByTestId('update-web')).toContainText('aviso de nueva versión')
  await expect(page.getByTestId('update-check')).toHaveCount(0)
  const details = page.getByTestId('update-details')
  await expect(details).not.toHaveAttribute('open', '')
  await details.locator('summary').click()
  await expect(details).toContainText('Canal')
  await expect(details).toContainText('Clave de firma')
  expect(updateRequests).toEqual([])
})

for (const width of [360, 412, 1280]) {
  test(`Actualizaciones fits ${width} px without horizontal scroll and the back arrow returns to Ajustes`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 915 })
    await onboard(page)
    await page.goto('./#/ajustes/actualizaciones')
    await expect(page.getByTestId('update-versions')).toBeVisible()
    await page.getByTestId('update-details').locator('summary').click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.getByRole('link', { name: 'Volver' }).filter({ visible: true }).first().click()
    await expect(page).toHaveURL(/#\/ajustes$/)
  })
}
