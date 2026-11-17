import { expect, kcalToday, logFood, onboard, saveFood, test, chooseUnit } from './helpers'

// V1.1: label text / OCR review, exercise illustrations, adaptive energy, day marks. Synthetic data only.

const LABEL_TEXT = `INFORMACIÓN NUTRICIONAL
Tamaño por porción: 1 vaso (200 ml)
Porciones por envase: aprox. 5
                 Por 100 ml   Por porción
Calorías         62 kcal      124 kcal
Grasa total      3,2 g        6,4 g
Grasa saturada   2,0 g        4,0 g
Carbohidratos totales 4,8 g   9,6 g
Azúcares totales 4,8 g        9,6 g
Proteína         3,1 g        6,2 g
Sodio            45 mg        90 mg
Calcio           12%          24%`

test('pasted label text → review (nothing saved yet) → confirm → log by ml', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/etiqueta')
  await page.getByRole('radio', { name: 'Pegar texto' }).click()
  await page.getByTestId('label-text').fill(LABEL_TEXT)
  await page.getByTestId('parse-label').click()
  await expect(page.getByTestId('parse-review')).toContainText('Revisa los valores')
  await expect(page.getByTestId('parse-review')).toContainText('Calcio') // %VD only: not imported
  await expect(page.locator('input[name="n-kcal"]')).toHaveValue('62')
  await expect(page.locator('input[name="n-sodium"]')).toHaveValue('45')
  await expect(page.locator('input[name="n-fiber"]')).toHaveValue('') // not printed ≠ 0

  // Switching column re-fills from the per-serving values.
  await page.getByTestId('parse-review').getByRole('radio', { name: 'Por porción' }).click()
  await expect(page.locator('input[name="n-kcal"]')).toHaveValue('124')
  await page.getByTestId('parse-review').getByRole('radio', { name: 'Por 100 ml' }).click()
  await expect(page.locator('input[name="n-kcal"]')).toHaveValue('62')

  // Nothing is stored before confirming.
  await page.goto('./#/comida/buscar')
  await page.getByTestId('food-search').fill('Leche sintética')
  await expect(page.getByTestId('food-results')).toHaveCount(0)

  await page.goto('./#/comida/etiqueta')
  await page.getByRole('radio', { name: 'Pegar texto' }).click()
  await page.getByTestId('label-text').fill(LABEL_TEXT)
  await page.getByTestId('parse-label').click()
  await page.getByLabel('Nombre del producto').fill('Leche sintética')
  await page.getByTestId('save-label').click()
  await page.getByTestId('log-label-food').click()
  await chooseUnit(page, 'ml')
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('250')
  await saveFood(page)
  expect(await kcalToday(page)).toBe('155') // 62 kcal/100 ml × 2,5
})

test('photo OCR unavailable is explained; manual values and pasted text stay usable', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/comida/etiqueta')
  await expect(page.getByRole('radio', { name: 'Foto' })).toHaveCount(0)
  await expect(page.getByTestId('photo-ocr-unavailable')).toContainText('precisión verificada')
  await expect(page.getByLabel('Nombre del producto')).toBeVisible()
  await page.getByLabel('Nombre del producto').fill('Producto sintético')
  await page.locator('input[name="n-kcal"]').fill('120')
  await expect(page.locator('input[name="n-kcal"]')).toHaveValue('120')
  await page.getByRole('radio', { name: 'Pegar texto' }).click()
  const text = page.getByTestId('label-text')
  await text.fill('Calorías 120 kcal\nProteína 3 g')
  await page.getByTestId('parse-label').click()
  await expect(page.getByTestId('parse-review')).toBeVisible()
  await expect(page.locator('input[name="n-kcal"]')).toHaveValue('120')
  await expect(page.locator('input[name="n-protein"]')).toHaveValue('3')
  await page.locator('input[name="n-protein"]').fill('3,5')
  await expect(page.locator('input[name="n-protein"]')).toHaveValue('3,5')
})

test('exercise detail shows RepDB poses with credit, or a fallback when there is no verified image', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-search').fill('plancha')
  await expect(page.getByTestId('exercise-results').getByTestId('exercise-thumb').first()).toBeVisible()
  await page.getByTestId('exercise-results').getByRole('link', { name: /^Plancha/ }).first().click()
  await expect(page.getByTestId('exercise-illustration')).toBeVisible()
  await expect(page.getByTestId('exercise-illustration').getByRole('link', { name: 'Exercise data by RepDB (repdb.co)' })).toHaveAttribute('href', 'https://repdb.co')
  await page.goBack()

  await page.getByTestId('exercise-search').fill('gusano')
  await page.getByTestId('exercise-results').getByRole('link').first().click()
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await expect(page.getByTestId('exercise-tile')).toBeVisible()

  await page.goto('./#/ajustes')
  // Credits live inside "Avanzado" (V3.1): open it first.
  await page.getByTestId('settings-advanced').getByText('Avanzado', { exact: true }).click()
  await expect(page.getByTestId('repdb-credit')).toContainText('Exercise data by RepDB (repdb.co)')
})

test('adaptive energy is off by default; automatic mode needs explicit confirmation', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/perfil')
  const card = page.getByTestId('adaptive-energy')
  await expect(card).toContainText('Adaptación energética')
  await expect(card.getByRole('radio', { name: 'Desactivado' })).toHaveAttribute('aria-checked', 'true')
  await expect(card).toContainText('Datos insuficientes')
  await card.getByRole('radio', { name: 'Automático' }).click()
  await expect(page.getByRole('dialog')).toContainText('¿Activar el ajuste automático?')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(card.getByRole('radio', { name: 'Desactivado' })).toHaveAttribute('aria-checked', 'true')
  await card.getByRole('radio', { name: 'Automático' }).click()
  await page.getByTestId('adaptive-auto-confirm').click()
  await expect(card.getByRole('radio', { name: 'Automático' })).toHaveAttribute('aria-checked', 'true')
  await expect(card).toContainText('no mide tu metabolismo')
})

test('a day can be marked complete or incomplete in the diary', async ({ page }) => {
  await onboard(page)
  await logFood(page, 'arroz cocido', '100')
  const mark = page.getByTestId('day-complete')
  await mark.getByRole('radio', { name: 'Completo', exact: true }).click()
  await expect(mark.getByRole('radio', { name: 'Completo', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true }).click()
  await expect(page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true })).toHaveAttribute('aria-checked', 'false')
})
