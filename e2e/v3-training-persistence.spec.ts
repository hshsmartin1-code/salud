import type { Page } from '@playwright/test'
import { expect, onboard, test } from './helpers'

// V3 training persistence: what is typed survives an abrupt close, the rest timer survives a reload,
// and there is never a second session in progress. Synthetic data only.

async function startRoutineSession(page: Page) {
  await onboard(page)
  await page.goto('./#/entreno/rutinas/nueva')
  await page.getByPlaceholder('p. ej. Pierna A').fill('Pierna sintética')
  await page.getByTestId('routine-add-exercise').click()
  await page.getByTestId('exercise-search').fill('sentadilla barra')
  await page.getByTestId('exercise-results').locator('button').first().click()
  await page.getByTestId('save-routine').click()
  await page.getByTestId('start-routine').click()
  await expect(page.getByTestId('set-row')).toHaveCount(3)
  return page.url()
}

/** Sessions stored for any profile, read straight from IndexedDB. */
function countSessions(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('salud-pho')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const c = db.transaction('trainingSessions').objectStore('trainingSessions').count()
          c.onsuccess = () => {
            resolve(c.result)
            db.close()
          }
          c.onerror = () => reject(c.error)
        }
      }),
  )
}

const seconds = (t: string) => {
  const [m, s] = t.trim().split(':').map(Number)
  return m! * 60 + s!
}

test('a weight typed without leaving the field survives closing the app abruptly', async ({ page, context }) => {
  const url = await startRoutineSession(page)
  const kg = page.getByTestId('set-row').nth(0).getByLabel('kg')
  await kg.click()
  await kg.pressSequentially('72,5')
  await expect(kg).toBeFocused() // never blurred
  await page.waitForTimeout(400)
  await page.close({ runBeforeUnload: false })

  const again = await context.newPage()
  await again.goto(url)
  await expect(again.getByTestId('set-row').nth(0).getByLabel('kg')).toHaveValue('72,5')
})

test('the rest timer keeps counting through a reload', async ({ page }) => {
  await startRoutineSession(page)
  const row = page.getByTestId('set-row').nth(0)
  await row.getByLabel('kg').fill('60')
  await row.getByLabel('Reps').fill('8')
  await row.getByTestId('set-done').click()
  const readout = page.getByTestId('rest-timer').locator('.readout')
  await expect(readout).toHaveText(/^\d+:\d\d$/)
  const first = seconds(await readout.innerText())
  await page.waitForTimeout(3000)
  await page.reload()
  await expect(readout).toHaveText(/^\d+:\d\d$/)
  const after = seconds(await readout.innerText())
  // Continued from where it was (not restarted, not lost): about 3 s less, allowing for slow CI.
  expect(after).toBeLessThanOrEqual(first - 2)
  expect(after).toBeGreaterThan(first - 15)
})

test('starting another session opens the one in progress instead of creating a second', async ({ page }) => {
  const url = await startRoutineSession(page)
  expect(await countSessions(page)).toBe(1)
  await page.goto('./#/entreno')
  await expect(page.getByTestId('active-session')).toHaveCount(1)

  // Declining the question changes nothing.
  await page.getByTestId('start-empty-session').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ahora no' }).click()
  await expect(page).toHaveURL(/#\/entreno$/)
  expect(await countSessions(page)).toBe(1)

  // Accepting opens the existing session.
  await page.getByTestId('start-routine').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar entrenamiento' }).click()
  await expect(page).toHaveURL(url)
  await expect(page.getByTestId('set-row')).toHaveCount(3)
  expect(await countSessions(page)).toBe(1)
})
