import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, onboard, test } from './helpers'

// V4 live-session tools: plate calculator, warm-up generator, estimated 1RM. Synthetic data only.
// SHOTS_DIR=<dir> also saves screenshots (390 × 844, light and dark) for the visual check.

const SHOTS = process.env.SHOTS_DIR

async function startBarbellSession(page: Page) {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill('Barra sintética')
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill('sentadilla barra')
  await page.getByTestId('exercise-results').locator('button').first().click()
  await page.getByTestId('save-routine').click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/(?!nueva$)[^/]+$/)
  await page.goto('./#/entreno')
  await page.getByTestId('start-routine').first().click()
  await expect(page.getByTestId('live-session')).toBeVisible()
  await expect(page.getByTestId('set-row').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('exercise-block').first().getByTestId('set-row')
const kg = (row: Locator) => row.getByLabel('kg', { exact: true })

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test('plates: the set menu opens the calculator and "Usar este peso" writes the weight', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await startBarbellSession(page)
  const row = rows(page).first()
  await kg(row).fill('100')
  await row.getByRole('button', { name: /Cambiar tipo o eliminar/ }).click()
  await page.getByRole('menuitem', { name: 'Discos para este peso' }).click()
  const sheet = page.getByTestId('plate-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('plate-side')).toHaveText('Por lado: 25 + 15')
  await expect(page.getByTestId('plate')).toHaveCount(2)
  await expect(page.getByTestId('plate-stack')).toHaveAttribute('aria-label', 'Por lado: 25 + 15 kilos')
  await expect(page.getByTestId('plate-inexact')).toHaveCount(0)
  // Tap targets stay ≥ 44 px
  for (const b of [page.getByTestId('plate-use'), sheet.getByRole('button', { name: /Mi barra y mis discos/ })]) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }

  // Bar and inventory live in the profile: a 15 kg bar changes the plates, and survives a reload.
  await sheet.getByRole('button', { name: /Mi barra y mis discos/ }).click()
  await page.getByRole('radio', { name: '15 kg' }).click()
  await expect(page.getByTestId('plate-side')).toHaveText('Por lado: 25 + 15 + 2,5')
  await page.getByRole('radio', { name: '20 kg' }).click()
  await page.getByRole('button', { name: 'Menos pares de 25 kg' }).click()
  await expect(page.getByText('5 pares').first()).toBeVisible()
  await page.getByRole('button', { name: 'Más pares de 25 kg' }).click()

  // Target 61 → inexact: offers the nearest loadable weights; picking one and using it writes the weight.
  const total = sheet.getByRole('textbox', { name: 'Peso total' })
  await total.fill('61')
  await total.press('Enter')
  await expect(page.getByTestId('plate-inexact')).toBeVisible()
  await expect(page.getByTestId('plate-inexact')).toContainText('Bajar a 60 kg')
  await expect(page.getByTestId('plate-inexact')).toContainText('Subir a 62,5 kg')
  await page.getByRole('button', { name: 'Subir a 62,5 kg' }).click()
  await expect(page.getByTestId('plate-inexact')).toHaveCount(0)
  await shot(page, 'plates-360')
  await page.getByTestId('plate-use').click()
  await expect(sheet).toHaveCount(0)
  await expect(kg(row)).toHaveValue(/^62[.,]5$/)

  await page.reload()
  await expect(kg(rows(page).first())).toHaveValue(/^62[.,]5$/)
})

test('plates: only barbell exercises offer the calculator', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill('Mancuerna sintética')
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill('curl mancuerna')
  await page.getByTestId('exercise-results').locator('button').first().click()
  await page.getByTestId('save-routine').click()
  await page.goto('./#/entreno')
  await page.getByTestId('start-routine').first().click()
  const row = rows(page).first()
  await row.getByRole('button', { name: /Cambiar tipo o eliminar/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Eliminar serie' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Discos para este peso' })).toHaveCount(0)
})

test('warm-up: generates calentamiento rows before the work sets, undo removes them, volume ignores them, 1RM est. shows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startBarbellSession(page)
  const first = rows(page).first()

  // Without a working weight there is nothing to build on.
  await page.getByTestId('exercise-block').first().getByRole('button', { name: /^Opciones de/ }).click()
  await page.getByRole('menuitem', { name: 'Agregar calentamiento' }).click()
  await expect(page.getByText('Escribe el peso de la primera serie')).toBeVisible()
  await expect(rows(page)).toHaveCount(3)

  await kg(first).fill('100')
  await first.getByLabel('Reps', { exact: true }).fill('5')
  await page.getByTestId('exercise-block').first().getByRole('button', { name: /^Opciones de/ }).click()
  await page.getByRole('menuitem', { name: 'Agregar calentamiento' }).click()
  await expect(rows(page)).toHaveCount(7)
  // Warm-ups first (type letter C), then the three work rows; the typed work row kept its values.
  const kinds = rows(page).getByRole('button', { name: /Cambiar tipo o eliminar/ })
  await expect(kinds.nth(0)).toHaveText('C')
  await expect(kinds.nth(3)).toHaveText('C')
  await expect(kinds.nth(4)).toHaveText('1')
  await expect(kg(rows(page).nth(0))).toHaveValue('20')
  await expect(kg(rows(page).nth(1))).toHaveValue('40')
  await expect(kg(rows(page).nth(2))).toHaveValue('60')
  await expect(kg(rows(page).nth(3))).toHaveValue('80')
  await expect(kg(rows(page).nth(4))).toHaveValue('100')
  await shot(page, 'warmups-390-light')

  // Undo
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(kg(rows(page).first())).toHaveValue('100')

  // Add again, tick a warm-up and a work set: volume counts only the work set; e1RM from the work set.
  await page.getByTestId('exercise-block').first().getByRole('button', { name: /^Opciones de/ }).click()
  await page.getByRole('menuitem', { name: 'Agregar calentamiento' }).click()
  await expect(rows(page)).toHaveCount(7)
  await rows(page).nth(0).getByTestId('set-done').click()
  await expect(page.getByTestId('session-volume')).toHaveText('0')
  await expect(page.getByTestId('e1rm')).toHaveCount(0)
  await rows(page).nth(4).getByTestId('set-done').click()
  await expect(page.getByTestId('session-volume')).toHaveText('500')
  await expect(page.getByTestId('e1rm')).toHaveText('1RM est. 116,7 kg')

  // Persisted: the warm-ups survive a reload.
  await page.reload()
  await expect(rows(page)).toHaveCount(7)
  await expect(page.getByTestId('e1rm')).toHaveText('1RM est. 116,7 kg')
  await shot(page, 'warmups-390-after')

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, 'warmups-390-dark')
    await rows(page).nth(4).getByRole('button', { name: /Cambiar tipo o eliminar/ }).click()
    await page.getByRole('menuitem', { name: 'Discos para este peso' }).click()
    await expect(page.getByTestId('plate-sheet')).toBeVisible()
    await page.waitForTimeout(500)
    await shot(page, 'plates-390-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(300)
    await shot(page, 'plates-390-light')
  }
})

test('e1RM: no estimate above 12 reps', async ({ page }) => {
  await startBarbellSession(page)
  const first = rows(page).first()
  await kg(first).fill('50')
  await first.getByLabel('Reps', { exact: true }).fill('15')
  await first.getByTestId('set-done').click()
  await expect(first).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('e1rm')).toHaveCount(0)
})
