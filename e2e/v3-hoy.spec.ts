// Hoy: continuity block, in-place quick logging, empty state and layout at 360 px.
// Uses the synthetic demo seed (src/test/seed/demoSeed.ts) restored through the app's own import flow.
import type { Page } from '@playwright/test'
import { clickUndo, demoJson, demoWith, expect, onboard, restoreJson, test } from './helpers'

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

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.describe('Hoy with the demo seed', () => {
  test.beforeEach(async ({ page }) => {
    await restoreDemo(page)
  })

  test('Comida goes to the search for the meal of the hour, keeping today', async ({ page }) => {
    await page.getByTestId('hoy-quick-meal').click()
    await expect(page).toHaveURL(/#\/comida\/buscar\?meal=(desayuno|media_manana|almuerzo|onces|cena|otro)$/)
  })

  test('Peso and Sueño sheets open in place', async ({ page }) => {
    const here = page.url()
    await page.getByTestId('hoy-quick-weight').click()
    await expect(page.getByRole('dialog', { name: 'Registrar peso' })).toBeVisible()
    expect(page.url()).toBe(here)
    await page.keyboard.press('Escape')
    await page.getByTestId('hoy-quick-sleep').click()
    await expect(page.getByRole('dialog', { name: 'Registrar sueño' })).toBeVisible()
    expect(page.url()).toBe(here)
  })

  test('without a plan there is no routine recommendation on Hoy: one quiet row to Entreno', async ({ page }) => {
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    await expect(page.getByTestId('training-go')).toHaveAttribute('href', /#\/entreno$/)
  })

  test('the weekly summary keeps its content (folded) and drops the old start card', async ({ page }) => {
    await expect(page.getByTestId('range-stats')).toContainText('Resumen de la semana')
    await expect(page.getByTestId('range-stats')).toContainText('Energía consumida')
    await expect(page.getByTestId('start-session')).toHaveCount(0)
    await expect(page.locator('[data-indicator]').first()).toBeVisible()
  })
})

test.describe('Hoy with today planned (Pierna A)', () => {
  test.beforeEach(async ({ page }) => {
    await restoreJson(page, await demoWith({ plan: { 3: { routine: 'Pierna A' }, 5: { routine: 'Torso A' } } }))
  })

  test('the card under the greeting starts the planned routine with exactly one tap and opens the session', async ({ page }) => {
    await expect(page.getByTestId('training-due')).toContainText('Pierna A')
    await expect(page.getByTestId('now-other')).toHaveAttribute('href', /#\/entreno$/)
    const start = page.getByTestId('start-last-routine')
    await expect(start).toHaveAccessibleName('Iniciar Pierna A')
    await start.click() // the one and only tap
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    await expect(page.getByTestId('set-row').first()).toBeVisible()
  })

  test('with a session in progress Hoy shows no bar of its own (the shell has one), no card and no second start', async ({ page }) => {
    await page.getByTestId('start-last-routine').click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    const url = page.url()
    await page.goto('./')
    await expect(page.getByTestId('active-session')).toHaveCount(0)
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)
    await expect(page.getByTestId('training-due')).toHaveCount(0)
    const bar = page.getByTestId('session-ongoing-bar').filter({ visible: true })
    await expect(bar).toHaveCount(1)
    await expect(bar).toContainText('Pierna A')
    await bar.click()
    expect(page.url()).toBe(url)
  })

  test('no horizontal overflow at 360 px, with the card and with a session in progress', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.reload()
    await expect(page.getByTestId('training-due')).toBeVisible()
    expect(await noOverflow(page)).toBe(true)
    await page.getByTestId('start-last-routine').click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    await page.goto('./')
    await expect(page.getByTestId('session-ongoing-bar').filter({ visible: true })).toBeVisible()
    expect(await noOverflow(page)).toBe(true)
  })
})

test.describe('Hoy with a fresh profile', () => {
  test('shows a real empty state that still offers the quick actions', async ({ page }) => {
    await onboard(page)
    const quick = page.getByTestId('hoy-quick')
    for (const name of ['Comida', 'Agua', 'Peso', 'Sueño']) await expect(quick.getByRole(name === 'Comida' ? 'link' : 'button', { name })).toBeVisible()
    // Short empty state: the action, the quick actions and one sentence; no rings, no empty tiles.
    await expect(page.getByTestId('hoy-empty')).toContainText('Aún no hay registros')
    await expect(page.getByTestId('day-summary')).toHaveCount(0)
    await expect(page.getByTestId('start-free-session')).toHaveCount(0) // no routine is recommended without a plan
    await expect(page.getByTestId('training-go')).toContainText('Ir a Entreno')
    // Nothing to say yet: no insights block, no placeholder.
    await expect(page.getByTestId('insights')).toHaveCount(0)
    await page.setViewportSize({ width: 360, height: 800 })
    expect(await noOverflow(page)).toBe(true)
  })

  test('water quick log stays on the page and Deshacer removes exactly that row', async ({ page }) => {
    await onboard(page)
    const here = page.url()
    const water = page.locator('[data-indicator=water]')
    await page.getByTestId('hoy-quick-water').click()
    await page.getByTestId('quick-water-250').click()
    await expect(page.locator('.toast-host')).toContainText('+250 ml de agua')
    await expect(water).toContainText('0,25')
    await page.getByTestId('hoy-quick-water').click()
    await page.getByTestId('quick-water-500').click()
    await expect(water).toContainText('0,75')
    expect(page.url()).toBe(here)
    await clickUndo(page)
    await expect(water).toContainText('0,25')
    await expect(water).not.toContainText('0,75')
    // The first row is still stored.
    await page.goto('./#/agua')
    await expect(page.getByTestId('water-entries')).toContainText('250 ml')
    await expect(page.getByTestId('water-entries')).not.toContainText('500 ml')
  })
})
