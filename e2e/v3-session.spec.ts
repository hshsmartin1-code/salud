import type { Locator, Page } from '@playwright/test'
import { expect, onboard, test } from './helpers'

// V3 live session (focus mode). Synthetic data only: a two-exercise routine created through the UI.

const ROUTINE = 'Pierna sintética'

async function createRoutine(page: Page, queries: string[]) {
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill(ROUTINE)
  for (const q of queries) {
    await page.getByTestId('routine-add-exercise').click()
    await page.getByTestId('exercise-search').fill(q)
    await page.getByTestId('exercise-results').locator('button').first().click()
  }
  await page.getByTestId('save-routine').click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+$/) // saving opens the routine
  await page.goto('./#/entreno')
  await expect(page.getByTestId('routine-card').first()).toBeVisible()
}

async function startRoutine(page: Page) {
  await page.getByTestId('start-routine').first().click()
  await expect(page.getByTestId('live-session')).toBeVisible()
  await expect(page.getByTestId('set-row').first()).toBeVisible()
}

/** Onboards, creates the routine (squat + Romanian deadlift, 3 sets each) and starts it. */
async function startSession(page: Page, queries = ['sentadilla barra', 'peso muerto rumano']) {
  await onboard(page)
  await createRoutine(page, queries)
  await startRoutine(page)
}

const blocks = (page: Page) => page.locator('[data-exercise-id]')
const blockOf = (page: Page, i: number) => blocks(page).nth(i).getByTestId('exercise-block')
const rowsOf = (page: Page, i: number) => blocks(page).nth(i).getByTestId('set-row')

async function fillRow(row: Locator, kg: string, reps: string) {
  await row.getByLabel('kg', { exact: true }).fill(kg)
  await row.getByLabel('Reps', { exact: true }).fill(reps)
}

async function simulateKeyboard(page: Page, height: number) {
  // Chromium desktop opens no Android keyboard: shrink visualViewport as a layout simulation.
  await page.evaluate((h) => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, value: h })
    vv.dispatchEvent(new Event('resize'))
  }, height)
}

test('one tap on the done button completes the set and starts the rest', async ({ page }) => {
  await startSession(page)
  const row = rowsOf(page, 0).nth(0)
  await fillRow(row, '60', '8')
  await expect(page.getByTestId('rest-timer').locator('.readout')).toHaveCount(0) // idle: no countdown yet
  await row.getByTestId('set-done').click()
  await expect(row).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('rest-timer').locator('.readout')).toHaveText(/^\d+:\d\d$/)
  await expect(page.getByTestId('session-volume')).toHaveText('480')
  // The next row was prefilled from the set just done.
  await expect(rowsOf(page, 0).nth(1).getByLabel('kg', { exact: true })).toHaveValue('60')
})

test('focus mode: the sticky bar stays on screen, no navigation, and minimising shows the session bar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await startSession(page)
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0)
  await expect(page.getByTestId('session-ongoing-bar')).toHaveCount(0)

  // Open the last exercise and scroll to it.
  await blockOf(page, 1).getByRole('button', { name: /Desplegar/ }).click()
  await blocks(page).last().evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  const header = page.locator('[data-session-header]')
  await expect.poll(() => header.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0)
  await expect(page.getByTestId('finish-session')).toBeInViewport()
  await expect(page.getByTestId('session-volume')).toBeInViewport()

  await page.getByRole('button', { name: 'Minimizar sesión' }).click()
  await page.goto('./#/comida')
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(1)
  const bar = page.getByTestId('session-ongoing-bar').filter({ visible: true })
  await expect(bar).toContainText(ROUTINE)
  await expect(bar).toBeInViewport()
  await bar.click()
  await expect(page).toHaveURL(/#\/entreno\/sesion\//)
  await expect(page.getByTestId('live-session')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0)
})

test('"Anterior" shows the previous session per row, copies on tap, and a prefilled set completes in one tap', async ({ page }) => {
  await startSession(page, ['sentadilla barra'])
  await fillRow(rowsOf(page, 0).nth(0), '60', '8')
  await rowsOf(page, 0).nth(0).getByTestId('set-done').click()
  await expect(rowsOf(page, 0).nth(0)).toHaveAttribute('data-done', 'true')
  await rowsOf(page, 0).nth(1).getByLabel('kg', { exact: true }).fill('65')
  await rowsOf(page, 0).nth(1).getByTestId('set-done').click()
  await expect(rowsOf(page, 0).nth(1)).toHaveAttribute('data-done', 'true')
  await page.getByTestId('finish-session').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('done-session')).toBeVisible()

  await page.goto('./#/entreno')
  await startRoutine(page)
  const rows = rowsOf(page, 0)
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).getByRole('button', { name: /^Copiar la vez anterior/ })).toHaveText('60 × 8')
  await expect(rows.nth(1).getByRole('button', { name: /^Copiar la vez anterior/ })).toHaveText('65 × 8')
  await expect(rows.nth(2).getByLabel('Sin dato anterior')).toBeVisible()

  // Change the weight, then tap "Anterior": the previous values come back.
  const kg = rows.nth(1).getByLabel('kg', { exact: true })
  await kg.fill('70')
  await rows.nth(1).getByRole('button', { name: /^Copiar la vez anterior/ }).click()
  await expect(kg).toHaveValue('65')
  await expect(rows.nth(1).getByLabel('Reps', { exact: true })).toHaveValue('8')

  // Rows start prefilled from last time: one tap completes the set.
  await expect(rows.nth(0).getByLabel('kg', { exact: true })).toHaveValue('60')
  await rows.nth(0).getByTestId('set-done').click()
  await expect(rows.nth(0)).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('session-volume')).toHaveText('480')
})

test('set type menu: a warm-up shows its letter and is not counted in the volume; delete can be undone', async ({ page }) => {
  await startSession(page)
  const rows = rowsOf(page, 0)
  await expect(rows).toHaveCount(3)
  await rows.nth(2).getByRole('button', { name: /Cambiar tipo/ }).click()
  await page.getByRole('menuitem', { name: 'Eliminar serie' }).click()
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(rows).toHaveCount(3)
  await page.getByTestId('add-set').first().click()
  await expect(rows).toHaveCount(4)

  await fillRow(rows.nth(0), '60', '8')
  await rows.nth(0).getByTestId('set-done').click()
  await expect(page.getByTestId('session-volume')).toHaveText('480')

  await rows.nth(1).getByRole('button', { name: /Cambiar tipo/ }).click()
  await expect(page.getByTestId('set-menu')).toBeVisible()
  await page.getByRole('menuitemradio', { name: /^Calentamiento/ }).click()
  await expect(page.getByTestId('set-menu')).toHaveCount(0)
  await expect(rows.nth(1).getByRole('button', { name: /Cambiar tipo/ })).toHaveText('C')
  await fillRow(rows.nth(1), '40', '10')
  await rows.nth(1).getByTestId('set-done').click()
  await expect(rows.nth(1)).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('session-volume')).toHaveText('480') // warm-up: not counted
  await expect(page.getByTestId('session-strip')).toContainText('1 / 6') // nor in the work-set count (4 + 3 rows, one warm-up)
})

test('exercise blocks fold and unfold, and the next one opens when the current one is complete', async ({ page }) => {
  await startSession(page)
  await expect(blockOf(page, 0)).toHaveAttribute('data-open', 'true')
  await expect(blockOf(page, 1)).toHaveAttribute('data-open', 'false')

  await blockOf(page, 0).getByRole('button', { name: /Plegar/ }).click()
  await expect(blockOf(page, 0)).toHaveAttribute('data-open', 'false')
  await blockOf(page, 0).getByRole('button', { name: /Desplegar/ }).click()
  await expect(blockOf(page, 0)).toHaveAttribute('data-open', 'true')

  const rows = rowsOf(page, 0)
  await fillRow(rows.nth(0), '60', '8')
  for (let i = 0; i < 2; i++) {
    await rows.nth(i).getByTestId('set-done').click()
    await expect(rows.nth(i)).toHaveAttribute('data-done', 'true')
  }
  // Completing the last set folds this block (even though it was toggled by hand) and opens the next.
  await rows.nth(2).getByTestId('set-done').click()
  await expect(blockOf(page, 1)).toHaveAttribute('data-open', 'true')
  await expect(blockOf(page, 0)).toHaveAttribute('data-open', 'false')
  await expect(blockOf(page, 0)).toContainText('3 / 3')
})

test('the RPE column appears from "Ajustes del entreno" and survives a reload', async ({ page }) => {
  await startSession(page)
  await expect(rowsOf(page, 0).nth(0).getByLabel('RPE', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Opciones de la sesión' }).click()
  await page.getByRole('menuitem', { name: 'Ajustes del entreno' }).click()
  await expect(page.getByTestId('training-settings')).toBeVisible()
  await page.getByRole('radio', { name: 'RPE' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('training-settings')).toHaveCount(0)
  const rpe = rowsOf(page, 0).nth(0).getByLabel('RPE', { exact: true })
  await expect(rpe).toBeVisible()
  await rpe.fill('8')
  await page.waitForTimeout(400)
  await page.reload()
  await expect(rowsOf(page, 0).nth(0).getByLabel('RPE', { exact: true })).toHaveValue('8')
})

test('finishing shows the summary with the discarded count, lands on the finished view, and saves a routine', async ({ page }) => {
  await startSession(page)
  await fillRow(rowsOf(page, 0).nth(0), '60', '8')
  await rowsOf(page, 0).nth(0).getByTestId('set-done').click()
  await page.getByTestId('finish-session').click()
  const summary = page.getByTestId('finish-summary')
  await expect(summary).toBeVisible()
  await expect(page.getByTestId('finish-discarded')).toContainText('Se descartarán 5 series sin completar')
  await page.getByTestId('finish-confirm').click()

  await expect(page.getByTestId('done-session')).toBeVisible()
  await expect(page.getByTestId('live-session')).toHaveCount(0)
  await expect(page.getByTestId('session-summary')).toBeVisible()
  await expect(page.getByTestId('done-set')).toHaveCount(1)
  await expect(page.getByTestId('session-volume')).toHaveText('480')
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(1) // focus mode is over

  // Only what was done is listed; the skipped exercise is summarised in one line.
  await expect(page.getByTestId('exercise-block')).toHaveCount(1)
  await expect(page.getByTestId('skipped-exercises').locator('summary')).toHaveText('1 ejercicio planificado sin series')
  await expect(page.getByText('Sin series completadas')).toHaveCount(0)

  await page.getByRole('button', { name: 'Opciones de la sesión' }).click()
  await page.getByRole('menuitem', { name: 'Guardar como rutina' }).click()
  await expect(page.getByText(`Rutina «${ROUTINE} (copia)» creada`)).toBeVisible()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+\/editar$/)
  await expect(page.getByPlaceholder('p. ej. Pierna A')).toHaveValue(`${ROUTINE} (copia)`)
  // Only the exercise with completed sets is kept.
  await expect(page.getByTestId('routine-exercise-block')).toHaveCount(1)
})

test('finish: a pending row with typed values is kept as done by default, "Deshacer" reopens, and the discard path drops it', async ({ page }) => {
  await startSession(page)
  await fillRow(rowsOf(page, 0).nth(0), '60', '8')
  await rowsOf(page, 0).nth(0).getByTestId('set-done').click()
  await expect(rowsOf(page, 0).nth(0)).toHaveAttribute('data-done', 'true')
  await fillRow(rowsOf(page, 0).nth(1), '65', '8') // performed, never ticked

  await page.getByTestId('finish-session').click()
  await expect(page.getByTestId('finish-with-data')).toContainText('Hay 1 serie con datos')
  await expect(page.getByTestId('finish-discarded')).toContainText('Se descartarán 4 series sin completar')
  await expect(page.getByTestId('finish-confirm')).toHaveText('Marcar como hecha la serie con datos')
  await page.getByTestId('finish-confirm').dblclick() // a double tap finishes once
  await expect(page.getByTestId('done-session')).toBeVisible()
  await expect(page.getByTestId('done-set')).toHaveCount(2)
  await expect(page.getByTestId('session-volume')).toHaveText('1.000')
  await expect(page.getByText('Entrenamiento terminado')).toHaveCount(1)

  // Undo: the same session, every row back as it was (the typed row pending again).
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByTestId('live-session')).toBeVisible()
  await expect(rowsOf(page, 0)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Peso muerto rumano, 0 de 3 series. Desplegar' })).toBeVisible() // folded, rows back
  await expect(rowsOf(page, 0).nth(1)).toHaveAttribute('data-done', 'false')
  await expect(rowsOf(page, 0).nth(1).getByLabel('kg', { exact: true })).toHaveValue('65')
  await expect(page.getByTestId('rest-timer').locator('.readout')).toHaveCount(0) // the rest is not restarted

  // The row is still "touched" after undo: discard it this time.
  await page.getByTestId('finish-session').click()
  await expect(page.getByTestId('finish-with-data')).toBeVisible()
  await page.getByTestId('finish-discard').click()
  await expect(page.getByTestId('done-session')).toBeVisible()
  await expect(page.getByTestId('done-set')).toHaveCount(1)
})

test('record moment: a heavier set gets the "Récord" line and a toast, the summary lists it, and unticking removes it', async ({ page }) => {
  await startSession(page, ['sentadilla barra'])
  await fillRow(rowsOf(page, 0).nth(0), '60', '8')
  await rowsOf(page, 0).nth(0).getByTestId('set-done').click()
  await expect(rowsOf(page, 0).nth(0).getByTestId('set-record')).toHaveCount(0) // the first set ever is no record
  const row = rowsOf(page, 0).nth(1)
  await fillRow(row, '70', '8')
  await row.getByTestId('set-done').click()
  await expect(row.getByTestId('set-record')).toHaveText(/Récord · Peso máximo: 70 kg/)
  await expect(page.getByText(/^Récord · Peso máximo: 70 kg/).last()).toBeVisible() // toast

  await page.getByTestId('finish-session').click()
  await expect(page.getByTestId('finish-records')).toContainText('Peso máximo: 70 kg')
  await page.getByRole('button', { name: 'Seguir entrenando' }).click()

  await row.getByTestId('set-done').click() // untick
  await expect(row).toHaveAttribute('data-done', 'false')
  await expect(row.getByTestId('set-record')).toHaveCount(0)
  await expect(row.getByTestId('pr-badge')).toHaveCount(0)
})

test('a finished free session with two exercises saves as a routine and opens it in the editor', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno')
  await page.getByTestId('start-empty-session').click()
  await expect(page.getByTestId('empty-session')).toBeVisible()
  const queries = ['sentadilla barra', 'peso muerto rumano']
  for (let i = 0; i < queries.length; i++) {
    await page.getByTestId('add-exercise').last().click()
    await page.getByTestId('exercise-search').fill(queries[i]!)
    await page.getByTestId('exercise-results').locator('button').first().click()
    await expect(blocks(page)).toHaveCount(i + 1)
    const row = rowsOf(page, i).nth(0)
    await fillRow(row, '50', '10')
    await row.getByTestId('set-done').click()
    await expect(page.getByTestId('session-strip')).toContainText(`Series${i + 1} /`)
  }
  await page.getByTestId('finish-session').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('done-session')).toBeVisible()
  const names = await page.getByTestId('exercise-block').locator('.text-heading').allInnerTexts()
  expect(names).toHaveLength(2)
  await page.getByRole('button', { name: 'Opciones de la sesión' }).click()
  await page.getByRole('menuitem', { name: 'Guardar como rutina' }).click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+\/editar$/)
  const editorBlocks = page.getByTestId('routine-exercise-block')
  await expect(editorBlocks).toHaveCount(2)
  await expect(editorBlocks.nth(0)).toContainText(names[0]!)
  await expect(editorBlocks.nth(1)).toContainText(names[1]!)
})

test('no horizontal overflow at 360 px, even with the RPE column', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await startSession(page)
  await page.getByRole('button', { name: 'Opciones de la sesión' }).click()
  await page.getByRole('menuitem', { name: 'Ajustes del entreno' }).click()
  await page.getByRole('radio', { name: 'RPE' }).click()
  await page.keyboard.press('Escape')
  await expect(rowsOf(page, 0).nth(0).getByLabel('RPE', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  const done = await rowsOf(page, 0).nth(0).getByTestId('set-done').boundingBox()
  expect(done!.x + done!.width).toBeLessThanOrEqual(360)
  expect(done!.width).toBeGreaterThanOrEqual(44)
  const anterior = await blocks(page).first().getByRole('columnheader', { name: 'Anterior' }).boundingBox()
  expect(anterior!.width).toBeGreaterThanOrEqual(52)
})

test('a simulated keyboard keeps the focused row and its done button visible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await startSession(page)
  const row = rowsOf(page, 0).nth(2)
  const kg = row.getByLabel('kg', { exact: true })
  await kg.focus()
  const keyboardTop = 300
  expect(await row.evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThan(keyboardTop) // would be covered
  await simulateKeyboard(page, keyboardTop)
  const headerBottom = () => page.locator('[data-session-header]').evaluate((el) => el.getBoundingClientRect().bottom)
  await expect.poll(() => row.evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeLessThanOrEqual(keyboardTop)
  const top = await row.evaluate((el) => el.getBoundingClientRect().top)
  expect(top).toBeGreaterThanOrEqual((await headerBottom()) - 1)
  const done = await row.getByTestId('set-done').boundingBox()
  expect(done!.y + done!.height).toBeLessThanOrEqual(keyboardTop)
  await expect(kg).toBeFocused()
})

test('render isolation: the clock and the rest re-render alone; typing re-renders only its row', async ({ page }) => {
  await startSession(page)
  const keys = () => page.evaluate(() => ({ ...(window as unknown as { __saludRenderProbe: Record<string, number> }).__saludRenderProbe }))
  const reset = () => page.evaluate(() => void ((window as unknown as { __saludRenderProbe: Record<string, number> }).__saludRenderProbe = {}))

  // Idle: only the clock ticks.
  await reset()
  await page.waitForTimeout(2300)
  let p = await keys()
  expect(p.clock ?? 0).toBeGreaterThanOrEqual(2)
  expect(Object.keys(p).filter((k) => k !== 'clock')).toEqual([])

  // Resting: the pill and the clock tick, no row, block or screen render.
  await fillRow(rowsOf(page, 0).nth(0), '60', '8')
  await rowsOf(page, 0).nth(0).getByTestId('set-done').click()
  await expect(page.getByTestId('rest-timer').locator('.readout')).toBeVisible()
  await page.waitForTimeout(400)
  await reset()
  await page.waitForTimeout(2300)
  p = await keys()
  expect(p.restPill ?? 0).toBeGreaterThanOrEqual(2)
  expect(Object.keys(p).filter((k) => k.startsWith('row:') || k.startsWith('block:') || k === 'screen')).toEqual([])

  // Typing in one row: that row (and its own block, whose data changed) only.
  await reset()
  await rowsOf(page, 0).nth(1).getByLabel('Reps', { exact: true }).pressSequentially('12')
  await page.waitForTimeout(500)
  p = await keys()
  expect(Object.keys(p).filter((k) => k.startsWith('row:'))).toHaveLength(1)
  expect(Object.keys(p).filter((k) => k.startsWith('block:')).length).toBeLessThanOrEqual(1)
})

test('routine warm-ups start first, are not counted, and "+ Serie" after them adds a work set', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill(ROUTINE)
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill('sentadilla barra')
  await page.getByTestId('exercise-results').locator('button').first().click()
  const editor = page.getByTestId('routine-exercise-block').first()
  await editor.getByRole('button', { name: 'Aumentar calentamiento' }).click()
  await editor.getByRole('button', { name: 'Aumentar calentamiento' }).click()
  await page.getByTestId('save-routine').click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+$/)
  await page.goto('./#/entreno')
  await startRoutine(page)

  const rows = rowsOf(page, 0)
  await expect(rows).toHaveCount(5)
  const typeOf = (i: number) => rows.nth(i).getByRole('button', { name: /Cambiar tipo/ })
  await expect(typeOf(0)).toHaveText('C')
  await expect(typeOf(1)).toHaveText('C')
  await expect(typeOf(2)).toHaveText('1')
  await expect(page.getByTestId('session-strip')).toContainText('Series0 / 3')

  await fillRow(rows.nth(0), '40', '10')
  await rows.nth(0).getByTestId('set-done').click()
  await expect(rows.nth(0)).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('session-volume')).toHaveText('0')
  await expect(page.getByTestId('session-strip')).toContainText('Series0 / 3')

  await page.getByTestId('add-set').first().click()
  await expect(rows).toHaveCount(6)
  await expect(typeOf(5)).toHaveText('4')
  await expect(page.getByTestId('session-strip')).toContainText('Series0 / 4')
})

test('"Aplicar a las siguientes" copies a typed row to the later pending rows only, and can be undone', async ({ page }) => {
  await startSession(page, ['sentadilla barra'])
  const rows = rowsOf(page, 0)
  await fillRow(rows.nth(2), '50', '5')
  await rows.nth(2).getByTestId('set-done').click()
  await expect(rows.nth(2)).toHaveAttribute('data-done', 'true')

  await fillRow(rows.nth(0), '70', '10')
  const offer = page.getByTestId('apply-following')
  await expect(offer).toHaveCount(1)
  await expect(offer).toHaveText('Aplicar 70 kg × 10 a las siguientes (1)') // the done row is not offered
  await offer.click()
  await expect(rows.nth(1).getByLabel('kg', { exact: true })).toHaveValue('70')
  await expect(rows.nth(1).getByLabel('Reps', { exact: true })).toHaveValue('10')
  await expect(rows.nth(2).getByLabel('kg', { exact: true })).toHaveValue('50')
  await expect(offer).toHaveCount(0)

  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(rows.nth(1).getByLabel('kg', { exact: true })).toHaveValue('')
  await expect(rows.nth(1).getByLabel('Reps', { exact: true })).toHaveValue('')
})

test('progression hint: after reaching the top of the range, it suggests +2,5 kg and applies it to pending rows on tap', async ({ page }) => {
  await startSession(page, ['sentadilla barra'])
  const rows = rowsOf(page, 0)
  for (let i = 0; i < 3; i++) {
    await fillRow(rows.nth(i), '60', '12')
    await expect(page.getByTestId('progression-hint')).toHaveCount(0) // first time: no hint
    await rows.nth(i).getByTestId('set-done').click()
    if (i < 2) await expect(rows.nth(i)).toHaveAttribute('data-done', 'true') // the last one folds the block
  }
  await page.getByTestId('finish-session').click()
  await page.getByTestId('finish-confirm').click()
  await expect(page.getByTestId('done-session')).toBeVisible()

  await page.goto('./#/entreno')
  await startRoutine(page)
  const hint = page.getByTestId('progression-hint')
  // V3.1: a compact chip "+2,5 kg" on the context line; the explanation opens on tap.
  await expect(hint).toContainText('+2,5 kg')
  await expect(page.getByTestId('progression-explain')).toHaveCount(0)
  await hint.getByRole('button', { name: /Sugerencia de progresión/ }).click()
  await expect(page.getByTestId('progression-explain')).toContainText('La vez anterior completaste 3 × 12: prueba +2,5 kg')
  await expect(rows.nth(0).getByLabel('kg', { exact: true })).toHaveValue('60') // never applied on its own
  await page.getByTestId('progression-explain').getByRole('button', { name: 'Aplicar 62,5 kg a las 3 series pendientes' }).click()
  for (let i = 0; i < 3; i++) await expect(rows.nth(i).getByLabel('kg', { exact: true })).toHaveValue('62,5')
  await expect(hint).toHaveCount(0)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(rows.nth(0).getByLabel('kg', { exact: true })).toHaveValue('60')
  await expect(hint).toBeVisible()
})
