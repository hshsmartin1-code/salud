import { ANA, BETO, expect, fillProfile, onboard, switcher, test } from './helpers'
import type { Page } from '@playwright/test'

async function dump(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.databases ? await indexedDB.databases() : []
    const name = open.find((d) => d.name)?.name ?? 'salud'
    return await new Promise<{ profiles: { id: string; name: string }[]; goals: { profileId: string }[]; body: { profileId: string; weightKg: number }[] }>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const all = (t: string) =>
          new Promise<any[]>((res, rej) => {
            const r = db.transaction(t).objectStore(t).getAll()
            r.onsuccess = () => res(r.result)
            r.onerror = () => rej(r.error)
          })
        void Promise.all([all('profiles'), all('goals'), all('bodyMeasurements')]).then(([profiles, goals, body]) => resolve({ profiles, goals, body }))
      }
    })
  })
}

/** Two clicks in the same task, before React can re-render a disabled state. */
async function doubleTap(page: Page, name: string) {
  await page.getByRole('button', { name }).evaluate((el: HTMLElement) => {
    el.click()
    el.click()
  })
}

async function openAddProfile(page: Page) {
  await switcher(page).click()
  await page.getByRole('button', { name: /Agregar perfil/ }).click()
  await expect(page).toHaveURL(/#\/perfiles\/nuevo/)
}

test('Agregar perfil from the switcher runs every step and creates exactly one active profile with goals', async ({ page }) => {
  await onboard(page, ANA)
  await openAddProfile(page)
  await fillProfile(page, BETO)
  // Step 3 is reached (the wizard did not reset to step 1).
  await expect(page.getByRole('heading', { name: /Perfil de Beto Prueba listo/ })).toBeVisible()
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await expect(switcher(page)).toContainText(BETO.name)

  const d = await dump(page)
  expect(d.profiles.map((p) => p.name).sort()).toEqual([ANA.name, BETO.name])
  const beto = d.profiles.find((p) => p.name === BETO.name)!
  const ana = d.profiles.find((p) => p.name === ANA.name)!
  expect(d.goals.filter((g) => g.profileId === beto.id)).toHaveLength(1)
  expect(d.goals.filter((g) => g.profileId === ana.id)).toHaveLength(1)
  expect(d.body.find((b) => b.profileId === beto.id)?.weightKg).toBe(80)
  expect(d.body.find((b) => b.profileId === ana.id)?.weightKg).toBe(60)
  await page.goto('./#/cuerpo')
  await expect(page.getByTestId('latest-weight')).toContainText('80')
})

test('leaving the wizard at the goals step and coming back resumes the same profile, no duplicate', async ({ page }) => {
  await onboard(page, ANA)
  await openAddProfile(page)
  await page.getByLabel('Nombre', { exact: true }).fill(BETO.name)
  await page.getByText(BETO.sex, { exact: true }).click()
  await page.getByLabel('Peso actual').fill(BETO.weight)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: /Objetivos de Beto Prueba/ })).toBeVisible()
  // Still Ana's data on screen: the new profile is not active until the wizard is finished.
  await expect(switcher(page)).toContainText(ANA.name)

  await page.goto('./#/comida')
  await openAddProfile(page)
  await expect(page.getByRole('heading', { name: /Objetivos de Beto Prueba/ })).toBeVisible()
  expect((await dump(page)).profiles.map((p) => p.name).sort()).toEqual([ANA.name, BETO.name])

  await page.getByRole('button', { name: 'Configurar después' }).click()
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(switcher(page)).toContainText(BETO.name)
  expect((await dump(page)).profiles).toHaveLength(2)
  // The draft is gone: a new "Agregar perfil" starts at step 1.
  await openAddProfile(page)
  await expect(page.getByRole('heading', { name: 'Nuevo perfil' })).toBeVisible()
})

test('abandoning before "Continuar" creates nothing; a double tap creates one profile', async ({ page }) => {
  await onboard(page, ANA)
  await openAddProfile(page)
  await page.getByLabel('Nombre', { exact: true }).fill(BETO.name)
  await page.goto('./#/')
  expect((await dump(page)).profiles).toHaveLength(1)

  await openAddProfile(page)
  await page.getByLabel('Nombre', { exact: true }).fill(BETO.name)
  await page.getByText(BETO.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(BETO.birth)
  await page.getByLabel('Estatura').fill(BETO.height)
  await page.getByLabel('Peso actual').fill(BETO.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await doubleTap(page, 'Continuar')
  await expect(page.getByRole('heading', { name: /Objetivos de Beto Prueba/ })).toBeVisible()
  await page.getByRole('button', { name: 'Perder grasa' }).click()
  await doubleTap(page, 'Guardar y continuar')
  await expect(page.getByRole('heading', { name: /Perfil de Beto Prueba listo/ })).toBeVisible()
  const d = await dump(page)
  expect(d.profiles).toHaveLength(2)
  const beto = d.profiles.find((p) => p.name === BETO.name)!
  expect(d.goals.filter((g) => g.profileId === beto.id)).toHaveLength(1)
})
