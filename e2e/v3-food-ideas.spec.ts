// Food ideas ("Ideas para lo que falta", on the search page; the diary has none since 3.2) with the synthetic demo seed
// (src/test/seed/demoSeed.ts), restored through the app's own import flow.
import type { Locator, Page } from '@playwright/test'
import { clickUndo, demoJson as buildDemoJson, expect, onboard, test, today } from './helpers'

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const MEAL_KEY: Record<string, string> = { Desayuno: 'desayuno', 'Media mañana': 'media_manana', Almuerzo: 'almuerzo', Onces: 'onces', Cena: 'cena', Otros: 'otro' }
const NUTRIENT_LABEL: Record<string, string> = { proteína: 'Proteína', carbohidratos: 'Carbohidratos', grasa: 'Grasa', fibra: 'Fibra' }
/** "1.075" → 1075 (es-CO grouping). */
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

const demoJson = (): Promise<string> => buildDemoJson()
async function restoreDemo(page: Page) {
  const json = await demoJson()
  await page.goto('./')
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('./')
  await page.reload()
  await expect(page.getByTestId('dashboard')).toBeVisible()
}

const ideas = (page: Page) => page.getByTestId('search-ideas')
const remainingKcal = async (page: Page) => num((await page.getByTestId('kcal-remaining').locator('.readout').innerText()).trim())
const mealRows = (page: Page, key: string) => page.getByTestId(`meal-${key}`).locator('ul > li')

/** The search page for a meal (and day) with its ideas group open: the only place ideas live since 3.2. */
async function openIdeas(page: Page, meal = 'cena', date?: string) {
  await page.goto(`./#/comida/buscar?meal=${meal}${date ? `&d=${date}` : ''}`)
  await page.getByRole('radio', { name: 'Frecuentes' }).click()
  const group = ideas(page)
  await group.waitFor({ timeout: 4000 })
  if (!(await group.getByTestId('idea-add').first().isVisible())) await group.getByText(/^Ideas para lo que falta/).click()
  await expect(group.getByTestId('idea-add').first()).toBeVisible()
  return group
}

/** What the first idea promises: quantity text, food name, meal and kcal, read from its accessible name and reason. */
async function firstIdea(page: Page) {
  const add = ideas(page).getByTestId('idea-add').first()
  const label = (await add.getAttribute('aria-label')) ?? ''
  const m = /^Agregar (.+) de (.+) a (.+)$/.exec(label)
  expect(m, label).not.toBeNull()
  const reason = await ideas(page).getByTestId('idea-reason').first().innerText()
  const kcal = num(/([\d.]+) kcal/.exec(reason)![1]!)
  return { add, qty: m![1]!, name: m![2]!, meal: MEAL_KEY[m![3]!]!, kcal }
}

/** Two clicks inside one task, before React re-renders. */
const doubleClick = (l: Locator) =>
  l.evaluate((el) => {
    ;(el as HTMLButtonElement).click()
    ;(el as HTMLButtonElement).click()
  })

test.describe('food ideas with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
  })

  test('the diary shows no ideas block and no suggestion chips under any meal', async ({ page }) => {
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('meals').locator('section').first()).toBeVisible()
    await expect(page.getByTestId('food-ideas')).toHaveCount(0)
    await expect(page.getByText('Para completar')).toHaveCount(0)
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(page.locator('[data-testid^="suggest-"]')).toHaveCount(0)
  })

  test("the search page's ideas header matches the day summary and each idea says what it covers", async ({ page }) => {
    await page.goto('./#/comida')
    const remaining = await remainingKcal(page)
    await openIdeas(page)
    const header = await ideas(page).getByTestId('ideas-gap').innerText()
    const m = /^Te (?:faltan ([\d.]+) g de (\S+) y|quedan) ([\d.]+) kcal$/.exec(header)
    expect(m, header).not.toBeNull()
    expect(m![2], 'the demo day is short of protein').toBe('proteína')
    await expect(ideas(page).getByTestId('idea-reason').first()).toContainText('g de proteína')
    expect(num(m![3]!)).toBe(remaining)
    const rows = ideas(page).getByTestId('idea')
    expect(await rows.count()).toBeGreaterThan(0)
    expect(await rows.count()).toBeLessThanOrEqual(3)
    await expect(ideas(page).getByTestId('idea-add').first()).toHaveAccessibleName(/^Agregar .+ de .+ a (Desayuno|Media mañana|Almuerzo|Onces|Cena|Otros)$/)
    const box = await ideas(page).getByTestId('idea-add').first().boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await ideas(page).getByText('¿Cómo se eligen?').click()
    await expect(ideas(page).getByTestId('ideas-how')).toContainText('sin pasar la energía que te queda')
  })

  test('one tap logs exactly that row into the stated meal; Deshacer removes exactly it', async ({ page }) => {
    await openIdeas(page)
    const idea = await firstIdea(page)
    await page.goto('./#/comida')
    const before = await mealRows(page, idea.meal).count()
    const kcalBefore = await remainingKcal(page)
    await openIdeas(page)
    await idea.add.click()
    await page.goto('./#/comida')
    await expect(mealRows(page, idea.meal)).toHaveCount(before + 1)
    const row = mealRows(page, idea.meal).filter({ hasText: idea.name })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(idea.qty)
    await expect(row).toContainText(String(idea.kcal))
    await expect.poll(() => remainingKcal(page)).toBeLessThan(kcalBefore)
    expect(Math.abs(kcalBefore - (await remainingKcal(page)) - idea.kcal)).toBeLessThanOrEqual(1)
    await clickUndo(page)
    await expect(mealRows(page, idea.meal)).toHaveCount(before)
    await expect.poll(() => remainingKcal(page)).toBe(kcalBefore)
  })

  test('a double tap logs once', async ({ page }) => {
    await openIdeas(page)
    const idea = await firstIdea(page)
    await page.goto('./#/comida')
    const before = await mealRows(page, idea.meal).count()
    await openIdeas(page)
    await doubleClick(idea.add)
    await page.waitForTimeout(600)
    await page.goto('./#/comida')
    await expect(mealRows(page, idea.meal)).toHaveCount(before + 1)
    await expect(mealRows(page, idea.meal).filter({ hasText: idea.name })).toHaveCount(1)
  })

  test('a day marked complete offers no ideas', async ({ page }) => {
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    // The "complete" mark needs something logged: on an empty day (just after midnight) log the first idea.
    if ((await page.getByTestId('day-complete').count()) === 0) {
      await openIdeas(page)
      await (await firstIdea(page)).add.click()
      await page.goto('./#/comida')
      await expect(page.getByTestId('day-complete')).toBeVisible()
    }
    await page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true }).click()
    await page.goto('./#/comida/buscar?meal=cena')
    await page.getByRole('radio', { name: 'Frecuentes' }).click()
    await expect(page.getByTestId('food-frequent').or(page.getByText(/Aún no hay frecuentes/))).toBeVisible()
    await expect(ideas(page)).toHaveCount(0)
    await page.goto('./#/comida')
    await page.getByTestId('day-complete').getByRole('radio', { name: 'Completo', exact: true }).click() // unmark
    await openIdeas(page)
  })

  test('on a past date the idea is logged to that date, not today', async ({ page }) => {
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    const todayCount = await page.getByTestId('meals').locator('ul > li').count()
    let date = ''
    for (let off = 1; off <= 20 && !date; off++) {
      const d = addDays(today(), -off)
      await page.goto(`./#/comida/buscar?meal=cena&d=${d}`)
      await page.getByRole('radio', { name: 'Frecuentes' }).click()
      await page.waitForTimeout(300)
      if (await ideas(page).isVisible()) date = d
    }
    expect(date, 'a past day with ideas').not.toBe('')
    await openIdeas(page, 'cena', date)
    const idea = await firstIdea(page)
    await page.goto(`./#/comida?d=${date}`)
    const before = await mealRows(page, idea.meal).count()
    await openIdeas(page, 'cena', date)
    await idea.add.click()
    await page.goto(`./#/comida?d=${date}`)
    await expect(mealRows(page, idea.meal)).toHaveCount(before + 1)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('meals').locator('ul > li')).toHaveCount(todayCount)
  })

  test('the search page offers ideas for the selected meal, folded, above the frequent foods', async ({ page }) => {
    await page.goto('./#/comida/buscar?meal=cena')
    await page.getByRole('radio', { name: 'Frecuentes' }).click()
    const group = page.getByTestId('search-ideas')
    await expect(group).toBeVisible()
    // folded by default (the list stays near the top); one tap opens them
    await expect(group.getByTestId('idea-add').first()).toBeHidden()
    await group.getByText(/^Ideas para lo que falta/).click()
    await expect(group.getByTestId('idea-add').first()).toHaveAccessibleName(/ a Cena$/)
    const frequent = page.getByTestId('food-frequent')
    const [g, f] = await Promise.all([group.boundingBox(), frequent.boundingBox()])
    expect(g!.y).toBeLessThan(f!.y)
  })

  test('no horizontal overflow at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})

test.describe('typed food search order', () => {
  test('a food logged before comes first for "arroz"; English-only names are folded behind one row', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar?meal=almuerzo')
    await page.getByTestId('food-search').fill('arroz blanco cocido')
    await page.getByTestId('food-results').locator('button', { hasText: 'Arroz blanco cocido' }).first().click()
    await page.getByTestId('save-food').click()
    // The sheet leaves with a short animation and the search field is cleared once it has gone.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto('./#/comida/buscar?meal=cena')
    await page.getByTestId('food-search').fill('arroz')
    const rows =page.getByTestId('food-results').locator(':scope > li')
    await expect(rows.first()).toContainText('Arroz blanco cocido')
    await expect(page.getByTestId('food-results')).not.toContainText('nombre en inglés')
    const toggle = page.getByTestId('english-toggle')
    await expect(toggle).toHaveText(/^Ver \d+ resultados? en inglés$/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const n = Number(/\d+/.exec(await toggle.innerText())![0])
    await expect(page.getByTestId('food-results-english')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('food-results-english').locator(':scope > li')).toHaveCount(n)
  })
})

test.describe('label page', () => {
  test('a double tap on "Guardar alimento" saves one food, and saving again updates it', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/etiqueta')
    await page.getByLabel('Nombre del producto').fill('Barra sintética')
    await page.getByText('Por 100 g', { exact: true }).click()
    await page.locator('input[name="n-kcal"]').fill('400')
    await page.locator('input[name="n-protein"]').fill('20')
    await doubleClick(page.getByTestId('save-label'))
    await expect(page.getByTestId('log-label-food')).toBeVisible()
    await expect(page).toHaveURL(/edit=/)
    // fix a typo and save again: same row, not a second one
    await page.getByLabel('Nombre del producto').fill('Barra sintética B')
    await page.getByTestId('save-label').click()
    await expect(page.getByTestId('save-label')).toHaveText('Guardar cambios')
    await page.goto('./#/comida/buscar')
    await page.getByRole('radio', { name: 'Míos' }).click()
    const mine = page.getByTestId('food-mine').locator(':scope > li')
    await expect(mine).toHaveCount(1)
    await expect(mine.first()).toContainText('Barra sintética B')
  })
})
