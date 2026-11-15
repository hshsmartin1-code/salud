import { expect, test as base, type Page } from '@playwright/test'

/** Fails the test on any console error or uncaught page error. Synthetic data only. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export interface TestProfile {
  name: string
  sex: 'Hombre' | 'Mujer'
  birth: string
  height: string
  weight: string
  goal?: 'Perder grasa' | 'Mantener' | 'Ganar masa' | 'Recomposición'
}

export const ANA: TestProfile = { name: 'Ana Prueba', sex: 'Mujer', birth: '1994-04-10', height: '165', weight: '60', goal: 'Mantener' }
export const BETO: TestProfile = { name: 'Beto Prueba', sex: 'Hombre', birth: '1990-08-20', height: '178', weight: '80', goal: 'Perder grasa' }

/** Fills the basics + goal steps of the onboarding (first run or "nuevo perfil"). */
export async function fillProfile(page: Page, p: TestProfile) {
  await page.getByLabel('Nombre', { exact: true }).fill(p.name)
  await page.getByText(p.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(p.birth)
  await page.getByLabel('Estatura').fill(p.height)
  await page.getByLabel('Peso actual').fill(p.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await page.getByRole('button', { name: 'Continuar' }).click()
  if (p.goal) {
    await page.getByRole('button', { name: p.goal }).click()
    await page.getByRole('button', { name: 'Guardar y continuar' }).click()
  } else {
    await page.getByRole('button', { name: /Omitir|Ahora no|Saltar/ }).click()
  }
}

/** First run: creates one or two profiles and lands on the dashboard. */
export async function onboard(page: Page, first: TestProfile = ANA, second?: TestProfile) {
  await page.goto('./')
  await fillProfile(page, first)
  if (second) {
    await page.getByRole('button', { name: /Agregar segundo perfil/ }).click()
    await fillProfile(page, second)
  }
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
}

/** The visible profile switcher (top bar on mobile, sidebar on desktop). */
export const switcher = (page: Page) => page.getByTestId('profile-switcher').filter({ visible: true })

export async function switchProfile(page: Page, name: string) {
  await switcher(page).click()
  await page.getByRole('button', { name }).click()
  await expect(switcher(page)).toContainText(name)
}

/** Searches the catalog and logs `grams` of the first result into today's breakfast. */
export async function logFood(page: Page, query: string, qty: string) {
  await page.goto('./#/comida/buscar?meal=desayuno')
  await page.getByTestId('food-search').fill(query)
  await page.getByTestId('food-results').locator('button').first().click()
  const qtyField = page.getByRole('textbox', { name: 'Cantidad' })
  await qtyField.fill(qty)
  await saveFood(page)
}

/** Clicks "Registrar" in the quantity sheet and waits for the app to return to the day view. */
export async function saveFood(page: Page) {
  await page.getByTestId('save-food').click()
  await expect(page).toHaveURL(/#\/comida(\?.*)?$/)
  await expect(page.getByTestId('day-summary')).toBeVisible()
}

export async function kcalToday(page: Page): Promise<string> {
  await page.goto('./#/comida')
  return (await page.getByTestId('kcal-total').textContent())?.trim() ?? ''
}
