import { readFile } from 'node:fs/promises'
import { ANA, BETO, chooseUnit, expect, kcalToday, onboard, saveFood, switchProfile, test } from './helpers'

async function openRice(page: import('@playwright/test').Page) {
  await page.goto('./#/comida/buscar?meal=desayuno')
  await page.getByTestId('food-search').fill('arroz cocido')
  await page.getByTestId('food-results').locator('button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // "Mi medida" is folded away: the measures of this food are one tap away
  await page.getByTestId('detail-my-measure').locator('summary').click()
}

async function addMeasure(page: import('@playwright/test').Page, label = 'Mi cuchara') {
  await page.getByTestId('custom-portion-toggle').click()
  await page.getByLabel('Nombre de la medida').fill(label)
  await page.getByLabel('Equivalencia en gramos').fill('80')
  await page.getByTestId('custom-portion-save').click()
  await expect(page.getByTestId('custom-portion-row')).toContainText(`${label} = 80 g`)
  await expect(page.getByTestId('unit-button')).toContainText(label)
  await expect(page.getByTestId('portion-equivalence')).toContainText('80 g')
}

test('custom food measure scales a snapshot and remains isolated by profile', async ({ page }) => {
  await onboard(page, ANA, BETO)
  await switchProfile(page, ANA.name)
  await openRice(page)
  await addMeasure(page)
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('2')
  await expect(page.getByTestId('portion-equivalence')).toContainText('160 g')
  await saveFood(page)
  expect(await kcalToday(page)).toBe('208') // 130 kcal/100 g × 160 g

  await openRice(page)
  await page.getByRole('button', { name: 'Editar medida Mi cuchara' }).click()
  await page.getByLabel('Equivalencia en gramos').fill('90')
  await page.getByTestId('custom-portion-save').click()
  await expect(page.getByTestId('custom-portion-row')).toContainText('Mi cuchara = 90 g')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  expect(await kcalToday(page)).toBe('208') // previous log keeps its recorded nutrients

  await switchProfile(page, BETO.name)
  await openRice(page)
  await expect(page.getByTestId('custom-portion-row')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  await switchProfile(page, ANA.name)
  await openRice(page)
  await expect(page.getByTestId('custom-portion-row')).toContainText('Mi cuchara = 90 g')
  await page.getByRole('button', { name: 'Eliminar medida Mi cuchara' }).click()
  await expect(page.getByTestId('custom-portion-row')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  expect(await kcalToday(page)).toBe('208')
})

test('profile backup restores a custom measure', async ({ page }, info) => {
  await onboard(page)
  await openRice(page)
  await addMeasure(page, 'Mi taza pequeña')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  await page.goto('./#/respaldo')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-profile').click()])
  const file = info.outputPath('respaldo-porciones.json')
  await download.saveAs(file)
  const backup = JSON.parse(await readFile(file, 'utf8'))
  expect(backup.tables.foodPortions).toHaveLength(1)
  expect(backup.tables.foodPortions[0].label).toBe('Mi taza pequeña')

  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('salud-pho')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.goto('./')
  await page.reload()
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles(file)
  await page.getByTestId('apply-import').click()
  await expect(page.getByTestId('import-result')).toContainText('1 perfil(es) creados')
  await page.goto('./')
  await openRice(page)
  await expect(page.getByTestId('custom-portion-row')).toContainText('Mi taza pequeña = 80 g')
})

test('a source household measure accepts a fraction and logs its exact gram equivalent', async ({ page }) => {
  await onboard(page)
  await openRice(page)
  await chooseUnit(page, /(.*g)/) // the first household measure, "taza (…)"
  await expect(page.getByTestId('unit-button')).not.toHaveText('g')
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('0,5')
  const equivalence = page.getByTestId('portion-equivalence')
  await expect(equivalence).toContainText('0,5 ×')
  await page.getByTestId('detail-source').locator('summary').click()
  await expect(page.getByTestId('portion-source')).toContainText('de la fuente')
  const grams = Number((await equivalence.innerText()).match(/=\s*([\d.,]+)\s*g/)![1]!.replace(/\./g, '').replace(',', '.'))
  expect(grams).toBeGreaterThan(0)
  await saveFood(page)
  expect(await kcalToday(page)).toBe(String(Math.round((130 * grams) / 100))) // 130 kcal/100 g
})
