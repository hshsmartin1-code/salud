// V3.2 diary: a quiet page. One habit line under the slot of the hour, nothing explanatory between the summary and
// the meals, and "Copiar comida anterior". Synthetic profile only. The suite clock is 16:30, so the slot of the
// hour of a fresh profile is lunch (breakfast, lunch and dinner are on; the nearest to 16:30 is lunch).
import { clickUndo, expect, logInMeal, mealMenu, onboard, test, today } from './helpers'

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const habits = (page: import('@playwright/test').Page) => page.getByTestId('slot-habits')

test.describe('habit line under the slot of the hour', () => {
  test('a new profile and a profile with two days of history get nothing', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(habits(page)).toHaveCount(0)
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -1) })
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -2) })
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(habits(page)).toHaveCount(0)
    await expect(page.getByTestId('meal-almuerzo')).toContainText('Almuerzo')
  })

  test('three distinct days in that slot give one line with the amount last used; one tap logs it, with Deshacer', async ({ page }) => {
    await onboard(page)
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -1), qty: '120' })
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -2), qty: '130' })
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -3), qty: '140' })
    await logInMeal(page, 'cena', { date: addDays(today(), -1), query: 'pollo' })
    await page.goto('./#/comida')
    await expect(habits(page)).toBeVisible()
    await expect(page.getByTestId('meal-almuerzo').getByTestId('slot-habits')).toHaveCount(1)
    await expect(page.getByTestId('meal-cena').getByTestId('slot-habits')).toHaveCount(0)
    const chips = habits(page).getByTestId('slot-habit')
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toContainText('120 g') // the amount last used there
    expect(await page.getByTestId('suggestion').count()).toBe(0)
    const box = (await chips.first().boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    const rows = page.getByTestId('meal-almuerzo').locator('ul > li')
    await expect(rows).toHaveCount(0)
    await chips.first().click()
    await expect(rows).toHaveCount(1)
    await expect(habits(page)).toHaveCount(0) // already logged today in that slot
    await page.locator('.toast-host').getByRole('button', { name: 'Deshacer' }).click()
    await expect(rows).toHaveCount(0)
    await expect(habits(page)).toBeVisible()
  })

  test('a double tap on the habit logs once', async ({ page }) => {
    await onboard(page)
    for (const n of [1, 2, 3]) await logInMeal(page, 'almuerzo', { date: addDays(today(), -n), qty: '150' })
    await page.goto('./#/comida')
    await expect(habits(page)).toBeVisible()
    // Two clicks inside one task: the second lands before React has re-rendered.
    await habits(page).getByTestId('slot-habit').first().evaluate((el) => {
      ;(el as HTMLButtonElement).click()
      ;(el as HTMLButtonElement).click()
    })
    await expect(page.getByTestId('kcal-total')).toHaveText('195')
    await page.waitForTimeout(400)
    await expect(page.getByTestId('kcal-total')).toHaveText('195')
    await expect(page.getByTestId('meal-almuerzo').locator('ul > li')).toHaveCount(1)
  })

  test('at 360 px a short name is never cut; two chips that do not fit wrap, only a long name is ellipsised', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await onboard(page)
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -1) })
    // Clone that log into 3 days under two names: one short, one very long.
    await page.evaluate(async ({ days }) => {
      const db: IDBDatabase = await new Promise((res) => { const q = indexedDB.open('salud-pho'); q.onsuccess = () => res(q.result) })
      const rows: Record<string, unknown>[] = await new Promise((res) => { const q = db.transaction('foodLogs').objectStore('foodLogs').getAll(); q.onsuccess = () => res(q.result) })
      const base = rows[0]!
      const t = db.transaction('foodLogs', 'readwrite')
      let n = 0
      for (const [ref, name] of [['habit:a', 'Banano'], ['habit:b', 'Queso fresco campesino de la finca grande con hierbas aromaticas y sal marina']] as const)
        for (const d of days) t.objectStore('foodLogs').put({ ...base, id: `habit-${n++}`, date: d, foodRef: ref, name })
      await new Promise((res) => { t.oncomplete = res })
      db.close()
    }, { days: [-2, -3, -4].map((n) => addDays(today(), n)) })
    await page.goto('./#/comida')
    await page.reload()
    const chips = habits(page).getByTestId('slot-habit')
    await expect(chips).toHaveCount(2)
    const names = chips.locator('span.truncate')
    const [short, long] = [names.nth(0), names.nth(1)]
    const whichShort = (await short.innerText()) === 'Banano' ? short : long
    const whichLong = whichShort === short ? long : short
    const ellipsised = (l: typeof short) => l.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(await ellipsised(whichShort)).toBe(false)
    expect(await ellipsised(whichLong)).toBe(true)
    const group = (await habits(page).boundingBox())!
    for (const c of await chips.all()) expect((await c.boundingBox())!.x + (await c.boundingBox())!.width).toBeLessThanOrEqual(group.x + group.width + 1)
    await expect(chips.filter({ hasText: '· 100 g' })).toHaveCount(2)
  })

  test('other days of the diary show no line, and another slot never feeds it', async ({ page }) => {
    await onboard(page)
    for (const n of [1, 2, 3]) await logInMeal(page, 'desayuno', { date: addDays(today(), -n) })
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(habits(page)).toHaveCount(0) // breakfast has the habit, but the slot of the hour is lunch
    for (const n of [1, 2, 3]) await logInMeal(page, 'almuerzo', { date: addDays(today(), -n), query: 'pollo' })
    await page.goto('./#/comida')
    await expect(habits(page)).toBeVisible()
    await expect(habits(page)).not.toContainText('rroz')
    await page.goto(`./#/comida?d=${addDays(today(), -1)}`)
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(habits(page)).toHaveCount(0)
    await page.goto(`./#/comida?d=${addDays(today(), 1)}`)
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(habits(page)).toHaveCount(0)
  })
})

test.describe('Copiar comida anterior', () => {
  const yesterday = () => addDays(today(), -1)
  async function twoFoodsYesterday(page: import('@playwright/test').Page, date = yesterday(), meal = 'almuerzo') {
    await logInMeal(page, meal, { date, qty: '150' }) // arroz cocido: 130 kcal/100 g -> 195
    await logInMeal(page, meal, { date, qty: '100', query: 'pollo' })
  }
  const sheet = (page: import('@playwright/test').Page) => page.getByTestId('copy-meal')
  const rows = (page: import('@playwright/test').Page, meal = 'almuerzo') => page.getByTestId(`meal-${meal}`).locator('ul > li')

  test('the old copy and repeat actions are gone from the menu and from an empty meal', async ({ page }) => {
    await onboard(page)
    await twoFoodsYesterday(page)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('repeat-almuerzo')).toHaveCount(0)
    await expect(page.getByText(/Repetir ayer/)).toHaveCount(0)
    await page.getByTestId('meal-almuerzo').getByRole('button', { name: /^Opciones de/ }).click()
    const items = await page.getByRole('menuitem').allInnerTexts()
    expect(items).toEqual(['Copiar comida anterior', 'Aplicar plantilla'])
    await page.keyboard.press('Escape')
  })

  test('copy all: the latest earlier date with entries is preselected and everything is ticked; one batch, one undo', async ({ page }) => {
    await onboard(page)
    await logInMeal(page, 'almuerzo', { date: addDays(today(), -4), qty: '80' })
    await twoFoodsYesterday(page)
    await page.goto('./#/comida')
    // Same document, new hash: wait until the diary shows today (nothing logged) before reading the starting total.
    await expect(rows(page)).toHaveCount(0)
    await expect(page.getByTestId('kcal-total')).toHaveText('0')
    const before = await page.getByTestId('kcal-total').innerText()
    await mealMenu(page, 'almuerzo', 'Copiar comida anterior')
    await expect(sheet(page)).toBeVisible()
    await expect(page.getByTestId('copy-meal-date')).toHaveValue(yesterday())
    await expect(page.getByTestId('copy-meal-row')).toHaveCount(2)
    for (const box of await page.getByTestId('copy-meal-row').getByRole('checkbox').all()) await expect(box).toBeChecked()
    await expect(page.getByTestId('copy-meal-save')).toHaveText('Copiar 2 alimentos')
    await page.getByTestId('copy-meal-save').click()
    await expect(rows(page)).toHaveCount(2)
    // The total follows the live query: poll it instead of reading it in the same frame as the rows.
    await expect.poll(async () => Number((await page.getByTestId('kcal-total').innerText()).replace(/\./g, ''))).toBeGreaterThan(Number(before.replace(/\./g, '')))
    await expect(page.getByRole('status').filter({ hasText: '2 alimentos copiados de ayer a almuerzo' })).toBeVisible()
    await clickUndo(page)
    await expect(rows(page)).toHaveCount(0)
    await expect(page.getByTestId('kcal-total')).toHaveText(before)
  })

  test('copy a subset with a changed quantity: only ticked foods, the edited amount, nutrients rescaled', async ({ page }) => {
    await onboard(page)
    await twoFoodsYesterday(page)
    await page.goto('./#/comida')
    await mealMenu(page, 'almuerzo', 'Copiar comida anterior')
    const list = page.getByTestId('copy-meal-row')
    const chicken = list.filter({ hasText: /pollo/i })
    await chicken.getByRole('checkbox').uncheck()
    await expect(page.getByTestId('copy-meal-save')).toHaveText('Copiar 1 alimento')
    const rice = list.filter({ hasText: /arroz/i })
    await rice.getByRole('textbox').fill('300')
    await expect(rice).toContainText('390 kcal') // 130 kcal / 100 g x 300 g, live
    // an unusable quantity blocks the footer and says why
    await rice.getByRole('textbox').fill('0')
    await expect(page.getByTestId('copy-meal-save')).toBeDisabled()
    await expect(rice.getByRole('alert')).toBeVisible()
    await rice.getByRole('textbox').fill('300')
    await page.getByTestId('copy-meal-save').click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('300 g')
    await expect(page.getByTestId('kcal-total')).toHaveText('390')
    // yesterday is untouched
    await page.goto(`./#/comida?d=${yesterday()}`)
    await expect(rows(page)).toHaveCount(2)
  })

  test('copying into a day viewed with ?d= lands on that day, from the latest date before it', async ({ page }) => {
    await onboard(page)
    const source = addDays(today(), -6)
    const target = addDays(today(), -2)
    await twoFoodsYesterday(page, source)
    await page.goto(`./#/comida?d=${target}`)
    await mealMenu(page, 'almuerzo', 'Copiar comida anterior')
    await expect(page.getByTestId('copy-meal-date')).toHaveValue(source)
    await page.getByTestId('copy-meal-save').click()
    await expect(rows(page)).toHaveCount(2)
    await page.goto('./#/comida')
    await expect(page.getByTestId('kcal-total')).toHaveText('0')
    await page.goto(`./#/comida?d=${source}`)
    await expect(rows(page)).toHaveCount(2)
  })

  test('a date with no entries in that slot says so and cannot be copied; picking another date lists its foods', async ({ page }) => {
    await onboard(page)
    await twoFoodsYesterday(page)
    await page.goto('./#/comida')
    await mealMenu(page, 'almuerzo', 'Copiar comida anterior')
    await page.getByTestId('copy-meal-date').fill(addDays(today(), -9))
    await expect(page.getByTestId('copy-meal-none')).toContainText('No hay registros de almuerzo ese día')
    await expect(page.getByTestId('copy-meal-save')).toBeDisabled()
    await page.getByTestId('copy-meal-date').fill(yesterday())
    await expect(page.getByTestId('copy-meal-row')).toHaveCount(2)
    await expect(page.getByTestId('copy-meal-save')).toBeEnabled()
  })

  test('a meal with no earlier history still opens the sheet with a clear line', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida')
    await mealMenu(page, 'cena', 'Copiar comida anterior')
    await expect(page.getByTestId('copy-meal-none')).toBeVisible()
    await expect(page.getByTestId('copy-meal-save')).toBeDisabled()
  })
})
