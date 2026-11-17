import { chooseUnit, expect, kcalToday, logFood, mealMenu, onboard, saveFood, test, unitChoices, withFilters } from './helpers'

test('logs a catalog food by weight with correct scaling', async ({ page }) => {
  await onboard(page)
  await logFood(page, 'arroz cocido', '150')
  expect(await kcalToday(page)).toBe('195') // 130 kcal/100 g × 1,5
  await expect(page.getByTestId('meal-desayuno')).toContainText('150 g')
})

test('label per 100 g converts and logs by grams; per serving without size logs by servings only', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/etiqueta')
  await page.getByLabel('Nombre del producto').fill('Yogur sintético')
  await page.getByText('Por 100 g', { exact: true }).click()
  await page.locator('input[name="n-kcal"]').fill('60')
  await page.locator('input[name="n-protein"]').fill('5')
  await page.getByTestId('save-label').click()
  await page.getByTestId('log-label-food').click()
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('200')
  await saveFood(page)
  expect(await kcalToday(page)).toBe('120')

  await page.goto('./#/comida/etiqueta')
  await page.getByLabel('Nombre del producto').fill('Galleta sintética')
  await page.getByText('Por porción', { exact: true }).click()
  await page.locator('input[name="n-kcal"]').fill('150')
  await page.getByTestId('save-label').click()
  await page.getByTestId('log-label-food').click()
  // a label food logged by serving offers that one measure, nothing else
  const choices = await unitChoices(page)
  expect(choices).toHaveLength(1)
  expect(choices[0]).toMatch(/porci/i)
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('2')
  await saveFood(page)
  expect(await kcalToday(page)).toBe('420')
})

test('creates a recipe from weighed ingredients and logs one serving', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/recetas/nueva')
  await page.getByLabel('Nombre').fill('Arroz sintético')
  await page.getByLabel('Porciones').fill('2')
  await page.getByTestId('add-ingredient').click()
  await page.getByTestId('food-search').fill('arroz cocido')
  await page.getByTestId('food-results').locator('button').first().click()
  await chooseUnit(page, 'g')
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('300')
  await page.getByTestId('save-food').click()
  await page.getByTestId('save-recipe').click()
  await expect(page).toHaveURL(/recetas\/[0-9a-f-]{36}/)
  await page.getByTestId('log-recipe').click()
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('1')
  await saveFood(page)
  expect(await kcalToday(page)).toBe('195') // 390 kcal / 2 porciones
})

test('saves a meal as template and applies it on another day', async ({ page }) => {
  await onboard(page)
  await logFood(page, 'arroz cocido', '100')
  await page.goto('./#/comida')
  await mealMenu(page, 'desayuno', 'Guardar como plantilla')
  await page.getByLabel('Nombre de la plantilla').fill('Desayuno base')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()

  await page.goto('./#/comida?d=2026-01-05')
  await mealMenu(page, 'almuerzo', 'Aplicar plantilla')
  await page.getByRole('button', { name: /Desayuno base/ }).click()
  await expect(page.getByTestId('kcal-total')).toHaveText('130')
})

test('searches the bundled Open Food Facts snapshot offline-first', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/buscar')
  await withFilters(page, (sheet) => sheet.getByRole('radio', { name: 'Empacados' }).click())
  await page.getByTestId('food-search').fill('yogurt')
  await expect(page.getByTestId('food-results').locator('button').first()).toBeVisible()
})
