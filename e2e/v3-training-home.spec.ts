// V3 training home, routine library, routine detail, editor and history. Synthetic data only: the demo seed
// (src/test/seed/demoSeed.ts) is restored through the app's own import flow, like e2e/v3-capture.mjs does.
import type { Page } from '@playwright/test'
import { demoBackup, demoJson, expect, onboard, test, today } from './helpers'

async function restoreDemo(page: Page, at?: string | null) {
  const json = await demoJson(at)
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

interface Totals { sessions: number; sets: number; volume: number }

/** Independent recomputation, from the seed rows, of this week so far and of the whole previous one (Monday weeks). */
async function weekFacts(at?: string | null): Promise<{ week: Totals; previousFull: Totals }> {
  const b = await demoBackup<{ tables: { trainingSessions: { id: string; date: string; status: string }[]; exerciseSets: { sessionId: string; weight: number | null; reps: number | null; isWarmup: boolean; done: boolean }[] } }>(at)
  const now = today(at)
  const dow = new Date(`${now}T12:00:00Z`).getUTCDay()
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const start = addDays(now, -((dow + 6) % 7))
  const totals = (from: string, to: string): Totals => {
    const ids = new Set(b.tables.trainingSessions.filter((s) => s.status === 'done' && s.date >= from && s.date <= to).map((s) => s.id))
    const sets = b.tables.exerciseSets.filter((x) => ids.has(x.sessionId) && x.done && !x.isWarmup)
    return { sessions: ids.size, sets: sets.length, volume: Math.round(sets.reduce((acc, x) => acc + (x.weight ?? 0) * (x.reps ?? 0), 0)) }
  }
  return { week: totals(start, now), previousFull: totals(addDays(start, -7), addDays(start, -1)) }
}
const es = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0, useGrouping: 'always' }).format(n)

async function addExercise(page: Page, query: string) {
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill(query)
  await page.getByTestId('exercise-results').locator('button').first().click()
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('with the demo seed', () => {
  test.beforeEach(async ({ page, clockAt }) => {
    await restoreDemo(page, clockAt)
  })

  // Whatever day the suite runs, the week block follows ONE rule: four read-outs always; with at least one
  // finished session this week, deltas against the same point of the last week; with none, no deltas, the
  // "not yet" line and last week as a plain reference.
  test('the week shows four read-outs with a neutral comparison', async ({ page, clockAt }) => {
    const facts = await weekFacts(clockAt)
    await page.goto('./#/entreno')
    const readouts = page.getByTestId('week-readouts')
    await expect(readouts).toBeVisible()
    for (const label of ['Sesiones', 'Series de trabajo', 'Volumen', 'Tiempo']) await expect(readouts).toContainText(label)
    await expect(readouts.locator('.readout')).toHaveCount(4)
    if (facts.week.sessions > 0) {
      await expect(readouts).toContainText('vs. sem. anterior')
    } else {
      await expect(readouts).not.toContainText('vs. sem. anterior')
      await expect(page.getByTestId('week-note')).toContainText('Aún no has entrenado esta semana.')
    }
    // V3.1: the weekly chart, the records and the weekly group bars live on /entreno/estadisticas; the home keeps three history cards.
    await expect(page.getByTestId('chart-panel')).toHaveCount(0)
    await expect(page.getByTestId('recent-records')).toHaveCount(0)
    await expect(page.getByTestId('recent-history').getByTestId('session-row')).toHaveCount(3)
  })

  test('the calendar marks trained days, states the streak and opens a day', async ({ page }) => {
    await page.goto('./#/entreno')
    const cal = page.getByTestId('training-calendar')
    await expect(cal).toBeVisible()
    expect(await cal.getByTestId('calendar-day-trained').count()).toBeGreaterThanOrEqual(5)
    await expect(page.getByTestId('week-streak')).toContainText(/\d+ semanas seguidas con al menos 1 sesión/)
    await cal.getByTestId('calendar-day-trained').first().click()
    await expect(page).toHaveURL(/#\/entreno\/(sesion\/|historial\?dia=\d{4}-\d{2}-\d{2})/)
    await page.goto('./#/entreno/historial?dia=2000-01-01')
    await expect(page.getByTestId('history-day')).toContainText('Mostrando solo el')
    await page.getByRole('button', { name: 'Quitar filtro' }).click()
    await expect(page.getByTestId('history-month').first()).toBeVisible()
  })

  test('the last-used routine starts with one tap on /entreno', async ({ page }) => {
    await page.goto('./#/entreno')
    await page.getByTestId('start-last-routine').click() // the one and only tap
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    await expect(page.getByTestId('set-row').first()).toBeVisible()
  })

  test('with a session in progress the home continues it and never opens a second one', async ({ page }) => {
    await page.goto('./#/entreno')
    await page.getByTestId('start-last-routine').click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
    const url = page.url()
    await page.goto('./#/entreno')
    await expect(page.getByTestId('active-session')).toContainText('Continuar entrenamiento')
    await expect(page.getByTestId('start-last-routine')).toHaveCount(0)

    await page.getByTestId('start-empty-session').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Ya hay un entrenamiento en curso')
    await dialog.getByRole('button', { name: 'Ahora no' }).click()
    await expect(page).toHaveURL(/#\/entreno$/)

    await page.getByTestId('routine-card').first().getByTestId('start-routine').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Continuar entrenamiento' }).click()
    await expect(page).toHaveURL(url)
    const sessions = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('salud-pho')
          req.onsuccess = () => {
            const all = req.result.transaction('trainingSessions').objectStore('trainingSessions').getAll()
            all.onsuccess = () => resolve((all.result as { status: string }[]).filter((s) => s.status === 'active').length)
            all.onerror = () => reject(all.error)
          }
          req.onerror = () => reject(req.error)
        }),
    )
    expect(sessions).toBe(1)
  })

  test('/entreno?iniciar=1 opens the start sheet with the routines and the free option', async ({ page }) => {
    await page.goto('./#/entreno?iniciar=1')
    const sheet = page.getByTestId('start-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('start-sheet-routine')).toHaveCount(3)
    await expect(sheet.getByTestId('start-sheet-free')).toContainText('Entrenamiento libre')
    await sheet.getByTestId('start-sheet-routine').first().click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
  })

  test('routine cards show exercises, sets, last date and a duration backed by past sessions', async ({ page }) => {
    await page.goto('./#/entreno')
    const card = page.getByTestId('routine-card').filter({ hasText: 'Pierna A' })
    await expect(card.getByTestId('routine-sets')).toHaveText(/^6 ejercicios · \d+ series$/)
    await expect(card.getByTestId('routine-last')).toContainText(/Última vez: \p{L}{3,4}\.? \d+ \p{L}{3,4}\.? · ~\d+ min/u)
  })

  test('the routine detail shows the strip, the exercises with their last performance and a fixed start button', async ({ page }) => {
    await page.goto('./#/entreno')
    await page.getByTestId('routine-link').first().click()
    await expect(page.getByTestId('routine-strip')).toContainText('Series')
    await expect(page.getByTestId('routine-exercise')).toHaveCount(6)
    await expect(page.getByTestId('routine-exercise').first()).toContainText(/\d+ series · .*descanso \d:\d\d/)
    await expect(page.getByTestId('routine-exercise').first()).toContainText('Última vez')
    const box = await page.getByTestId('start-routine').boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(915)
    await page.getByTestId('start-routine').click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
  })

  test('manual order persists after a reload', async ({ page }) => {
    await page.goto('./#/entreno/rutinas')
    await expect(page.getByTestId('library-row')).toHaveCount(3)
    const names = () => page.getByTestId('library-row').locator('h3').allInnerTexts()
    const before = await names()
    await page.getByRole('button', { name: `Más acciones de ${before[0]}` }).click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()
    await expect.poll(names).toEqual([before[1], before[0], before[2]])
    await page.reload()
    await expect.poll(names).toEqual([before[1], before[0], before[2]])
    // The home follows the manual order.
    await page.goto('./#/entreno')
    await expect(page.getByTestId('routine-card').first()).toContainText(before[1]!)
  })

  test('library rows start a routine in one tap and show thumbnails and groups', async ({ page }) => {
    await page.goto('./#/entreno/rutinas')
    const row = page.getByTestId('library-row').first()
    await expect(row.getByTestId('routine-sets')).toHaveText(/^6 ejercicios · \d+ series$/)
    await expect(row.getByTestId('routine-last')).toContainText('Última vez')
    await expect(page.getByTestId('routine-search')).toHaveCount(0) // search appears above 5 routines
    await row.getByTestId('library-start').click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
  })

  test('drag handle and arrow keys reorder and persist; search appears with more than 5 routines', async ({ page }) => {
    await page.goto('./#/entreno/rutinas')
    const names = () => page.getByTestId('library-row').locator('h3').allInnerTexts()
    await expect(page.getByTestId('library-row')).toHaveCount(3)
    const before = await names()
    const box = (await page.getByTestId('drag-handle').first().boundingBox())!
    const rowH = (await page.getByTestId('library-row').first().boundingBox())!.height
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + rowH * 1.2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(names).toEqual([before[1], before[0], before[2]])
    await page.reload()
    await expect.poll(names).toEqual([before[1], before[0], before[2]])
    // keyboard: the handle answers ArrowDown
    const handle = page.getByTestId('drag-handle').first()
    await handle.focus()
    await expect(handle).toBeFocused()
    await handle.press('ArrowDown')
    await expect.poll(names).toEqual([before[0], before[1], before[2]])

    // three copies make six routines: the search field appears and filters by name, exercise and muscle
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: `Más acciones de ${before[0]}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Duplicar' }).click()
      await expect(page.getByTestId('library-row')).toHaveCount(4 + i)
    }
    const search = page.getByTestId('routine-search')
    await expect(search).toBeVisible()
    await search.fill('sentadilla')
    expect(await page.getByTestId('library-row').count()).toBeGreaterThan(0)
    await search.fill('zzzz')
    await expect(page.getByTestId('library-row')).toHaveCount(0)
    await search.fill('espalda')
    expect(await page.getByTestId('library-row').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('drag-handle')).toHaveCount(0) // no dragging while filtering
  })

  test('duplicate, archive, restore and delete', async ({ page }) => {
    await page.goto('./#/entreno/rutinas')
    await expect(page.getByTestId('library-row')).toHaveCount(3)
    const menu = (name: string) => page.getByRole('button', { name: `Más acciones de ${name}` })
    await menu('Torso A').click()
    await page.getByRole('menuitem', { name: 'Duplicar' }).click()
    await expect(page.getByTestId('library-row')).toHaveCount(4)
    await expect(page.getByTestId('library-list')).toContainText('Torso A (copia)')

    await menu('Torso A (copia)').click()
    await page.getByRole('menuitem', { name: 'Archivar' }).click()
    await expect(page.getByTestId('library-row')).toHaveCount(3)
    await page.getByTestId('archived-toggle').click()
    await expect(page.getByTestId('archived-list')).toContainText('Torso A (copia)')

    await page.getByTestId('restore-routine').click()
    await expect(page.getByTestId('library-row')).toHaveCount(4)
    await expect(page.getByTestId('archived-toggle')).toHaveCount(0)

    await menu('Torso A (copia)').click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar rutina' }).click()
    await expect(page.getByTestId('library-row')).toHaveCount(3)
    await expect(page.getByTestId('library-list')).not.toContainText('(copia)')
  })

  test('the history groups sessions by month and Repetir starts that routine', async ({ page }) => {
    await page.goto('./#/entreno/historial')
    await expect(page.getByTestId('history-page')).toBeVisible()
    expect(await page.getByTestId('history-month').count()).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('history-month').first().getByRole('heading')).toHaveText(/^[A-ZÁÉÍÓÚ][a-záéíóú]+ \d{4}$/)
    await page.getByTestId('session-row').first().getByRole('button', { name: /Más acciones de/ }).click()
    await page.getByRole('menuitem', { name: /^Repetir/ }).click()
    await expect(page).toHaveURL(/#\/entreno\/sesion\//)
  })

  test('nothing overflows horizontally at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const hash of ['#/entreno', '#/entreno/historial', '#/entreno/rutinas', '#/entreno?iniciar=1']) {
      await page.goto('./' + hash)
      await page.waitForTimeout(500)
      expect(await noOverflow(page), hash).toBe(true)
    }
    await page.goto('./#/entreno')
    await page.getByTestId('routine-link').first().click()
    await expect(page.getByTestId('routine-detail')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await noOverflow(page), 'detail').toBe(true)
    await page.goto(page.url() + '/editar')
    await expect(page.getByTestId('routine-editor')).toBeVisible()
    expect(await noOverflow(page), 'editor').toBe(true)
  })
})

test.describe('with a fresh profile', () => {
  test('starter templates become normal routines in one tap, with Deshacer', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/entreno/rutinas')
    const cards = page.getByTestId('template-card')
    await expect(cards).toHaveCount(4)
    await cards.nth(1).getByRole('button', { name: 'Ver ejercicios' }).click()
    await expect(cards.nth(1)).toContainText('Press de banca plano con mancuernas')
    await expect(cards.nth(1)).toContainText('3 × 8–10 · 1:30')
    await cards.nth(1).getByTestId('use-template').click() // Torso / Pierna: two routines
    await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Torso', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByTestId('routine-exercise')).toHaveCount(6)
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await page.goto('./#/entreno/rutinas')
    await expect(page.getByTestId('library-row')).toHaveCount(0)
    await page.getByTestId('template-card').nth(3).getByTestId('use-template').click()
    await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+$/)
    await page.goto('./#/entreno/rutinas')
    await expect(page.getByTestId('library-row')).toHaveCount(1)
    await expect(page.getByTestId('library-list')).toContainText('En casa')
  })

  test('empty home points to the first action', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/entreno')
    await expect(page.getByTestId('training-empty')).toContainText('Aún no has terminado ningún entrenamiento')
    await expect(page.getByTestId('empty-new-routine')).toBeVisible()
    await expect(page.getByTestId('start-empty-session')).toBeVisible()
  })

  test('editor: two exercises with warm-ups, sets, reps, rest and note survive save and reopen; the guard asks; a new routine has no duration estimate', async ({ page }) => {
    await onboard(page)
    await page.goto('./#/entreno/rutinas/nueva')
    await expect(page.getByTestId('save-routine')).toBeDisabled() // the name is the only required field
    await page.getByPlaceholder('p. ej. Pierna A').fill('Pierna e2e')
    await addExercise(page, 'sentadilla barra')
    await addExercise(page, 'curl')
    const blocks = page.getByTestId('routine-exercise-block')
    await expect(blocks).toHaveCount(2)
    // only the block just added is open; tapping a summary opens it and closes the others
    await expect(blocks.nth(0).getByTestId('exercise-summary')).toHaveAttribute('aria-expanded', 'false')
    await expect(blocks.nth(1).getByTestId('exercise-summary')).toHaveAttribute('aria-expanded', 'true')
    await blocks.nth(0).getByTestId('exercise-summary').click()
    await expect(blocks.nth(1).getByTestId('exercise-summary')).toHaveAttribute('aria-expanded', 'false')
    const first = blocks.nth(0)
    await first.getByRole('button', { name: 'Aumentar calentamiento' }).click()
    await first.getByRole('button', { name: 'Aumentar calentamiento' }).click()
    await first.getByRole('button', { name: 'Aumentar series' }).click()
    await first.getByRole('button', { name: '3:00', exact: true }).click()
    await first.getByLabel('Repeticiones objetivo (opcional)').fill('6-8')
    await first.getByRole('button', { name: 'Añadir nota' }).click()
    await first.getByLabel('Nota (opcional)').fill('Asiento 4')

    // second block: move it up and back through its menu, then check the order
    await blocks.nth(1).getByRole('button', { name: /^Acciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Subir' }).click()
    await expect(blocks.nth(0)).not.toContainText('Asiento 4')
    await blocks.nth(0).getByRole('button', { name: /^Acciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Bajar' }).click()

    await page.getByTestId('save-routine').click()
    await expect(page).toHaveURL(/#\/entreno\/rutinas\/[^/]+$/)
    await expect(page.getByTestId('routine-exercise')).toHaveCount(2)
    await expect(page.getByTestId('routine-exercise').first()).toContainText('4 series · 6–8 reps · descanso 3:00 · 2 calentamientos')
    await expect(page.getByTestId('routine-exercise').first()).toContainText('Nota: Asiento 4')
    // the confirmation toast sits above the bottom bar, not over it
    const toastBox = await page.locator('.toast-host > *').first().boundingBox()
    const dockBox = await page.getByTestId('dock-bar').boundingBox()
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(dockBox!.y)
    await expect(page.getByTestId('routine-estimate')).toHaveCount(0)
    await expect(page.getByTestId('detail-last')).toContainText('Aún sin hacer')

    // card on the home: counts and last date, no duration
    const detailUrl = page.url()
    await page.goto('./#/entreno')
    const card = page.getByTestId('routine-card').filter({ hasText: 'Pierna e2e' })
    await expect(card.getByTestId('routine-sets')).toHaveText('2 ejercicios · 7 series')
    await expect(card.getByTestId('routine-last')).toHaveText('Aún sin hacer')

    // reopen
    await page.goto(detailUrl + '/editar')
    const again = page.getByTestId('routine-exercise-block').nth(0)
    await expect(again.getByTestId('exercise-summary')).toContainText('4 series · 6–8 reps · descanso 3:00 · 2 calent.')
    await again.getByTestId('exercise-summary').click()
    await expect(again.getByRole('textbox', { name: 'Series' })).toHaveValue('4')
    await expect(again.getByRole('textbox', { name: 'Calentamiento' })).toHaveValue('2')
    await expect(again.getByLabel('Repeticiones objetivo (opcional)')).toHaveValue('6-8')
    await expect(again.getByRole('button', { name: '3:00', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(again.getByLabel('Nota (opcional)')).toHaveValue('Asiento 4')
    await expect(page.getByTestId('save-routine')).toBeDisabled() // nothing changed: nothing to write

    // unsaved-changes guard
    await page.getByPlaceholder('p. ej. Pierna A').fill('Pierna e2e B')
    await page.getByRole('link', { name: 'Volver' }).click()
    await expect(page.getByRole('dialog')).toContainText('¿Salir sin guardar?')
    await page.getByRole('dialog').getByRole('button', { name: 'Seguir editando' }).click()
    await expect(page).toHaveURL(/\/editar$/)
    await page.getByRole('link', { name: 'Volver' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click()
    await expect(page).toHaveURL(detailUrl)
    await expect(page.getByRole('heading', { name: 'Pierna e2e', exact: true })).toBeVisible()

    // removing an exercise offers Deshacer
    await page.goto(detailUrl + '/editar')
    await page.getByTestId('routine-exercise-block').nth(1).getByRole('button', { name: /^Acciones de/ }).click()
    await page.getByRole('menuitem', { name: 'Quitar' }).click()
    await expect(page.getByTestId('routine-exercise-block')).toHaveCount(1)
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(page.getByTestId('routine-exercise-block')).toHaveCount(2)
  })
})

// The state the home must handle on its own: the first minutes of a week, and the last of one.
const MONDAY_AFTER_MIDNIGHT = '2026-11-16T00:10:00-05:00'
const SUNDAY_NIGHT = '2026-11-22T23:50:00-05:00'
const WEDNESDAY_AFTERNOON = '2026-11-18T16:30:00-05:00'

test.describe('Monday 00:10: the week has just started', () => {
  test.use({ clockAt: MONDAY_AFTER_MIDNIGHT })

  test('four zero read-outs, no comparison, the not-yet line and last week as a plain reference', async ({ page }) => {
    const facts = await weekFacts(MONDAY_AFTER_MIDNIGHT)
    expect(facts.week.sessions).toBe(0)
    expect(facts.previousFull.sessions).toBeGreaterThan(0)
    await restoreDemo(page, MONDAY_AFTER_MIDNIGHT)
    await page.goto('./#/entreno')
    const readouts = page.getByTestId('week-readouts')
    await expect(readouts.locator('.readout')).toHaveCount(4)
    const readout = (label: string) => readouts.locator(':scope > div').filter({ hasText: label })
    await expect(readout('Sesiones').locator('.readout')).toHaveText('0')
    await expect(readout('Series de trabajo').locator('.readout')).toHaveText('0')
    await expect(readout('Volumen').locator('.readout')).toHaveText(/^0\s*kg$/)
    await expect(readout('Tiempo').locator('.readout')).toHaveText('—')
    // No judgement: no delta of any kind, no arrow, no percentage.
    await expect(readouts).not.toContainText('vs. sem. anterior')
    await expect(readouts).not.toContainText('%')
    expect(await readouts.locator('svg').count()).toBe(0)
    await expect(page.getByTestId('week-note')).toHaveText('Aún no has entrenado esta semana.')
    const p = facts.previousFull
    await expect(page.getByTestId('week-reference')).toHaveText(`La semana pasada: ${p.sessions} ${p.sessions === 1 ? 'sesión' : 'sesiones'} · ${p.sets} ${p.sets === 1 ? 'serie' : 'series'} · ${es(p.volume)} kg`)
    // The sections below do not leave a hole.
    await expect(page.getByTestId('recovery-section')).toBeVisible()
    await expect(page.getByTestId('training-calendar')).toBeVisible()
  })
})

for (const [name, at, partial] of [['Wednesday 16:30', WEDNESDAY_AFTERNOON, true], ['Sunday 23:50', SUNDAY_NIGHT, false]] as const) {
  test.describe(name, () => {
    test.use({ clockAt: at })
    test(`deltas appear against the same point of last week${partial ? ' and say so' : ' (full week against full week)'}`, async ({ page }) => {
      const facts = await weekFacts(at)
      expect(facts.week.sessions).toBeGreaterThan(0)
      await restoreDemo(page, at)
      await page.goto('./#/entreno')
      const readouts = page.getByTestId('week-readouts')
      await expect(readouts.locator(':scope > div').filter({ hasText: 'Sesiones' })).toContainText('vs. sem. anterior')
      await expect(readouts.locator(':scope > div').filter({ hasText: 'Volumen' })).toContainText(es(facts.week.volume))
      if (partial) await expect(page.getByTestId('week-note')).toHaveText('Comparado con la semana pasada hasta este mismo día.')
      else await expect(page.getByTestId('week-note')).toHaveCount(0)
      await expect(page.getByTestId('week-reference')).toHaveCount(0)
    })
  })
}
