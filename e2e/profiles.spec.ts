import { ANA, BETO, expect, switcher, kcalToday, logFood, onboard, switchProfile, test } from './helpers'

test('creates two independent profiles with calculated, visible targets', async ({ page }) => {
  await onboard(page, ANA, BETO)
  // The last created profile is active; its goal method is shown on the profile page.
  await page.goto('./#/perfil')
  // The formula lives inside the closed "Cómo calculamos tus objetivos" disclosure (V3.1).
  await page.getByTestId('goal-method-card').getByText('Cómo calculamos tus objetivos').click()
  await expect(page.getByText(/Mifflin/).filter({ visible: true }).first()).toBeVisible()

  await switchProfile(page, ANA.name)
  await page.goto('./#/perfil')
  await expect(page.getByText(ANA.name).filter({ visible: true }).first()).toBeVisible()
})

test('switching profiles changes dashboard, logs and history; data persists after reload', async ({ page }) => {
  await onboard(page, ANA, BETO)
  await switchProfile(page, ANA.name)
  await logFood(page, 'arroz cocido', '150')
  expect(await kcalToday(page)).toBe('195')

  await switchProfile(page, BETO.name)
  expect(await kcalToday(page)).toBe('0')
  await page.goto('./#/cuerpo')
  await expect(page.getByTestId('latest-weight')).toContainText('80')

  await switchProfile(page, ANA.name)
  await page.goto('./#/cuerpo')
  await expect(page.getByTestId('latest-weight')).toContainText('60')

  await page.reload()
  expect(await kcalToday(page)).toBe('195')
  await expect(switcher(page)).toContainText(ANA.name)
})
