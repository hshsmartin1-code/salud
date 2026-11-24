// V3.2 «Mi planificación» on the Entreno home. Synthetic data only; the suite clock is Wednesday 2026-11-18 16:30
// (America/Bogota) unless a describe pins another one with `test.use({ clockAt })`.
import type { Page } from '@playwright/test'
import { demoJson, expect, onboard, test } from './helpers'

const plan = (page: Page) => page.getByTestId('plan-section')
const cell = (page: Page, date: string) => page.locator(`[data-testid="plan-day"][data-date="${date}"]`)

async function createRoutine(page: Page, name: string, query: string) {
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill(name)
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill(query)
  await page.getByTestId('exercise-results').locator('button').first().click()
  await page.getByTestId('save-routine').click()
  await expect(page).toHaveURL(/#\/entreno\/rutinas\/(?!nueva$)[^/]+$/)
}

async function openHome(page: Page) {
  await page.goto('./#/entreno')
  await expect(plan(page)).toBeVisible()
}

/** Creates the plan from the empty state by picking weekdays (1 = Monday … 7 = Sunday). */
async function planWeekdays(page: Page, names: string[]) {
  await page.getByTestId('plan-create').click()
  for (const n of names) await page.getByTestId('plan-setup').getByRole('button', { name: n, exact: true }).click()
  await page.getByTestId('plan-done').click()
}

const countRows = (page: Page, table: string) =>
  page.evaluate(
    (t) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('salud-pho')
        req.onsuccess = () => {
          const all = req.result.transaction(t).objectStore(t).getAll()
          all.onsuccess = () => resolve(all.result.length)
          all.onerror = () => reject(all.error)
        }
        req.onerror = () => reject(req.error)
      }),
    table,
  )
const dump = (page: Page, tables: string[]) =>
  page.evaluate(
    (ts) =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('salud-pho')
        req.onsuccess = async () => {
          try {
            const out: Record<string, unknown[]> = {}
            for (const t of ts) {
              out[t] = await new Promise<unknown[]>((res, rej) => {
                const all = req.result.transaction(t).objectStore(t).getAll()
                all.onsuccess = () => res((all.result as { id: string }[]).sort((a, b) => a.id.localeCompare(b.id)))
                all.onerror = () => rej(all.error)
              })
            }
            resolve(JSON.stringify(out))
          } catch (e) {
            reject(e)
          }
        }
        req.onerror = () => reject(req.error)
      }),
    tables,
  )

test.describe('plan on a fresh profile (Wednesday 18)', () => {
  test('without a plan: one sentence and «Planificar semana»; a days-only plan works with zero routines', async ({ page }) => {
    await onboard(page)
    await openHome(page)
    await expect(page.getByTestId('plan-empty')).toContainText('Elige los días en que entrenas')
    await expect(page.getByTestId('plan-day')).toHaveCount(0)
    await expect(page.getByTestId('plan-create')).toHaveText(/Planificar semana/)

    await planWeekdays(page, ['Lunes', 'Miércoles', 'Viernes'])
    await expect(page.getByTestId('plan-day')).toHaveCount(7)
    await expect(cell(page, '2026-11-16')).toHaveAttribute('data-status', 'planned') // Monday
    await expect(cell(page, '2026-11-17')).toHaveAttribute('data-status', 'rest')
    await expect(cell(page, '2026-11-18')).toHaveAttribute('data-status', 'planned') // today
    await expect(cell(page, '2026-11-18')).toContainText('Entreno')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: hoy')
    await expect(page.getByTestId('plan-start')).toBeVisible()
    // The plan lives in the profile settings and survives a reload.
    await page.reload()
    await expect(page.getByTestId('plan-day')).toHaveCount(7)
    await expect(cell(page, '2026-11-20')).toHaveAttribute('data-status', 'planned')
  })

  test('the week strip: names, states and the today marker are readable without colour', async ({ page }) => {
    await onboard(page)
    await openHome(page)
    await planWeekdays(page, ['Lunes', 'Miércoles'])
    await expect(cell(page, '2026-11-18')).toHaveAccessibleName('miércoles 18, entreno, hoy')
    await expect(cell(page, '2026-11-17')).toHaveAccessibleName('martes 17, descanso')
    await expect(cell(page, '2026-11-16')).toHaveAccessibleName('lunes 16, entreno')
    // Keyboard: the cell is a button; Enter opens its sheet, Escape closes it and returns focus.
    await cell(page, '2026-11-19').focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Jueves 19' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('radiogroup', { name: 'Todos los jueves' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('assign routines per weekday, rest a weekday, and the next session follows', async ({ page }) => {
    await onboard(page)
    await createRoutine(page, 'Pierna sintética', 'sentadilla barra')
    await createRoutine(page, 'Torso sintético', 'press banca')
    await openHome(page)
    await planWeekdays(page, ['Miércoles', 'Jueves'])
    // Thursday → Torso sintético
    await cell(page, '2026-11-19').click()
    await page.getByRole('dialog').getByLabel('Rutina', { exact: true }).selectOption({ label: 'Torso sintético' })
    await page.keyboard.press('Escape')
    await expect(cell(page, '2026-11-19')).toContainText('Torso') // the first word; the full name is in the accessible name
    await expect(cell(page, '2026-11-19')).toHaveAccessibleName('jueves 19, entreno: Torso sintético')
    // Wednesday (today) → Pierna sintética
    await cell(page, '2026-11-18').click()
    await page.getByRole('dialog').getByLabel('Rutina', { exact: true }).selectOption({ label: 'Pierna sintética' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: hoy · Pierna sintética')
    // On a phone the dock offers the same routine, so the plan block keeps only the text (no second «Iniciar»).
    await expect(page.getByTestId('plan-start')).toHaveCount(0)
    await expect(page.getByTestId('start-last-routine')).toHaveAccessibleName('Iniciar Pierna sintética')
    await expect(page.getByTestId('start-last-routine')).toContainText('Iniciar · hoy')
    // Every Wednesday becomes rest → the next session is Thursday.
    await cell(page, '2026-11-18').click()
    await page.getByRole('dialog').getByRole('radio', { name: 'Descanso' }).first().click()
    await page.keyboard.press('Escape')
    await expect(cell(page, '2026-11-18')).toHaveAttribute('data-status', 'rest')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: jue 19 · Torso sintético')
    await expect(page.getByTestId('plan-start')).toHaveCount(0)
  })

  test('move this week\'s session to another day, and undo it with «Quitar cambio»', async ({ page }) => {
    await onboard(page)
    await openHome(page)
    await planWeekdays(page, ['Jueves'])
    await cell(page, '2026-11-19').click()
    const dialog = page.getByRole('dialog', { name: 'Jueves 19' })
    await dialog.getByLabel('Mover a otro día').selectOption({ label: 'Sábado 21' })
    await expect(dialog).toHaveCount(0)
    await expect(cell(page, '2026-11-19')).toHaveAttribute('data-status', 'rest')
    await expect(cell(page, '2026-11-21')).toHaveAttribute('data-status', 'planned')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: sáb 21')
    // Only this week: next Thursday still trains.
    await page.reload()
    await expect(cell(page, '2026-11-21')).toHaveAttribute('data-status', 'planned')
    await cell(page, '2026-11-19').click()
    await page.getByTestId('plan-clear-override').click()
    await expect(cell(page, '2026-11-19')).toHaveAttribute('data-status', 'planned')
    await expect(cell(page, '2026-11-21')).toHaveAttribute('data-status', 'planned') // the move target has its own override
    await page.keyboard.press('Escape')
    await cell(page, '2026-11-21').click()
    await page.getByTestId('plan-clear-override').click()
    await expect(cell(page, '2026-11-21')).toHaveAttribute('data-status', 'rest')
  })

  test('starting from the plan creates exactly one session; after finishing, today is done and the next one moves on', async ({ page }) => {
    await onboard(page)
    await createRoutine(page, 'Pierna sintética', 'sentadilla barra')
    await openHome(page)
    await planWeekdays(page, ['Miércoles', 'Viernes'])
    await cell(page, '2026-11-18').click()
    await page.getByRole('dialog').getByLabel('Rutina', { exact: true }).selectOption({ label: 'Pierna sintética' })
    await page.keyboard.press('Escape')
    expect(await countRows(page, 'trainingSessions')).toBe(0) // planning creates nothing

    await page.getByTestId('start-last-routine').dblclick() // the dock offers today's routine; a second tap never starts another
    await expect(page.getByTestId('live-session')).toBeVisible()
    expect(await countRows(page, 'trainingSessions')).toBe(1)

    // While it is active the day is not "done".
    await page.goto('./#/entreno')
    await expect(cell(page, '2026-11-18')).toHaveAttribute('data-status', 'planned')
    await page.getByTestId('active-session').click()
    await expect(page.getByTestId('live-session')).toBeVisible()
    const row = page.getByTestId('set-row').first()
    await row.getByLabel('kg', { exact: true }).fill('60')
    await row.getByLabel('Reps', { exact: true }).fill('8')
    await row.getByTestId('set-done').click()
    await page.getByTestId('finish-session').click()
    await page.getByTestId('finish-confirm').click()
    await expect(page.getByTestId('done-session')).toBeVisible()

    await page.goto('./#/entreno')
    await expect(cell(page, '2026-11-18')).toHaveAttribute('data-status', 'done')
    await expect(cell(page, '2026-11-18')).toHaveAccessibleName('miércoles 18, entreno hecho, hoy')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: vie 20')
    await expect(page.getByTestId('plan-start')).toHaveCount(0)
    expect(await countRows(page, 'trainingSessions')).toBe(1)
  })

  test('360 px: no horizontal overflow, the collapsed block stays compact and day cells are 44 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await onboard(page)
    await createRoutine(page, 'Pierna de nombre bastante largo', 'sentadilla barra')
    await openHome(page)
    await planWeekdays(page, ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
    await cell(page, '2026-11-18').click()
    await page.getByRole('dialog').getByLabel('Rutina', { exact: true }).selectOption({ label: 'Pierna de nombre bastante largo' })
    await page.keyboard.press('Escape')
    await expect(plan(page)).toContainText('Pierna de nombre')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = (await plan(page).boundingBox())!
    expect(box.height).toBeLessThanOrEqual(170)
    for (const c of await page.getByTestId('plan-day').all()) {
      const b = (await c.boundingBox())!
      expect(b.width).toBeGreaterThanOrEqual(44)
      expect(b.height).toBeGreaterThanOrEqual(44)
    }
    // The sheets fit too.
    await cell(page, '2026-11-19').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByTestId('plan-edit').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('removing the plan returns to the empty state and keeps routines and sessions', async ({ page }) => {
    await onboard(page)
    await createRoutine(page, 'Pierna sintética', 'sentadilla barra')
    await openHome(page)
    await planWeekdays(page, ['Miércoles'])
    await page.getByTestId('plan-edit').click()
    // On the web the reminder cannot be scheduled: the control says so and offers nothing to switch.
    await expect(page.getByTestId('plan-reminder-web')).toContainText('Disponible en la app de Android')
    await expect(page.getByRole('switch')).toHaveCount(0)
    await page.getByTestId('plan-remove').click()
    await page.getByRole('button', { name: 'Quitar', exact: true }).click()
    await expect(page.getByTestId('plan-empty')).toBeVisible()
    expect(await countRows(page, 'routines')).toBe(1)
  })
})

test.describe('week rollover (Sunday 23:59 → Monday 00:01)', () => {
  test.use({ clockAt: '2026-11-22T23:59:00-05:00' })
  test('the strip moves to the new week and the next session follows', async ({ page }) => {
    await onboard(page)
    await openHome(page)
    await planWeekdays(page, ['Domingo', 'Lunes'])
    await expect(page.getByTestId('plan-day').first()).toHaveAttribute('data-date', '2026-11-16')
    await expect(cell(page, '2026-11-22')).toHaveAccessibleName('domingo 22, entreno, hoy')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: hoy')
    await page.clock.fastForward('02:00')
    await expect(page.getByTestId('plan-day').first()).toHaveAttribute('data-date', '2026-11-23')
    await expect(cell(page, '2026-11-23')).toHaveAccessibleName('lunes 23, entreno, hoy')
    await expect(page.getByTestId('plan-next')).toHaveText('Próxima sesión: hoy')
    await expect(cell(page, '2026-11-29')).toHaveAttribute('data-status', 'planned')
  })
})

test.describe('history is never touched', () => {
  test('creating, editing, moving and removing the plan leaves sessions, sets and routines byte-identical', async ({ page }) => {
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

    const tables = ['trainingSessions', 'exerciseSets', 'routines']
    await openHome(page)
    const before = await dump(page, tables)
    const sessionsBefore = await countRows(page, 'trainingSessions')
    const recentBefore = await page.getByTestId('recent-history').innerText()
    expect(sessionsBefore).toBeGreaterThan(20)

    await planWeekdays(page, ['Jueves', 'Sábado'])
    await cell(page, '2026-11-19').click()
    await page.getByRole('dialog').getByLabel('Rutina', { exact: true }).selectOption({ label: 'Torso A' })
    await page.keyboard.press('Escape')
    await cell(page, '2026-11-19').click()
    await page.getByRole('dialog').getByLabel('Mover a otro día').selectOption({ label: 'Viernes 20' })
    await expect(cell(page, '2026-11-20')).toHaveAttribute('data-status', 'planned')
    await page.getByTestId('plan-edit').click()
    await page.getByTestId('plan-remove').click()
    await page.getByRole('button', { name: 'Quitar', exact: true }).click()
    await expect(page.getByTestId('plan-empty')).toBeVisible()

    expect(await dump(page, tables)).toBe(before)
    expect(await countRows(page, 'trainingSessions')).toBe(sessionsBefore)
    expect(await page.getByTestId('recent-history').innerText()).toBe(recentBefore)
  })
})
