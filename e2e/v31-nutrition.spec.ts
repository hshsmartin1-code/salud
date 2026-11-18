// V3.1 progressive disclosure of the nutrition logging flow (synthetic data only): calm food rows, one compact unit
// chooser, clean measure names, fractions, a footer that stays above the keyboard, ideas only from real history and
// one grouped incomplete-data notice per day.
import type { Page } from '@playwright/test'
import { chooseUnit, expect, kcalToday, onboard, saveFood, test, unitChoices } from './helpers'

interface SeedFood {
  id: string
  name: string
  brand: string | null
  barcode: string | null
  basis: '100g' | '100ml'
  nutrients: Record<string, number>
  portions: [string, number][]
}

/** Writes an Open Food Facts-style reference food (what "Buscar en Open Food Facts" stores) straight into the device DB. */
async function seedOffFood(page: Page, f: SeedFood) {
  await page.evaluate(
    (food) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('salud-pho')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('refFoods', 'readwrite')
          tx.objectStore('refFoods').put({
            source: 'off', nameEs: null, category: 'Snacks', kind: 'packaged', synonyms: null, flags: ['portion_units_checked'],
            datasetVersion: 'prueba sintética', fetchedAt: new Date().toISOString(), ...food,
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    f,
  )
  await page.reload()
}

const GALLETAS: SeedFood = {
  id: 'off:9990000000001',
  name: 'Galletas Prueba',
  brand: 'Marca Prueba',
  barcode: '9990000000001',
  basis: '100g',
  nutrients: { kcal: 400, protein: 6, carbs: 70, fat: 10 }, // no fibre, sugars, saturated fat or sodium: incomplete data
  portions: [
    ['1 porción (1 portion (150 g))', 150],
    ['1 porción (150 g)', 150],
    ['1 unidad (individual school container)', 150],
    ['Cantidad no especificada', 150],
  ],
}
const BARRA: SeedFood = { ...GALLETAS, id: 'off:9990000000002', name: 'Barra Prueba', barcode: '9990000000002', nutrients: { kcal: 200, protein: 10, carbs: 20, fat: 8, fiber: 3, sugars: 5, satFat: 2, sodium: 100 }, portions: [['1 barra (40 g)', 40]] }
const BEBIDA: SeedFood = { ...GALLETAS, id: 'off:9990000000003', name: 'Bebida Prueba', barcode: '9990000000003', basis: '100ml', nutrients: { kcal: 50, protein: 0, carbs: 12, fat: 0 }, portions: [['1 vaso (250 ml)', 250]] }

async function openFood(page: Page, query: string, meal = 'desayuno') {
  await page.goto(`./#/comida/buscar?meal=${meal}`)
  await page.getByTestId('food-search').fill(query)
  await page.getByTestId('food-results').locator('button[data-food-row]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('food rows: no technical labels', () => {
  test('search results and the recents list show glyph, name and habitual quantity, never database or state tags', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar?meal=desayuno')
    await page.getByTestId('food-search').fill('arroz blanco cocido')
    const results = page.getByTestId('food-results')
    await expect(results.locator('li').first()).toBeVisible()
    const text = await results.innerText()
    expect(text).not.toMatch(/\b(USDA|OFF|ICBF|FNDDS)\b/)
    expect(text).not.toMatch(/kcal\/100|Cocido|Crudo|nombre en inglés|En el diario/)
    // every row carries its category glyph and the quantity with its energy (a plain 100 g when the food was never logged)
    const first = results.locator('li').first()
    await expect(first.locator('[data-glyph]')).toHaveCount(1)
    await expect(first.getByTestId('food-habitual')).toContainText(/\d+(,\d)? (g|ml|kcal)|porci|taza/i)
    await expect(first.getByTestId('food-habitual')).toContainText('kcal')

    // after logging it, the recents row offers that quantity with its energy and a one-tap "+"
    await first.locator('button[data-food-row]').click()
    await chooseUnit(page, 'g')
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('150')
    await page.getByTestId('save-food').click()
    await expect(page.getByTestId('food-added-count')).toBeVisible()
    await page.getByTestId('food-search').fill('')
    const recent = page.getByTestId('food-recent').locator('li').first()
    await expect(recent.getByTestId('food-habitual')).toContainText('150 g')
    await expect(recent.getByTestId('food-habitual')).toContainText('195 kcal')
    await expect(recent.getByTestId('quick-add')).toHaveAccessibleName(/^Agregar 150 g de /)
    await expect(recent.getByRole('img', { name: 'En el diario' })).toBeVisible()
    expect(await page.getByTestId('food-recent').innerText()).not.toMatch(/\b(USDA|OFF|ICBF)\b/)
  })

  test('the search screen is calm: one segmented row, filters behind one button, results start high', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await onboard(page)
    await page.goto('./#/comida/buscar?meal=almuerzo')
    const tabs = page.getByRole('radiogroup', { name: 'Lista de alimentos' })
    await expect(tabs.getByRole('radio')).toHaveText(['Recientes', 'Frecuentes', 'Favoritos', 'Míos'])
    // no filter chips on the screen: they live in the Filtros sheet
    await expect(page.getByRole('radio', { name: 'USDA' })).toHaveCount(0)
    await expect(page.getByText('Seguir agregando alimentos')).toBeHidden()
    await expect(page.getByTestId('filters-dot')).toHaveCount(0)
    await page.getByTestId('filters-button').click()
    const sheet = page.getByTestId('filters-sheet')
    await sheet.getByRole('radio', { name: 'Empacados' }).click()
    await expect(sheet.getByTestId('keep-adding')).toBeVisible()
    await page.getByRole('button', { name: 'Listo', exact: true }).click()
    await expect(page.getByTestId('filters-dot')).toBeVisible() // a dot says a filter is active
    await expect(page.getByTestId('filters-button')).toHaveAccessibleName('Filtros, hay un filtro activo')
    // the first result row starts above 300 px with an empty query (a profile with history)
    await page.getByTestId('filters-button').click()
    await page.getByRole('button', { name: 'Quitar filtros' }).click()
    await page.getByRole('button', { name: 'Listo', exact: true }).click()
    await seedOffFood(page, GALLETAS)
    await page.getByTestId('food-search').fill('galletas prueba')
    await page.getByTestId('food-results').locator('button[data-food-row]').first().click()
    await chooseUnit(page, 'g')
    await page.getByTestId('save-food').click()
    await expect(page.getByTestId('food-added-count')).toBeVisible()
    await page.getByTestId('food-search').fill('')
    const top = (await page.getByTestId('food-recent').locator('li').first().boundingBox())!.y
    expect(top).toBeLessThan(300)
  })
})

test.describe('unit chooser', () => {
  test.beforeEach(async ({ page }) => {
    await onboard(page)
    await seedOffFood(page, GALLETAS)
  })

  test('an Open Food Facts-style food shows "porción (150 g)" exactly once and no English', async ({ page }) => {
    await openFood(page, 'galletas prueba')
    const choices = await unitChoices(page)
    expect(choices.filter((c) => c === 'porción (150 g)')).toHaveLength(1)
    expect(choices).toContain('unidad (150 g)')
    expect(choices).toContain('g')
    expect(choices.join(' | ')).not.toMatch(/portion|container|school|individual|cantidad no especificada/i)
    expect(new Set(choices).size).toBe(choices.length) // nothing repeated
    // kg and oz are one tap away, not listed
    expect(choices).not.toContain('kg')
    expect(choices).not.toContain('oz')
  })

  test('is a small sheet that closes on Escape, on an outside tap and on selection, with roving focus and the selection marked', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await openFood(page, 'galletas prueba')
    const dialog = page.getByRole('dialog', { name: /Galletas Prueba/ })
    await page.getByTestId('unit-button').click()
    const chooser = page.getByTestId('chooser')
    await expect(chooser).toBeVisible()
    const sheet = page.getByRole('dialog', { name: 'Unidad' })
    const h = (await sheet.boundingBox())!.height
    expect(h).toBeLessThanOrEqual(915 * 0.46)
    // the selected option is marked and is the only tab stop
    const checked = chooser.getByRole('radio', { checked: true })
    await expect(checked).toHaveCount(1)
    expect(await chooser.locator('[role="radio"][tabindex="0"]').count()).toBe(1)
    await expect(checked).toBeFocused()
    // arrows move the focus among the visible options without selecting them
    const before = await checked.innerText()
    await page.keyboard.press('ArrowUp')
    await expect(chooser.getByRole('radio', { checked: true })).toHaveText(before)
    expect(await chooser.locator('[role="radio"]:focus').innerText()).not.toBe(before)
    // Escape closes only the chooser: the detail stays
    await page.keyboard.press('Escape')
    await expect(chooser).toHaveCount(0)
    await expect(dialog).toBeVisible()
    // an outside tap closes it too
    await page.getByTestId('unit-button').click()
    await expect(chooser).toBeVisible()
    await page.mouse.click(206, 30)
    await expect(chooser).toHaveCount(0)
    await expect(dialog).toBeVisible()
    // selecting closes it and changes the unit
    await chooseUnit(page, /^porción \(150 g\)$/)
    await expect(page.getByTestId('unit-button')).toContainText('porción (150 g)')
    // more units behind "Más unidades"
    await page.getByTestId('unit-button').click()
    await expect(page.getByTestId('chooser').locator('details')).not.toHaveAttribute('open', '')
    await page.getByTestId('chooser').getByText('Más unidades', { exact: true }).click()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'kg', exact: true })).toBeVisible()
    await expect(page.getByTestId('chooser').getByRole('radio', { name: 'oz', exact: true })).toBeVisible()
  })

  test('never offers a mass unit for a 100 ml food', async ({ page }) => {
    await seedOffFood(page, BEBIDA)
    await openFood(page, 'bebida prueba')
    const choices = await unitChoices(page)
    expect(choices).toContain('ml')
    expect(choices).toContain('vaso (250 ml)')
    expect(choices).not.toContain('g')
    await page.getByTestId('unit-button').click()
    await page.getByTestId('chooser').getByText('Más unidades', { exact: true }).click()
    const more = await page.getByTestId('chooser').getByRole('radio').allInnerTexts()
    expect(more.map((t) => t.trim())).not.toContain('kg')
    expect(more.map((t) => t.trim())).not.toContain('oz')
    expect(more.map((t) => t.trim())).toContain('litros')
  })
})

test.describe('food detail', () => {
  test.beforeEach(async ({ page }) => {
    await onboard(page)
    await seedOffFood(page, GALLETAS)
  })

  test('logging 2 portions stores the right grams and kcal', async ({ page }) => {
    await openFood(page, 'galletas prueba')
    await chooseUnit(page, /^porción \(150 g\)$/)
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('2')
    await expect(page.getByTestId('portion-equivalence')).toContainText('2 × porción = 300 g')
    // four-cell summary for the chosen quantity: kcal, protein, carbs, fat
    const cells = page.getByTestId('qty-preview')
    await expect(cells).toContainText('1.200')
    await expect(cells).toContainText('kcal')
    await expect(cells).toContainText('proteína')
    await expect(cells).toContainText('carbohidratos')
    await expect(cells).toContainText('grasa')
    await saveFood(page)
    expect(await kcalToday(page)).toBe('1.200') // 400 kcal/100 g x 300 g
    await expect(page.getByTestId('meal-desayuno')).toContainText('2 porciones · 300 g')
    const stored = await page.evaluate(
      () =>
        new Promise<{ qty: number; unit: string; grams: number; portionLabel: string; kcal: number }>((resolve, reject) => {
          const open = indexedDB.open('salud-pho')
          open.onsuccess = () => {
            const all = open.result.transaction('foodLogs').objectStore('foodLogs').getAll()
            all.onsuccess = () => {
              const l = all.result[0]
              resolve({ qty: l.qty, unit: l.unit, grams: l.grams, portionLabel: l.portionLabel, kcal: l.nutrients.kcal })
            }
            all.onerror = () => reject(all.error)
          }
        }),
    )
    expect(stored).toEqual({ qty: 2, unit: 'portion', grams: 300, portionLabel: '1 porción (1 portion (150 g))', kcal: 1200 }) // catalog label kept as identity; displays go through the normaliser
  })

  test('accepts fractions: "1/2" and "1 1/2" of a portion, and a decimal comma', async ({ page }) => {
    await openFood(page, 'galletas prueba')
    await chooseUnit(page, /^porción \(150 g\)$/)
    const qty = page.getByRole('textbox', { name: 'Cantidad' })
    await qty.fill('1 1/2')
    await expect(page.getByTestId('portion-equivalence')).toContainText('1,5 × porción = 225 g')
    await qty.fill('1/2')
    await expect(page.getByTestId('portion-equivalence')).toContainText('0,5 × porción = 75 g')
    await qty.fill('0,5')
    await expect(page.getByTestId('portion-equivalence')).toContainText('75 g')
    await qty.fill('1 1/2')
    await saveFood(page)
    expect(await kcalToday(page)).toBe('900') // 400 kcal/100 g x 225 g
    // the usual range checks still apply
    await openFood(page, 'galletas prueba')
    await chooseUnit(page, /^porción \(150 g\)$/)
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('80')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByTestId('save-food')).toBeDisabled()
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('1/0')
    await expect(page.getByRole('alert')).toContainText('Cantidad no válida')
  })

  test('quick values (½, 1, 1½, 2) only for portions; none for grams; advanced information is folded', async ({ page }) => {
    await openFood(page, 'galletas prueba')
    await chooseUnit(page, 'g')
    await expect(page.getByRole('group', { name: 'Cantidades rápidas' })).toHaveCount(0)
    await chooseUnit(page, /^porción \(150 g\)$/)
    const quick = page.getByRole('group', { name: 'Cantidades rápidas' })
    await expect(quick.getByRole('button')).toHaveText(['½', '1', '1½', '2'])
    await quick.getByRole('button', { name: '1,5' }).click()
    await expect(page.getByRole('textbox', { name: 'Cantidad' })).toHaveValue('1,5')
    // nutrient table, source, own measure and notes are disclosures, closed by default
    const dialog = page.getByRole('dialog')
    for (const id of ['detail-nutrition', 'detail-source', 'detail-my-measure', 'detail-notes']) await expect(dialog.getByTestId(id)).not.toHaveAttribute('open', '')
    await expect(dialog.getByText('Energía y macronutrientes')).toBeHidden()
    await expect(dialog.getByText('Open Food Facts')).toBeHidden()
    await dialog.getByTestId('detail-source').locator('summary').click()
    await expect(dialog.getByTestId('detail-source')).toContainText('Open Food Facts')
  })

  test('the footer button names the meal, the meal is changed from its split part, and the log lands in that meal', async ({ page }) => {
    await openFood(page, 'galletas prueba', 'almuerzo')
    const save = page.getByTestId('save-food')
    await expect(save).toHaveText('Agregar a almuerzo')
    await page.getByTestId('meal-change').click()
    // 3.2: the chooser lists the active slots (a new profile: breakfast, lunch and dinner), not six fixed meals
    await expect(page.getByTestId('chooser').getByRole('radio')).toHaveCount(3)
    await page.getByTestId('chooser').getByRole('radio', { name: 'Cena', exact: true }).click()
    await expect(save).toHaveText('Agregar a cena')
    await chooseUnit(page, 'g')
    await page.getByRole('textbox', { name: 'Cantidad' }).fill('100')
    await saveFood(page)
    await expect(page.getByTestId('meal-cena')).toContainText('Galletas Prueba')
    await expect(page.getByTestId('meal-almuerzo')).not.toContainText('Galletas Prueba')
  })

  test('the footer stays above the simulated keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 })
    await openFood(page, 'galletas prueba')
    await page.getByRole('textbox', { name: 'Cantidad' }).focus()
    await page.evaluate(() => {
      const vv = window.visualViewport!
      Object.defineProperty(vv, 'height', { configurable: true, value: 430 })
      vv.dispatchEvent(new Event('resize'))
    })
    const save = page.getByTestId('save-food')
    await expect.poll(() => save.evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeLessThanOrEqual(431)
    await expect(save).toBeInViewport()
    await expect(page.getByTestId('meal-change')).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Cantidad' })).toBeFocused()
  })
})

test.describe('ideas need real history', () => {
  test('a fresh profile gets no ideas and no explanatory line, on the diary or on the search (3.2: the diary says nothing)', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('ideas-empty')).toHaveCount(0)
    await expect(page.getByText('Cuando registres tus comidas')).toHaveCount(0)
    await expect(page.getByTestId('food-ideas')).toHaveCount(0)
    await expect(page.getByTestId('slot-habits')).toHaveCount(0)
    await page.goto('./#/comida/buscar?meal=almuerzo')
    await expect(page.getByTestId('search-ideas')).toHaveCount(0)
    await expect(page.getByText('Ideas para lo que falta')).toHaveCount(0)
  })

  test('the catalog never fills in: a few days of logs still give no ideas', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/comida/buscar?meal=almuerzo')
    await page.getByTestId('food-search').fill('arroz blanco cocido')
    await page.getByTestId('food-results').locator('button[data-food-row]').first().click()
    await chooseUnit(page, 'g')
    await page.getByTestId('save-food').click()
    await page.goto('./#/comida')
    await expect(page.getByTestId('day-summary')).toBeVisible()
    await expect(page.getByTestId('food-ideas')).toHaveCount(0)
    await expect(page.getByText('del catálogo')).toHaveCount(0)
  })
})

test.describe('diary rows and partial totals', () => {
  async function logWith(page: Page, query: string, qty: string) {
    await openFood(page, query)
    await chooseUnit(page, 'g')
    await page.getByRole('textbox', { name: 'Cantidad' }).fill(qty)
    await saveFood(page)
  }

  test('rows show name, quantity and kcal; no notice and no row marker; the * of a partial total explains itself', async ({ page }) => {
    await onboard(page)
    await seedOffFood(page, GALLETAS)
    await seedOffFood(page, { ...GALLETAS, id: 'off:9990000000004', name: 'Cereal Prueba', barcode: '9990000000004' })
    await seedOffFood(page, BARRA)
    await logWith(page, 'galletas prueba', '100')
    await logWith(page, 'cereal prueba', '50')
    await logWith(page, 'barra prueba', '40')
    await page.goto('./#/comida')
    const meal = page.getByTestId('meal-desayuno')
    // no source tag, no per-row warning, no block of incomplete data in the diary
    expect(await meal.innerText()).not.toMatch(/OFF|USDA|ICBF|datos incompletos/i)
    await expect(meal.getByRole('img', { name: 'Datos incompletos' })).toHaveCount(0)
    await expect(page.getByTestId('incomplete-notice')).toHaveCount(0)
    await expect(page.getByText(/con datos incompletos/)).toHaveCount(0)
    // the * is a control with a 44 px hit area and a name; it opens one sentence and the foods that lack the value
    const mark = page.getByTestId('day-summary').getByRole('button', { name: /^Total parcial de fibra/ })
    await expect(mark).toHaveCount(1)
    const hit = await mark.evaluate((el) => {
      const s = getComputedStyle(el, '::before')
      return [parseFloat(s.width), parseFloat(s.height)]
    })
    expect(hit[0]).toBeGreaterThanOrEqual(44)
    expect(hit[1]).toBeGreaterThanOrEqual(44)
    const fiberBefore = await page.getByTestId('day-summary').innerText()
    await mark.click()
    const sheet = page.getByTestId('partial-sheet')
    await expect(sheet).toContainText('puede ser mayor')
    await expect(sheet).toContainText('Galletas Prueba')
    await expect(sheet).toContainText('Cereal Prueba')
    await expect(sheet).not.toContainText('Barra Prueba') // complete data: not listed
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    expect(await page.getByTestId('day-summary').innerText()).toBe(fiberBefore) // nothing about the numbers changed
    // macros of a meal only when expanded
    await expect(page.getByTestId('meal-macros-desayuno')).toHaveCount(0)
    await page.getByTestId('meal-toggle-desayuno').click()
    await expect(page.getByTestId('meal-macros-desayuno')).toBeVisible()
  })

  test('a row menu repeats an entry (with Deshacer) and deletes it (with Deshacer); tapping the row edits it', async ({ page }) => {
    await onboard(page)
    await seedOffFood(page, BARRA)
    await logWith(page, 'barra prueba', '40') // 200 kcal/100 g x 40 g = 80 kcal
    await page.goto('./#/comida')
    expect(await page.getByTestId('kcal-total').innerText()).toBe('80')
    const rows = page.getByTestId('meal-desayuno').locator('ul > li')
    await expect(rows).toHaveCount(1)
    await rows.first().getByRole('button', { name: /^Acciones de Barra Prueba/ }).click()
    await page.getByRole('menuitem', { name: 'Repetir' }).click()
    await expect(rows).toHaveCount(2)
    expect(await page.getByTestId('kcal-total').innerText()).toBe('160')
    await page.locator('.toast-host').getByRole('button', { name: 'Deshacer' }).click()
    await expect(rows).toHaveCount(1)
    expect(await page.getByTestId('kcal-total').innerText()).toBe('80')
    await rows.first().getByRole('button', { name: /^Acciones de Barra Prueba/ }).click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await expect(rows).toHaveCount(0)
    await page.locator('.toast-host').getByRole('button', { name: 'Deshacer' }).click()
    await expect(rows).toHaveCount(1)
    await rows.first().getByRole('button', { name: /^Barra Prueba/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Cantidad' })).toHaveValue('40')
    await expect(page.getByTestId('save-food')).toContainText('Guardar en desayuno')
  })
})

