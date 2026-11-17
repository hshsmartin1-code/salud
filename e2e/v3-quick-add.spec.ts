// The universal "+" ("Registrar") sheet: in-place logs that keep the route, food for the meal of the hour,
// training in one tap, every entry reachable, keyboard and 360 px.
// Uses the synthetic demo seed (src/test/seed/demoSeed.ts) restored through the app's own import flow.
import type { Page } from '@playwright/test'
import { clickUndo, clockTime, demoJson, expect, test } from './helpers'

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

/** Rows of a table (all profiles; the demo has one), optionally filtered by status. */
const countRows = (page: Page, table: string, status?: string) =>
  page.evaluate(
    ([t, st]) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('salud-pho')
        req.onsuccess = () => {
          const all = req.result.transaction(t!).objectStore(t!).getAll()
          all.onsuccess = () => resolve((all.result as { status?: string }[]).filter((x) => !st || x.status === st).length)
          all.onerror = () => reject(all.error)
        }
        req.onerror = () => reject(req.error)
      }),
    [table, status] as const,
  )

/** Same rule as defaultMeal() in src/features/nutrition/food.ts, on Bogotá time. */
function expectedMeal(): string {
  const [h, m] = clockTime().split(':').map(Number)
  const t = h! * 60 + m!
  if (t < 10 * 60 + 30) return 'desayuno'
  if (t < 12 * 60) return 'media_manana'
  if (t < 15 * 60) return 'almuerzo'
  if (t < 18 * 60 + 30) return 'onces'
  if (t < 22 * 60) return 'cena'
  return 'otro'
}

const plus = (page: Page) => page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Registrar' })
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Registrar', exact: true })
async function openPlus(page: Page) {
  await plus(page).click()
  await expect(sheet(page)).toBeVisible()
  await expect(page.getByTestId('plus-training')).toBeEnabled() // training choice loaded
}

test.describe('"+" quick-log sheet with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
  })

  test('water chip logs exactly one row in two taps, stays on /salud, and Deshacer removes exactly it', async ({ page }) => {
    await page.goto('./#/salud')
    await expect(page.getByTestId('hub-panels')).toBeVisible()
    const base = await countRows(page, 'hydrationLogs')
    await plus(page).click() // tap 1
    await page.getByTestId('plus-water-250').click() // tap 2
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.locator('.toast-host')).toContainText('+250 ml de agua')
    await expect(page).toHaveURL(/#\/salud$/)
    await expect.poll(() => countRows(page, 'hydrationLogs')).toBe(base + 1)
    await clickUndo(page)
    await expect.poll(() => countRows(page, 'hydrationLogs')).toBe(base)
    await expect(page).toHaveURL(/#\/salud$/)
  })

  test('from /comida, Peso opens the weight sheet and saving keeps the route', async ({ page }) => {
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    const base = await countRows(page, 'bodyMeasurements')
    await openPlus(page)
    await page.getByTestId('plus-weight').click()
    const weight = page.getByRole('dialog', { name: 'Registrar peso' })
    await expect(weight).toBeVisible()
    await expect(sheet(page)).toHaveCount(0)
    await weight.getByTestId('quick-save').click()
    await expect(weight).toHaveCount(0)
    await expect(page.locator('.toast-host')).toContainText('Peso guardado')
    await expect(page).toHaveURL(/#\/comida$/)
    await expect.poll(() => countRows(page, 'bodyMeasurements')).toBe(base + 1)
  })

  test('Comida lands on the search for the meal of the hour, today', async ({ page }) => {
    await page.goto('./#/salud')
    await openPlus(page)
    const meal = expectedMeal()
    await page.getByTestId('plus-meal').click()
    await expect(page).toHaveURL(new RegExp(`#/comida/buscar\\?meal=${meal}$`))
    await expect(page.getByTestId('food-search')).toBeVisible()
  })

  test('Entrenamiento starts the habitual routine in one tap, then continues it without a second session', async ({ page }) => {
    await page.goto('./#/comida')
    await openPlus(page)
    const training = page.getByTestId('plus-training')
    await expect(training).toHaveAttribute('data-mode', 'start')
    await expect(training).toContainText('Iniciar')
    await training.click() // the one tap after "+"
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    await expect(page.getByTestId('set-row').first()).toBeVisible()
    const url = page.url()
    // In focus mode the "+" is hidden: the sheet cannot be opened over the live session on mobile.
    await expect(plus(page)).toHaveCount(0)

    await page.goto('./#/salud')
    await openPlus(page)
    await expect(training).toHaveAttribute('data-mode', 'continue')
    await expect(training).toContainText('Continuar')
    await training.click()
    expect(page.url()).toBe(url)
    expect(await countRows(page, 'trainingSessions', 'active')).toBe(1)
  })

  test('every entry opens a sheet or an existing route', async ({ page }) => {
    await page.goto('./#/salud')
    await openPlus(page)
    const sheetIds = ['plus-water-other', 'plus-weight', 'plus-sleep', 'plus-bloodPressure', 'plus-glucose', 'plus-activity', 'plus-vital']
    for (const id of sheetIds) {
      await page.getByTestId(id).click()
      await expect(sheet(page)).toHaveCount(0)
      const opened = page.getByRole('dialog')
      await expect(opened).toHaveCount(1)
      await expect(opened.getByRole('heading').first()).toHaveText(/\S/)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page).toHaveURL(/#\/salud$/)
      await openPlus(page)
    }
    await page.keyboard.press('Escape')

    const navIds = ['plus-meal', 'plus-barcode', 'plus-choose-routine']
    await openPlus(page)
    const linkTargets = await page.getByTestId('plus-link').evaluateAll((els) => els.map((e) => e.getAttribute('data-to') ?? ''))
    expect(linkTargets.length).toBeGreaterThanOrEqual(4)
    await page.keyboard.press('Escape')
    const all: { id: string; nth?: number }[] = [...navIds.map((id) => ({ id })), ...linkTargets.map((_, nth) => ({ id: 'plus-link', nth }))]
    for (const e of all) {
      await page.goto('./#/salud')
      await openPlus(page)
      const el = e.nth === undefined ? page.getByTestId(e.id) : page.getByTestId(e.id).nth(e.nth)
      await el.click()
      await expect(page).not.toHaveURL(/#\/salud$/)
      await expect(page.getByText('Esta página no existe')).toHaveCount(0)
      await expect(page.locator('main')).not.toBeEmpty()
      await expect(page.locator('main h1, main h2, [role=dialog] h2').first()).toBeVisible()
    }
  })

  test('Escape closes the sheet and returns focus to "+"', async ({ page }) => {
    await page.goto('./#/comida')
    await plus(page).focus()
    await plus(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    await expect(plus(page)).toBeFocused()
  })

  test('no horizontal overflow at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' }) // the sheet appears without its slide-in
    await page.goto('./#/salud')
    await openPlus(page)
    const over = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]') as HTMLElement
      const s = d.querySelector('.sheet-scroll') as HTMLElement
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, sheet: s.scrollWidth - s.clientWidth, width: d.getBoundingClientRect().width }
    })
    expect(over.page).toBeLessThanOrEqual(0)
    expect(over.sheet).toBeLessThanOrEqual(0)
    expect(over.width).toBeLessThanOrEqual(360)
    // Every target in the sheet is at least 44 px high.
    const small = await sheet(page).locator('button, a').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetHeight < 44).map((e) => e.getAttribute('aria-label') ?? e.textContent))
    expect(small).toEqual([])
  })
})
