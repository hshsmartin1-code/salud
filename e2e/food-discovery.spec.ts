import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { clockTest, expect, onboard, test } from './helpers'

const code = '9990000000099'
const thumbnail = 'https://images.openfoodfacts.org/images/products/999/000/000/0099/front_es.1.200.png'
const product = {
  code, product_name: 'Ramito de prueba', brands: 'Ramo', countries_tags: ['en:colombia'],
  quantity: '250 g', serving_size: '1 unidad (25 g)', serving_quantity: 25, serving_quantity_unit: 'g',
  nutrition_data_per: 'serving', rev: 4,
  image_front_small_url: thumbnail,
  nutriments: { 'energy-kcal_serving': 100, proteins_serving: 2, carbohydrates_serving: 10 },
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test('discovers Colombian products with consent, paginates, logs half a unit, and retains it after reload', async ({ page }) => {
  const hits: { page: string | null; country: string | null }[] = []
  await page.route(thumbnail, (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHiQAAAAASUVORK5CYII=', 'base64'),
  }))
  await page.route('https://world.openfoodfacts.org/cgi/search.pl?*', async (route) => {
    const params = new URL(route.request().url()).searchParams
    const pageNo = params.get('page')
    hits.push({ page: pageNo, country: params.get('tag_0') })
    await route.fulfill({ json: { count: 21, products: pageNo === '1' ? [product, product,
      { ...product, code: '9990000000098', product_name: 'Ramito sin datos', nutriments: {} },
    ] : [product, { ...product, code: '9990000000097', product_name: 'Ramito relleno de prueba' }] } })
  })
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  const search = page.getByTestId('food-search')
  await search.fill('ramito')
  await expect(page.getByText('Sin resultados locales')).toBeVisible()
  expect(hits).toEqual([])
  await page.getByLabel('Solo Colombia').check()
  await page.getByRole('button', { name: 'Buscar en Open Food Facts' }).click()
  const results = page.getByTestId('food-results-online')
  await expect(results.locator('[data-food-row]')).toHaveCount(1)
  await expect(page.getByText('1 producto requiere revisar la etiqueta')).toBeVisible()
  await page.getByRole('button', { name: 'Ver más productos' }).click()
  await expect(results.locator('[data-food-row]')).toHaveCount(2)
  expect(hits).toEqual([{ page: '1', country: 'colombia' }, { page: '2', country: 'colombia' }])
  await results.getByRole('button', { name: /Ramito de prueba/ }).click()
  await expect(page.getByTestId('unit-button')).toContainText(/25 g/)
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', thumbnail)
  await page.getByRole('button', { name: '0,5', exact: true }).click()
  await expect(page.getByTestId('portion-equivalence')).toContainText('12,5 g')
  await expect(page.getByTestId('qty-preview')).toContainText('50')
  await expect(page.getByText('Datos incompletos o inconsistentes.')).toBeVisible()
  await page.getByTestId('meal-change').click()
  await page.getByTestId('chooser').getByRole('radio', { name: 'Cena', exact: true }).click()
  await page.getByTestId('save-food').click()
  await page.getByTestId('food-added-count').getByRole('link', { name: 'Ver diario' }).click()
  await expect(page.getByTestId('meal-cena')).toContainText('Ramito de prueba')
  await expect(page.getByTestId('meal-almuerzo')).not.toContainText('Ramito de prueba')
  await page.reload()
  await expect(page.getByTestId('meal-cena')).toContainText('Ramito de prueba')
  await expect(page.getByTestId('kcal-total')).toHaveText('50')

  // A later revision in the reference cache must not change the recorded snapshot.
  await page.evaluate(async (barcode) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('salud-pho')
      req.onsuccess = () => resolve(req.result)
    })
    const tx = db.transaction('refFoods', 'readwrite')
    const store = tx.objectStore('refFoods')
    const get = store.get(`off:${barcode}`)
    get.onsuccess = () => store.put({ ...get.result, nutrients: { kcal: 800 } })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }, code)
  await page.reload()
  await expect(page.getByTestId('kcal-total')).toHaveText('50')
})

clockTest('slow and unavailable remote requests leave mobile local results usable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  let release: () => void = () => {}
  const hold = new Promise<void>((resolve) => { release = resolve })
  await page.route('https://world.openfoodfacts.org/cgi/search.pl?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search_terms') === 'ramito') {
      await hold
      await route.fulfill({ json: { count: 1, products: [product] } })
    } else await route.fulfill({ status: 503, json: {} })
  })
  const input = page.getByTestId('food-search')
  await input.fill('ramito')
  await expect(page.getByText('Sin resultados locales')).toBeVisible()
  const request = page.waitForRequest('https://world.openfoodfacts.org/cgi/search.pl?*')
  await page.getByRole('button', { name: 'Buscar en Open Food Facts' }).click()
  await request
  await input.evaluate((el) => el.addEventListener('input', () => {
    performance.mark('salud-food-input')
    const observer = new MutationObserver(() => {
      if (!/chocoramo/i.test(document.querySelector('[data-testid="food-results"] [data-food-row]')?.textContent ?? '')) return
      observer.disconnect()
      performance.mark('salud-food-results')
    })
    observer.observe(document.querySelector('main')!, { childList: true, subtree: true, characterData: true })
  }, { once: true }))
  await input.fill('chocorramo')
  const row = page.getByTestId('food-results').locator('[data-food-row]').first()
  await expect(row).toContainText(/chocoramo/i)
  const elapsed = await page.evaluate(() => performance.measure('salud-food-search', 'salud-food-input', 'salud-food-results').duration)
  console.log(`FOOD_MOBILE_SEARCH ${elapsed.toFixed(0)} ms from input to DOM, CPU 4× slowdown`)
  expect(elapsed).toBeLessThan(1800)
  release()
  await expect(page.getByTestId('food-results-online')).toHaveCount(0)
  await page.getByRole('button', { name: 'Buscar en Open Food Facts' }).click()
  await expect(page.getByText('Open Food Facts no está disponible temporalmente.')).toBeVisible()
  await expect(row).toContainText(/chocoramo/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('mobile evidence of an approximate search and a quantity before logging', async ({ page }) => {
  const output = process.env.SALUD_SEARCH_EVIDENCE
  test.skip(!output, 'Set SALUD_SEARCH_EVIDENCE to capture the mobile screenshots.')
  await mkdir(output!, { recursive: true })
  await onboard(page)
  await page.goto('./#/comida/buscar?meal=almuerzo')
  await page.getByTestId('food-search').fill('chocorramo')
  const row = page.getByTestId('food-results').locator('[data-food-row]').filter({ hasText: /Tajada/ }).first()
  await expect(row).toBeVisible()
  const tip = page.getByRole('status').filter({ hasText: 'Lista para usarse sin conexión.' })
  if (await tip.isVisible()) await tip.getByRole('button', { name: 'Cerrar' }).click()
  await page.getByTestId('food-search').blur()
  await page.screenshot({ path: join(output!, '01-busqueda-movil.png'), animations: 'disabled' })
  await row.click()
  await expect(page.getByTestId('save-food')).toHaveText('Agregar a almuerzo')
  const half = page.getByRole('button', { name: '0,5', exact: true })
  await half.click()
  await expect(half).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: join(output!, '02-cantidad-movil.png'), animations: 'disabled' })
  await page.getByTestId('save-food').click()
  await page.getByTestId('food-added-count').getByRole('link', { name: 'Ver diario' }).click()
  await expect(page.getByTestId('meal-almuerzo')).toContainText(/chocoramo/i)
  await page.screenshot({ path: join(output!, '03-diario-movil.png'), animations: 'disabled' })
})
