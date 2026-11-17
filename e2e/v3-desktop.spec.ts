// V3 desktop layout of the Nutrition screens (synthetic demo seed). From 1024 px the diary is two columns, the
// search page is two panes with the quantity editor inline, and nothing scrolls sideways. At 412 px it stays
// the phone layout.
//
//   PW_PORT=4162 npx playwright test e2e/v3-desktop.spec.ts
import { join } from 'node:path'
import { rolldown } from 'rolldown'
import { expect, test, type Page } from '@playwright/test'
import { chooseUnit, setKeepAdding } from './helpers'

const TZ = 'America/Bogota'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function demoJson(): Promise<string> {
  const bundle = await rolldown({ input: join(process.cwd(), 'src/test/seed/demoSeed.ts'), platform: 'node', logLevel: 'silent' })
  const { output } = await bundle.generate({ format: 'esm' })
  await bundle.close()
  const mod = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'))
  return JSON.stringify(mod.buildDemoBackup(today()))
}

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

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).first().boundingBox()
  expect(b, testId).not.toBeNull()
  return b!
}

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** One demo profile per worker; each test sets its own viewport and opens its own route. */
test.describe.configure({ mode: 'serial' })
let page: Page
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
  page = await context.newPage()
  page.on('dialog', (d) => void d.accept())
  await restoreDemo(page)
})
test.afterAll(async () => {
  await page.context().close()
})

async function openDiary(width: number, height = 800, hash = '#/comida') {
  await page.setViewportSize({ width, height })
  await page.goto(`./${hash}`)
  await page.getByTestId('day-summary').waitFor()
  await page.getByTestId('meals').waitFor()
}

test.describe('diary at 1280 x 800', () => {
  test('summary on the left, meals on the right (the summary column is the narrower one)', async () => {
    await openDiary(1280)
    const summary = await box(page, 'day-summary')
    const meals = await box(page, 'meals')
    expect(summary.x + summary.width).toBeLessThanOrEqual(meals.x)
    expect(summary.width).toBeLessThan(meals.width)
    expect(Math.abs(summary.y - meals.y)).toBeLessThan(160) // both start under the page header
    // The day-complete control sits with the summary, not under the meals.
    for (const id of ['day-complete']) {
      const el = page.getByTestId(id)
      if (await el.count()) expect((await el.first().boundingBox())!.x + 1).toBeLessThan(meals.x)
    }
  })

  test('Recetas, Plantillas and Etiqueta sit in the page header next to Agregar; the bottom row is gone', async () => {
    await openDiary(1280)
    const add = await box(page, 'add-food')
    for (const name of ['Recetas', 'Plantillas', 'Registrar desde etiqueta']) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      const b = (await link.boundingBox())!
      expect(Math.abs(b.y + b.height / 2 - (add.y + add.height / 2))).toBeLessThan(10)
    }
    await expect(page.getByRole('link', { name: 'Recetas', exact: true })).toHaveCount(1)
  })

  test('entries are table rows: quantity and kcal are aligned columns and the macros show from 1280', async () => {
    await openDiary(1280)
    const meal = page.getByTestId('meals').locator('section:has(ul)').first()
    await expect(meal.getByText('Cantidad', { exact: true })).toBeVisible()
    const rows = meal.locator('ul > li > button')
    expect(await rows.count()).toBeGreaterThan(0)
    const kcalRight = await rows.evaluateAll((els) => els.map((b) => Math.round((b.lastElementChild as HTMLElement).getBoundingClientRect().right)))
    expect(new Set(kcalRight).size).toBe(1)
    // Per-entry macros: three more cells than the phone shows.
    expect(await rows.first().locator('[aria-hidden="true"]').count()).toBe(3)
    await expect(rows.first().locator('[aria-hidden="true"]').first()).toBeVisible()
  })

  test('meters are capped (<= 520 px) and the summary has no sideways scroller', async () => {
    for (const w of [1024, 1280, 1440]) {
      await openDiary(w)
      const meters = page.getByRole('meter')
      const n = await meters.count()
      expect(n).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) expect((await meters.nth(i).boundingBox())!.width).toBeLessThanOrEqual(520)
      expect(await overflowX(page), `overflow at ${w}`).toBeLessThanOrEqual(0)
    }
  })

  test('no suggestion chips and no repeat block under the meals; no horizontal overflow', async () => {
    await openDiary(1280, 800, `#/comida?d=${tomorrow()}`)
    await expect(page.locator('[data-testid^="suggest-"]')).toHaveCount(0)
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(page.getByTestId('repeat-desayuno')).toHaveCount(0)
    await expect(page.getByTestId('food-ideas')).toHaveCount(0)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('search at 1280 x 800', () => {
  async function openSearch(width = 1280) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('./#/comida/buscar?meal=almuerzo')
    await page.getByTestId('food-search').waitFor()
  }

  test('nothing selected: the right pane shows what is left and the ideas; no horizontal overflow at 1024/1280/1440', async () => {
    for (const w of [1024, 1280, 1440]) {
      await openSearch(w)
      await expect(page.getByTestId('search-remaining')).toBeVisible()
      expect(await overflowX(page), `overflow at ${w}`).toBeLessThanOrEqual(0)
      const remaining = await box(page, 'search-remaining')
      const list = await box(page, 'food-search')
      expect(remaining.x).toBeGreaterThan(list.x + list.width)
      for (const m of await page.getByTestId('search-remaining').getByRole('meter').all()) expect((await m.boundingBox())!.width).toBeLessThanOrEqual(520)
    }
  })

  test('selecting a food opens the detail in the right pane (no dialog), nutrient table folded; saving logs the right quantity and meal', async () => {
    await openSearch()
    await setKeepAdding(page, true)
    await page.getByTestId('food-search').fill('arroz cocido')
    const first = page.getByTestId('food-results').locator('button[data-food-row]').first()
    const name = (await first.locator('.line-clamp-2').innerText()).trim()
    await first.click()
    const panel = page.getByTestId('quantity-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(panel.getByRole('heading', { name })).toBeVisible()
    // progressive disclosure: the full table is one tap away, not on screen
    await expect(panel.getByText('Energía y macronutrientes')).toBeHidden()
    await panel.getByTestId('detail-nutrition').locator('summary').click()
    await expect(panel.getByText('Energía y macronutrientes')).toBeVisible()
    await panel.getByTestId('detail-nutrition').locator('summary').click()
    const list = await box(page, 'food-results')
    const p = (await panel.boundingBox())!
    expect(p.x).toBeGreaterThan(list.x + list.width - 1)
    await expect(first).toHaveAttribute('aria-current', 'true')
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
    // Nothing inside the panel scrolls sideways.
    expect(await panel.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0)

    await chooseUnit(page, 'g', panel)
    await panel.getByRole('textbox', { name: 'Cantidad' }).fill('137')
    await panel.getByTestId('meal-change').click()
    await page.getByTestId('chooser').getByRole('radio', { name: 'Cena', exact: true }).click()
    await expect(panel.getByTestId('save-food')).toContainText('Agregar a cena')
    await panel.getByTestId('save-food').click()
    await expect(page.getByTestId('food-added-count')).toBeVisible()
    await expect(panel).toHaveCount(0)
    await expect(page.getByTestId('search-remaining')).toBeVisible()
    await page.goto('./#/comida')
    await expect(page.getByTestId('meal-cena')).toContainText('137 g')
    await expect(page.getByTestId('meal-cena')).toContainText(name)
  })

  test('keyboard: ArrowDown enters the results, arrows move, Enter opens the pane, Escape returns to the field', async () => {
    await openSearch()
    const input = page.getByTestId('food-search')
    await input.fill('arroz')
    const rows = page.getByTestId('food-results').locator('button[data-food-row]')
    await expect(rows.nth(1)).toBeVisible()
    await input.press('ArrowDown')
    await expect(rows.nth(0)).toBeFocused()
    await rows.nth(0).press('ArrowDown')
    await expect(rows.nth(1)).toBeFocused()
    await rows.nth(1).press('ArrowUp')
    await expect(rows.nth(0)).toBeFocused()
    // ArrowUp from the first row goes back to the field.
    await rows.nth(0).press('ArrowUp')
    await expect(input).toBeFocused()
    await input.press('ArrowDown')
    await rows.nth(0).press('ArrowDown')
    const name = (await rows.nth(1).locator('.line-clamp-2').innerText()).trim()
    await rows.nth(1).press('Enter')
    const panel = page.getByTestId('quantity-panel')
    await expect(panel.getByRole('heading', { name })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Cantidad' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(input).toBeFocused()
    // Enter in the field opens the first result.
    await input.press('Enter')
    await expect(panel).toBeVisible()
    // Escape from a focused row also goes back to the field.
    await page.keyboard.press('Escape')
    await rows.nth(0).focus()
    await page.keyboard.press('Escape')
    await expect(input).toBeFocused()
  })
})

test.describe('phone guard at 412 px', () => {
  test('the diary is one column, in the same order, with the shortcuts at the bottom', async () => {
    await openDiary(412, 915)
    const summary = await box(page, 'day-summary')
    const meals = await box(page, 'meals')
    expect(Math.abs(summary.x - meals.x)).toBeLessThan(1)
    expect(meals.y).toBeGreaterThan(summary.y + summary.height - 1)
    const bottom = page.getByRole('link', { name: 'Recetas', exact: true })
    await expect(bottom).toHaveCount(1)
    await expect(bottom).toBeVisible()
    const b = (await bottom.boundingBox())!
    expect(b.y).toBeGreaterThan(meals.y + meals.height - 1)
    await expect(page.getByRole('link', { name: 'Plantillas', exact: true })).toHaveCount(1)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })

  test('the search page keeps the sheet: selecting a food opens a dialog and there is no side pane', async () => {
    await page.setViewportSize({ width: 412, height: 915 })
    await page.goto('./#/comida/buscar?meal=almuerzo')
    await page.getByTestId('food-search').fill('arroz cocido')
    await page.getByTestId('food-results').locator('button[data-food-row]').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByTestId('quantity-panel')).toHaveCount(0)
    await expect(page.getByTestId('search-remaining')).toHaveCount(0)
    // The arrow keys do nothing special on the phone layout: focus stays in the field.
    await page.keyboard.press('Escape')
    await page.getByTestId('food-search').press('ArrowDown')
    await expect(page.getByTestId('food-search')).toBeFocused()
  })
})

// ───────────── Entreno ─────────────
async function openTraining(width: number, height = 800, hash = '#/entreno') {
  await page.setViewportSize({ width, height })
  await page.goto(`./${hash}`)
  await page.getByTestId('training-home').waitFor()
  await page.getByTestId('recovery-section').waitFor()
}

test.describe('Entreno at 1280 x 800 and 1024', () => {
  for (const w of [1280, 1024]) {
    test(`the home is a band plus two columns at ${w} (routines left, calendar and muscle state right)`, async () => {
      await openTraining(w)
      const week = await box(page, 'week-summary')
      const routines = await box(page, 'routine-list')
      const calendar = await box(page, 'training-calendar')
      const recovery = await box(page, 'recovery-section')
      expect(routines.y).toBeGreaterThan(week.y + week.height - 1) // the week is a full-width band on top
      expect(week.width).toBeGreaterThan(routines.width + calendar.width - 1)
      expect(routines.x + routines.width).toBeLessThanOrEqual(calendar.x)
      expect(routines.width).toBeGreaterThan(calendar.width)
      expect(Math.abs(recovery.x - calendar.x)).toBeLessThan(2)
      expect(Math.abs(routines.y - calendar.y)).toBeLessThan(60) // both columns start on the same line
    })
  }

  test('routine cards form a grid two across; the calendar stays compact', async () => {
    await openTraining(1280)
    const cards = page.getByTestId('routine-card')
    expect(await cards.count()).toBeGreaterThan(1)
    const a = (await cards.nth(0).boundingBox())!
    const b = (await cards.nth(1).boundingBox())!
    expect(Math.abs(a.y - b.y)).toBeLessThan(2)
    expect(b.x).toBeGreaterThan(a.x + a.width - 1)
    const grid = (await page.getByTestId('training-calendar').locator('[role=grid]').boundingBox())!
    expect(grid.width).toBeLessThanOrEqual(420)
    for (const m of await page.getByRole('meter').all()) expect((await m.boundingBox())!.width).toBeLessThanOrEqual(520)
  })

  test('no horizontal overflow at 1024/1280/1440 on the home, the library, a routine and the history', async () => {
    for (const w of [1024, 1280, 1440]) {
      await openTraining(w)
      expect(await overflowX(page), `home ${w}`).toBeLessThanOrEqual(0)
      await page.goto('./#/entreno/rutinas')
      await page.getByTestId('routine-library').waitFor()
      expect(await overflowX(page), `library ${w}`).toBeLessThanOrEqual(0)
      await page.getByTestId('routine-link').first().click()
      await page.getByTestId('routine-detail').waitFor()
      expect(await overflowX(page), `detail ${w}`).toBeLessThanOrEqual(0)
      await page.goto('./#/entreno/historial')
      await page.getByTestId('history-page').waitFor()
      expect(await overflowX(page), `history ${w}`).toBeLessThanOrEqual(0)
    }
  })

  test('library rows are aligned columns; the routine detail has the summary left and the exercises right', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('./#/entreno/rutinas')
    await page.getByTestId('library-list').waitFor()
    const rows = page.getByTestId('library-row')
    expect(await rows.count()).toBeGreaterThan(1)
    const lefts = await rows.evaluateAll((els) => els.map((r) => Math.round((r.querySelector('[data-testid=routine-last]') as HTMLElement).getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(1)
    await page.getByTestId('routine-link').first().click()
    await page.getByTestId('routine-detail').waitFor()
    const strip = await box(page, 'routine-strip')
    const list = await box(page, 'routine-exercises')
    expect(strip.x + strip.width).toBeLessThanOrEqual(list.x)
    expect(strip.width).toBeLessThan(list.width)
  })

  test('the history is a grid of two columns of cards at 1280', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('./#/entreno/historial')
    await page.getByTestId('history-page').waitFor()
    const lefts = await page.getByTestId('session-row').evaluateAll((els) => els.slice(0, 6).map((r) => Math.round(r.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(2)
  })
})

test.describe('Entreno at 412 px', () => {
  test('stays one column: week, routines, calendar in order', async () => {
    await openTraining(412, 915)
    const week = await box(page, 'week-summary')
    const routines = await box(page, 'routine-list')
    const calendar = await box(page, 'training-calendar')
    expect(Math.abs(routines.x - calendar.x)).toBeLessThan(1)
    expect(routines.y).toBeGreaterThan(week.y)
    expect(calendar.y).toBeGreaterThan(routines.y + routines.height - 1)
    const a = (await page.getByTestId('routine-card').nth(0).boundingBox())!
    const b = (await page.getByTestId('routine-card').nth(1).boundingBox())!
    expect(b.y).toBeGreaterThan(a.y + a.height - 1)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })
})
