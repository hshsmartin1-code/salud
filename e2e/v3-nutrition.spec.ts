import type { Locator, Page } from '@playwright/test'
import { chooseUnit, expect, kcalToday, onboard, setKeepAdding, test, today, withFilters } from './helpers'

/** A date `n` days away from another (UTC noon arithmetic: no DST surprises). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Counts every deliberate tap so the tests state how many taps a flow costs. */
function counter() {
  let n = 0
  return {
    tap: async (l: Locator) => {
      n++
      await l.click()
    },
    get count() {
      return n
    },
  }
}

/** Logs 150 g of the first "arroz cocido" result (130 kcal/100 g) into `meal` of `date`, through the real flow. */
async function logRice(page: Page, date: string, meal = 'desayuno', grams = '150') {
  await page.goto(`./#/comida/buscar?d=${date}&meal=${meal}`)
  await page.getByTestId('food-search').fill('arroz cocido')
  await page.getByTestId('food-results').locator('button').first().click()
  await chooseUnit(page, 'g')
  await page.getByRole('textbox', { name: 'Cantidad' }).fill(grams)
  await page.getByTestId('save-food').click()
  await expect(page.getByTestId('food-added-count')).toBeVisible()
}

/**
 * "Deshacer" in the toast. The first-run "lista sin conexión" note of the service worker can sit over it for
 * 5 s in the preview build, so the click is dispatched on the button itself instead of at its coordinates.
 */
const undo = (page: Page) => ({ click: () => page.getByRole('button', { name: 'Deshacer' }).dispatchEvent('click') })
const diaryKcal = (page: Page) => page.getByTestId('kcal-total')

test.describe('one-tap logging', () => {
  test('a food logged once yesterday is not offered as a chip under any meal (owner decision, 3.2)', async ({ page }) => {
    await onboard(page)
    await logRice(page, addDays(today(), -1))
    await page.goto('./#/comida')
    await expect(diaryKcal(page)).toHaveText('0')
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(page.getByTestId('slot-habits')).toHaveCount(0)
    await expect(page.locator('[data-testid^="suggest-"]')).toHaveCount(0)
  })

  test('copying the previous meal is one confirmation with Deshacer; nothing is offered inside the empty meal', async ({ page }) => {
    await onboard(page)
    await logRice(page, addDays(today(), -1))
    await page.goto('./#/comida')
    await expect(page.getByTestId('repeat-desayuno')).toHaveCount(0)
    await page.getByTestId('meal-desayuno').getByRole('button', { name: /^Opciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Copiar comida anterior' }).click()
    await expect(page.getByTestId('copy-meal-save')).toHaveText('Copiar 1 alimento')
    const taps = counter()
    await taps.tap(page.getByTestId('copy-meal-save'))
    await expect(diaryKcal(page)).toHaveText('195')
    expect(taps.count).toBe(1)
    await undo(page).click()
    await expect(diaryKcal(page)).toHaveText('0')
  })

  test('from the search it is 2 taps (meal "+" then the row "+"), the list stays open and Deshacer restores', async ({ page }) => {
    await onboard(page)
    await logRice(page, addDays(today(), -1))
    await page.goto('./#/comida')
    const taps = counter()
    await taps.tap(page.getByRole('link', { name: 'Agregar a desayuno' }))
    await expect(page.getByTestId('food-recent')).toBeVisible()
    const add = page.getByRole('button', { name: 'Agregar 150 g de Arroz blanco cocido' })
    await expect(page.getByTestId('budget-strip')).toBeVisible()
    await taps.tap(add)
    expect(taps.count).toBe(2)
    await expect(page.getByTestId('food-added-count')).toContainText('1 alimento registrado')
    await expect(page).toHaveURL(/#\/comida\/buscar/) // the list stays open
    await expect(add).toBeVisible()
    await expect(page.getByTestId('budget-text')).toContainText('kcal')

    await undo(page).click()
    await expect(page.getByTestId('food-added-count')).toHaveCount(0)
    expect(await kcalToday(page)).toBe('0')
  })

  test('a row without a previous quantity has no "+": it opens the quantity sheet', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar?meal=desayuno')
    await page.getByTestId('food-search').fill('arroz cocido')
    await expect(page.getByTestId('food-results').locator('button').first()).toBeVisible()
    await expect(page.getByTestId('quick-add')).toHaveCount(0)
    await page.getByTestId('food-results').locator('button').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('a past date (?d=) receives the log, not today', async ({ page }) => {
    await onboard(page)
    const past = addDays(today(), -3)
    await logRice(page, addDays(today(), -5))
    await page.goto(`./#/comida/buscar?d=${past}&meal=desayuno`)
    await page.getByTestId('quick-add').first().click() // the "+" with the last quantity
    await expect(page.getByTestId('food-added-count')).toBeVisible()
    await page.goto(`./#/comida?d=${past}`)
    await expect(diaryKcal(page)).toHaveText('195')
    expect(await kcalToday(page)).toBe('0')
    await page.goto(`./#/comida?d=${past}`)
    await expect(diaryKcal(page)).toHaveText('195')

    // The same through the search page and its quick add.
    const other = addDays(today(), -2)
    await page.goto(`./#/comida/buscar?d=${other}&meal=almuerzo`)
    await page.getByRole('button', { name: 'Agregar 150 g de Arroz blanco cocido' }).click()
    await expect(page.getByTestId('food-added-count')).toBeVisible()
    await page.goto(`./#/comida?d=${other}`)
    await expect(diaryKcal(page)).toHaveText('195')
    await expect(page.getByTestId('meal-almuerzo')).toContainText('Arroz blanco cocido')
    expect(await kcalToday(page)).toBe('0')
  })

  test('"Seguir agregando" is on by default and remembered per profile', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar')
    await withFilters(page, async (sheet) => {
      await expect(sheet.getByTestId('keep-adding')).toBeChecked()
      await sheet.getByTestId('keep-adding').uncheck()
    })
    await page.reload()
    await withFilters(page, (sheet) => expect(sheet.getByTestId('keep-adding')).not.toBeChecked())
  })
})

test.describe('late navigation', () => {
  test('a save that resolves after the person left does not pull them back to the diary', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar?d=2026-01-05&meal=desayuno')
    await setKeepAdding(page, false) // with it off, a finished save would go back to the diary
    await page.getByTestId('food-search').fill('arroz cocido')
    await page.getByTestId('food-results').locator('button').first().click()
    await chooseUnit(page, 'g')
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('100')
    // Save and leave in the same task: the save resolves afterwards.
    await page.evaluate(() => {
      ;(document.querySelector('[data-testid=save-food]') as HTMLButtonElement).click()
      location.hash = '#/entreno'
    })
    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/#\/entreno$/)
    await page.goto('./#/comida?d=2026-01-05')
    await expect(diaryKcal(page)).toHaveText('130') // the save itself still happened
  })
})

test.describe('editing and layout', () => {
  test('the amount is focused, Enter saves the edit, and the stepper changes it', async ({ page }) => {
    await onboard(page)
    await logRice(page, today())
    await page.goto('./#/comida')
    await expect(diaryKcal(page)).toHaveText('195')
    await page.getByTestId('meal-desayuno').getByRole('button', { name: /^Arroz blanco cocido/ }).click()
    const qty = page.getByRole('dialog').getByRole('textbox', { name: 'Cantidad' })
    await expect(qty).toBeFocused()
    await page.getByRole('button', { name: 'Aumentar cantidad' }).click()
    await expect(qty).toHaveValue('160')
    await qty.fill('200')
    await qty.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(diaryKcal(page)).toHaveText('260') // 130 kcal/100 g x 2
    await expect(page.getByTestId('meal-desayuno')).toContainText('200 g')
  })

  test('deleting an entry offers Deshacer', async ({ page }) => {
    await onboard(page)
    await logRice(page, today())
    await page.goto('./#/comida')
    await page.getByTestId('meal-desayuno').getByRole('button', { name: /^Arroz blanco cocido/ }).click()
    await page.getByRole('button', { name: 'Eliminar registro' }).click()
    await expect(diaryKcal(page)).toHaveText('0')
    await undo(page).click()
    await expect(diaryKcal(page)).toHaveText('195')
  })

  test('no horizontal overflow at 360 px: diary, search and quantity sheet', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await onboard(page)
    await logRice(page, addDays(today(), -1))
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.goto('./#/comida/buscar?meal=desayuno')
    await expect(page.getByTestId('quick-add').first()).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.getByTestId('food-recent').locator('button[data-food-row]').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })
})

test.describe('dates and flows that used to ignore the viewed day', () => {
  test('a recipe is logged on the viewed date, shows its notes, and deleting asks with a sheet', async ({ page }) => {
    await onboard(page)
    const d = addDays(today(), -4)
    await page.goto(`./#/comida/recetas/nueva?d=${d}`)
    await page.getByLabel('Nombre', { exact: true }).fill('Arroz de prueba')
    await page.getByLabel('Porciones').fill('2')
    await page.getByTestId('recipe-notes').fill('Pesar el arroz ya cocido')
    await page.getByTestId('add-ingredient').click()
    await page.getByTestId('food-search').fill('arroz cocido')
    await page.getByTestId('food-results').locator('button').first().click()
    await chooseUnit(page, 'g')
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('300')
    await page.getByTestId('save-food').click()
    await page.getByTestId('save-recipe').click()
    await expect(page).toHaveURL(/recetas\/[0-9a-f-]{36}\?d=/)
    await expect(page.getByTestId('recipe-notes')).toHaveValue('Pesar el arroz ya cocido')
    await page.getByTestId('log-recipe').click()
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('1')
    await page.getByTestId('save-food').click()
    await expect(page).toHaveURL(new RegExp(`#/comida\\?d=${d}$`))
    await expect(diaryKcal(page)).toHaveText('195')
    expect(await kcalToday(page)).toBe('0')

    await page.goto('./#/comida/recetas')
    await expect(page.getByTestId('recipe-note')).toHaveText('Pesar el arroz ya cocido')
    await page.getByRole('link', { name: /Arroz de prueba/ }).click()
    await page.getByRole('button', { name: 'Eliminar receta' }).click()
    await expect(page.getByRole('dialog', { name: '¿Eliminar esta receta?' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar receta' }).click()
    await expect(page).toHaveURL(/#\/comida\/recetas$/)
  })

  test('a food created from a label is logged on the viewed date', async ({ page }) => {
    await onboard(page)
    const d = addDays(today(), -2)
    await page.goto(`./#/comida/etiqueta?d=${d}`)
    await page.getByLabel('Nombre del producto').fill('Yogur de prueba')
    await page.getByText('Por 100 g', { exact: true }).click()
    await page.locator('input[name="n-kcal"]').fill('60')
    await page.getByTestId('save-label').click()
    await page.getByTestId('log-label-food').click()
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('200')
    await page.getByTestId('save-food').click()
    await expect(page).toHaveURL(new RegExp(`#/comida\\?d=${d}$`))
    await expect(diaryKcal(page)).toHaveText('120')
    expect(await kcalToday(page)).toBe('0')
  })

  test('a template is applied from /comida/plantillas to the viewed date and meal', async ({ page }) => {
    await onboard(page)
    await logRice(page, today(), 'desayuno', '100')
    await page.goto('./#/comida')
    await page.getByTestId('meal-desayuno').getByRole('button', { name: /^Opciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click()
    await page.getByLabel('Nombre de la plantilla').fill('Desayuno base')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()

    const d = addDays(today(), -6)
    await page.goto(`./#/comida/plantillas?d=${d}`)
    await page.getByTestId('template-open').click()
    await page.getByRole('radio', { name: 'Cena' }).click()
    await page.getByTestId('apply-template').click()
    await expect(page).toHaveURL(new RegExp(`#/comida\\?d=${d}$`))
    await expect(diaryKcal(page)).toHaveText('130')
    await expect(page.getByTestId('meal-cena')).toContainText('Arroz blanco cocido')
    await undo(page).click()
    await expect(diaryKcal(page)).toHaveText('0')

    await page.goto('./#/comida/plantillas')
    await page.getByRole('button', { name: /Eliminar plantilla/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar plantilla' }).click()
    await expect(page.getByTestId('template-open')).toHaveCount(0)
  })
})
