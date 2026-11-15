import { readFile } from 'node:fs/promises'
import { ANA, expect, switcher, kcalToday, logFood, onboard, test } from './helpers'

test('export → wipe all data → import restores the profile', async ({ page }, info) => {
  await onboard(page)
  await logFood(page, 'arroz cocido', '150')
  await page.goto('./#/respaldo')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-profile').click()])
  const file = info.outputPath('respaldo.json')
  await download.saveAs(file)
  const json = JSON.parse(await readFile(file, 'utf8'))
  expect(json.format).toBe('pho-backup')
  expect(json.tables.foodLogs).toHaveLength(1)

  // Wipe: delete the IndexedDB database and local settings.
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase('salud-pho')
      req.onsuccess = req.onerror = req.onblocked = () => res()
    })
  })
  await page.goto('./')
  await page.reload()
  await expect(page.getByTestId('restore-link')).toBeVisible()
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles(file)
  await expect(page.getByTestId('import-target')).toHaveValue('new')
  await page.getByTestId('apply-import').click()
  await expect(page.getByTestId('import-result')).toContainText('1 perfil(es) creados')
  await page.goto('./')
  await expect(switcher(page)).toContainText(ANA.name)
  expect(await kcalToday(page)).toBe('195')
})

test('works offline after the first load (service worker)', async ({ page, context }) => {
  await onboard(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // Wait until the service worker controls the page (precache done).
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await logFood(page, 'arroz cocido', '100')
  expect(await kcalToday(page)).toBe('130')
  await context.setOffline(false)
})

test('progress and dashboard render only real data', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/progreso')
  // Only the onboarding weight exists: weight chart needs 2 points, so nothing is drawn.
  await expect(page.getByText('Sin datos suficientes en este periodo.').first()).toBeVisible()
  await page.goto('./')
  await expect(page.getByTestId('tile-weight')).toContainText('60')
})
