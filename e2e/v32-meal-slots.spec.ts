// V3.2 meal slots (Ajustes → Tiempos de comida) and how the diary follows them. Synthetic profile only.
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, logInMeal, mealMenu, onboard, test, today } from './helpers'

const SETTINGS = './#/ajustes/tiempos-de-comida'
const sections = (page: Page) => page.getByTestId('meals').locator(':scope > section')
const sectionKeys = async (page: Page) => (await sections(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).map((t) => (t ?? '').replace('meal-', ''))
const sw = (page: Page, defaultName: string) => page.getByRole('switch', { name: `Mostrar ${defaultName}` })

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const logIn = (page: Page, meal: string, qty = '100', date?: string) => logInMeal(page, meal, { qty, date })

test.describe('meal slots', () => {
  test('a new profile sees breakfast, lunch and dinner; any number from one to six can be on', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    expect(await sectionKeys(page)).toEqual(['desayuno', 'almuerzo', 'cena'])

    await page.goto(SETTINGS)
    await expect(sw(page, 'Desayuno')).toHaveAttribute('aria-checked', 'true')
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'false')
    for (const n of ['Media mañana', 'Onces', 'Otros']) await sw(page, n).click()
    await page.goto('./#/comida')
    await expect.poll(() => sectionKeys(page)).toEqual(['desayuno', 'media_manana', 'almuerzo', 'onces', 'cena', 'otro'])

    // Down to one: the last switch stays on and says why.
    await page.goto(SETTINGS)
    for (const n of ['Media mañana', 'Onces', 'Otros', 'Desayuno', 'Almuerzo']) await sw(page, n).click()
    await expect(sw(page, 'Cena')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('slot-last-note')).toContainText('al menos un tiempo')
    await sw(page, 'Cena').click({ force: true })
    await expect(sw(page, 'Cena')).toHaveAttribute('aria-checked', 'true')
    await page.goto('./#/comida')
    await expect.poll(() => sectionKeys(page)).toEqual(['cena'])
  })

  test('nothing is written until something changes; Restablecer removes the preference', async ({ page }) => {
    await onboard(page)
    const meals = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => { const q = indexedDB.open('salud-pho'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
      const rows = await new Promise<{ settings: { meals?: unknown } }[]>((res) => { const q = db.transaction('profiles').objectStore('profiles').getAll(); q.onsuccess = () => res(q.result) })
      db.close()
      return rows[0]!.settings.meals ?? null
    })
    await page.goto(SETTINGS)
    await expect(page.getByTestId('meal-slots')).toBeVisible()
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    expect(await meals()).toBeNull()
    await page.goto(SETTINGS)
    await expect(page.getByTestId('slots-reset')).toBeDisabled()
    await sw(page, 'Onces').click()
    await expect.poll(meals).not.toBeNull()
    await page.getByTestId('slots-reset').click()
    await expect.poll(meals).toBeNull()
  })

  test('compact rows: an off slot has no time control; an empty time reads «Añadir hora», a set one shows as text', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await onboard(page)
    await page.goto(SETTINGS)
    await expect(page.getByTestId('slot-time-onces')).toHaveCount(0)
    await expect(page.getByTestId('slot-desayuno')).toContainText('Añadir hora')
    await expect(page.getByTestId('slot-desayuno')).not.toContainText('--')
    await page.getByTestId('slot-time-desayuno').fill('07:30')
    await expect(page.getByTestId('slot-desayuno')).toContainText('07:30')
    await page.getByRole('button', { name: 'Quitar la hora de desayuno' }).click()
    await expect(page.getByTestId('slot-desayuno')).toContainText('Añadir hora')
    const reset = (await page.getByTestId('slots-reset').boundingBox())!
    expect(reset.y + reset.height).toBeLessThanOrEqual(800 - 62) // above the bottom navigation
  })

  test('a custom name shows everywhere a meal is named', async ({ page }) => {
    await onboard(page)
    await page.goto(SETTINGS)
    await page.getByTestId('slot-name-almuerzo').fill('Comida fuerte')
    await page.getByTestId('slot-name-almuerzo').blur()
    await expect(page.getByRole('switch', { name: 'Mostrar almuerzo' })).toBeVisible()
    await page.goto('./#/comida')
    await expect(page.getByTestId('meal-almuerzo').getByRole('heading', { name: 'Comida fuerte' })).toBeVisible()
    await expect(page.getByTestId('meal-almuerzo').getByRole('link', { name: 'Agregar a comida fuerte' })).toBeVisible()
    await page.getByTestId('meal-almuerzo').getByRole('link', { name: 'Agregar a comida fuerte' }).click()
    await expect(page.getByTestId('strip-meal')).toContainText('Comida fuerte')
    await page.getByTestId('strip-meal').click()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'Comida fuerte' })).toBeVisible()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'Almuerzo', exact: true })).toHaveCount(0)
    // An empty name goes back to the default.
    await page.goto(SETTINGS)
    await page.getByTestId('slot-name-almuerzo').fill('')
    await page.getByTestId('slot-name-almuerzo').blur()
    await page.goto('./#/comida')
    await expect(page.getByTestId('meal-almuerzo').getByRole('heading', { name: 'Almuerzo' })).toBeVisible()
  })

  test('reordering moves the sections, with the keyboard too', async ({ page }) => {
    await onboard(page)
    await page.goto(SETTINGS)
    const up = page.getByRole('button', { name: 'Subir cena' })
    await up.focus()
    await page.keyboard.press('Enter')
    await expect(up).toBeFocused()
    await page.keyboard.press('Space')
    await expect(up).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(up).toBeFocused()
    const items = page.getByTestId('meal-slots').locator(':scope > li')
    await expect(items.nth(1)).toHaveAttribute('data-testid', 'slot-cena')
    await page.goto('./#/comida')
    await expect.poll(() => sectionKeys(page)).toEqual(['desayuno', 'cena', 'almuerzo'])
  })

  test('hiding a slot that has entries keeps them visible, earlier days intact and the totals unchanged', async ({ page }) => {
    await onboard(page)
    const yesterday = addDays(today(), -1)
    await logIn(page, 'onces', '150', yesterday)
    await logIn(page, 'onces', '200')
    await page.goto('./#/comida')
    await expect(page.getByTestId('meal-onces').locator('ul > li')).toHaveCount(1)
    const kcal = (await page.getByTestId('kcal-total').innerText()).trim()
    await page.goto(SETTINGS)
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'true') // used in the last 30 days
    await sw(page, 'Onces').click()
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'false')
    await page.goto('./#/comida')
    await expect(page.getByTestId('meal-onces').locator('ul > li')).toHaveCount(1)
    expect((await page.getByTestId('kcal-total').innerText()).trim()).toBe(kcal)
    await page.goto(`./#/comida?d=${yesterday}`)
    await expect(page.getByTestId('meal-onces').locator('ul > li')).toHaveCount(1)
    // A day without entries in it no longer offers the hidden slot.
    await page.goto(`./#/comida?d=${addDays(today(), -3)}`)
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('meal-onces')).toHaveCount(0)
    // The editor of that row still lists its own (hidden) slot.
    await page.goto('./#/comida')
    await page.getByTestId('meal-onces').locator('ul > li button').first().click()
    await page.getByTestId('meal-change').click()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'Onces' })).toBeVisible()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'Media mañana' })).toHaveCount(0)
  })

  test('a template saved for a hidden slot still applies to that slot', async ({ page }) => {
    await onboard(page)
    await logIn(page, 'onces', '120')
    await page.goto('./#/comida')
    await mealMenu(page, 'onces', 'Guardar como plantilla')
    await page.getByLabel('Nombre de la plantilla').fill('Merienda de arroz')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    // Hide the slot while it has the entry, then remove the entry: the section is gone.
    await page.goto(SETTINGS)
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'true')
    await sw(page, 'Onces').click()
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'false')
    await page.goto('./#/comida')
    await page.getByTestId('meal-onces').locator('ul > li').getByRole('button', { name: /^Acciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(page.getByTestId('meal-onces')).toHaveCount(0)
    await page.goto('./#/comida/plantillas')
    await page.getByTestId('template-open').click()
    await expect(page.getByTestId('apply-template')).toContainText('onces')
    await expect(page.getByRole('radio', { name: 'Onces' })).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('apply-template').click()
    await expect(page.getByTestId('meal-onces').locator('ul > li')).toHaveCount(1)
  })

  test('export → wipe → import keeps the meal slots', async ({ page }, info) => {
    await onboard(page)
    await page.goto(SETTINGS)
    await sw(page, 'Onces').click()
    await page.getByTestId('slot-name-cena').fill('Cena liviana')
    await page.getByTestId('slot-name-cena').blur()
    await page.getByTestId('slot-time-cena').fill('19:30')
    await page.getByRole('button', { name: 'Subir cena liviana' }).click()
    await page.goto('./#/respaldo')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-profile').click()])
    const file = info.outputPath('respaldo.json')
    await download.saveAs(file)
    const json = JSON.parse(await readFile(file, 'utf8'))
    const stored = json.profiles?.[0]?.settings?.meals
    expect(stored).toBeTruthy()
    await page.evaluate(async () => {
      localStorage.clear()
      await new Promise<void>((res) => {
        const req = indexedDB.deleteDatabase('salud-pho')
        req.onsuccess = req.onerror = req.onblocked = () => res()
      })
    })
    await page.goto('./')
    await page.reload()
    await page.getByTestId('restore-link').click()
    await page.getByTestId('import-backup-file').setInputFiles(file)
    await page.getByTestId('apply-import').click()
    await expect(page.getByTestId('import-result')).toContainText('perfil(es) creados')
    await page.goto('./')
    await expect(page.getByTestId('dashboard')).toBeVisible()
    await page.goto(SETTINGS)
    await expect(page.getByTestId('slot-name-cena')).toHaveValue('Cena liviana')
    await expect(page.getByTestId('slot-time-cena')).toHaveValue('19:30')
    await expect(sw(page, 'Onces')).toHaveAttribute('aria-checked', 'true')
    await page.goto('./#/comida')
    await expect.poll(() => sectionKeys(page)).toEqual(['desayuno', 'almuerzo', 'cena', 'onces'])
  })

  test('the hour picks the active slot: a usual time wins', async ({ page }) => {
    await onboard(page)
    // Suite clock is 16:30. Default slots: lunch is the nearest active one.
    await page.goto(SETTINGS)
    await page.getByTestId('slot-time-cena').fill('17:00')
    await page.getByTestId('slot-time-almuerzo').fill('13:00')
    await page.goto('./#/comida/buscar')
    await expect(page.getByTestId('strip-meal')).toContainText('Cena')
  })
})
