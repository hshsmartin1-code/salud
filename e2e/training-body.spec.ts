import { expect, onboard, test } from './helpers'

test('routine → live session with sets → PR → finished session in history', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill('Pierna sintética')
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill('sentadilla barra')
  await page.getByTestId('exercise-results').locator('button').first().click()
  await page.getByTestId('save-routine').click()
  await page.getByTestId('start-routine').click()
  await expect(page.getByTestId('set-row')).toHaveCount(3)

  const rows = page.getByTestId('set-row')
  await rows.nth(0).getByLabel('kg').fill('60')
  await rows.nth(0).getByLabel('Reps').fill('8')
  await rows.nth(0).getByTestId('set-done').click()
  await expect(page.getByTestId('rest-timer')).toBeVisible()
  await expect(rows.nth(1).getByLabel('kg')).toHaveValue('60') // prefilled from the set just done
  await rows.nth(1).getByLabel('kg').fill('65')
  await rows.nth(1).getByTestId('set-done').click()
  await expect(page.getByTestId('pr-badge')).toHaveCount(1)
  await expect(page.getByTestId('session-volume')).toHaveText('1.000')

  page.once('dialog', (d) => void d.accept())
  await page.getByTestId('finish-session').click()
  await expect(page.getByTestId('set-row')).toHaveCount(2)
  await page.goto('./#/entreno')
  await expect(page.getByText('2 series · 1.000 kg')).toBeVisible()
})

test('body measurement with skinfolds stores an estimated result apart from raw data', async ({ page }) => {
  await onboard(page) // Ana: female, birth date set
  await page.goto('./#/cuerpo/nueva')
  await page.getByLabel('Peso', { exact: true }).fill('61,2')
  await page.getByLabel('Cintura').fill('70')
  await page.getByTestId('toggle-skinfolds').click()
  await page.getByLabel('Protocolo').selectOption('jp3_female')
  await page.getByLabel('Tríceps').fill('15')
  await page.getByLabel('Cresta ilíaca (suprailíaco)').fill('12')
  await page.getByLabel('Muslo anterior').fill('20')
  const result = page.getByTestId('bodycomp-result')
  await expect(result).toContainText('Estimado')
  await expect(result).toContainText('Suma: 47 mm')
  await page.getByTestId('save-measurement').click()
  await expect(page.getByTestId('measurement-list')).toContainText('61,2 kg')
  await expect(page.getByTestId('measurement-list')).toContainText('% grasa (estimado)')
})
