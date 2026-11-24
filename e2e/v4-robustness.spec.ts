// V4 robustness: error boundary on a failed lazy chunk, single-value habits, single day-complete mark.
import type { Page } from '@playwright/test'
import { clockTest, expect, logFood, onboard, test } from './helpers'

/** Rows of one Dexie table straight from IndexedDB (synthetic data only). */
async function rows(page: Page, table: string): Promise<{ id: string; [k: string]: unknown }[]> {
  return page.evaluate(
    (t) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('salud-pho')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const req = open.result.transaction(t, 'readonly').objectStore(t).getAll()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }
      }),
    table,
  )
}

// A chunk that cannot be fetched (what an app update leaves behind: the old hashed file 404s).
clockTest.describe('failed lazy chunk', () => {
  clockTest.use({ serviceWorkers: 'block' })

  clockTest('reloads once on its own, then shows a calm fallback with Reintentar, Recargar and Respaldo', async ({ page }) => {
    // Onboard with the chunk available, then break it.
    await onboard(page)
    let attempts = 0
    await page.route('**/assets/SettingsPage-*.js', (route) => {
      attempts++
      return route.abort('failed')
    })
    let navigations = 0
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigations++
    })
    await page.goto('./#/ajustes')
    const fallback = page.getByTestId('error-fallback')
    await expect(fallback).toBeVisible({ timeout: 20_000 })
    await expect(fallback).toContainText('Algo no salió bien')
    await expect(fallback.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(fallback.getByRole('button', { name: 'Recargar' })).toBeVisible()
    await expect(fallback.getByRole('link', { name: 'Ir a Respaldo' })).toHaveAttribute('href', '#/respaldo')
    // Exactly one automatic reload (the loop guard stopped the second one): two fetch attempts.
    expect(attempts).toBe(2)
    const settled = navigations
    await page.waitForTimeout(1500)
    expect(navigations).toBe(settled)

    // The way out works: Respaldo opens (the boundary resets on navigation) and the rest of the app is intact.
    await fallback.getByRole('link', { name: 'Ir a Respaldo' }).click()
    await expect(page).toHaveURL(/#\/respaldo$/)
    await expect(fallback).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Datos y respaldos' }).first()).toBeVisible()

    // Once the chunk is reachable again, Recargar brings the screen back.
    await page.unroute('**/assets/SettingsPage-*.js')
    await page.goto('./#/ajustes')
    await page.reload()
    await expect(page.getByTestId('error-fallback')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Ajustes/ }).first()).toBeVisible()
  })
})

test.describe('one value per day', () => {
  test('a double tap on a habit leaves a single row with a deterministic id', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/habitos')
    await page.getByTestId('new-habit').click()
    await page.getByLabel('Nombre').fill('Vasos de agua')
    await page.getByLabel('Meta diaria').fill('8')
    await page.getByTestId('save-habit').click()
    const more = page.getByRole('button', { name: 'Más Vasos de agua' })
    await more.dblclick()
    await expect(page.getByTestId('habit-list')).toContainText(/[12]\/8/)
    await expect.poll(async () => (await rows(page, 'habitLogs')).length).toBe(1)
    const [log] = await rows(page, 'habitLogs')
    expect(String(log!.id)).toContain('|habitlog:')
    // The screen shows exactly the stored value, never a sum of rows.
    await expect(page.getByTestId('habit-list')).toContainText(`${log!.value}/8`)
    await more.click()
    await expect.poll(async () => (await rows(page, 'habitLogs')).length).toBe(1)
  })

  test('toggling the day-complete mark repeatedly keeps one mark', async ({ page }) => {
    await onboard(page)
    await logFood(page, 'arroz cocido', '100')
    const mark = page.getByTestId('day-complete')
    const complete = mark.getByRole('radio', { name: 'Completo', exact: true })
    const incomplete = mark.getByRole('radio', { name: 'Incompleto', exact: true })
    await complete.dblclick()
    await incomplete.dblclick()
    await expect.poll(async () => (await rows(page, 'dayMarks')).length).toBeLessThanOrEqual(1)
    await complete.click()
    await expect(complete).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => (await rows(page, 'dayMarks')).length).toBe(1)
    const [m] = await rows(page, 'dayMarks')
    expect(String(m!.id)).toContain('|daymark:')
    await page.reload()
    await expect(page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true })).toHaveAttribute('aria-checked', 'true')
  })
})
