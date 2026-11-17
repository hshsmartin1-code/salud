import { ANA, expect, onboard, test } from './helpers'

// V3.1 first run, goals, settings and backup: progressive disclosure. The default e2e build has NO sync
// configuration, so this file covers the unconfigured welcome; the Google paths run in e2e-emulator/.

test('welcome: what the app is for, local mode as the only action, restore link, no "dos perfiles" anywhere', async ({ page, request }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salud' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuar sin cuenta' })).toBeVisible()
  await expect(page.getByTestId('restore-link')).toContainText('Restaurar un respaldo')
  // Sync is not configured in this build: no Google button and no sentence promising it.
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toHaveCount(0)
  await expect(page.getByText('Sincroniza tus datos entre dispositivos')).toHaveCount(0)
  expect(await page.locator('body').innerText()).not.toMatch(/dos perfiles/i)
  expect(await page.title()).not.toMatch(/dos perfiles/i)
  const html = await (await request.get('./')).text()
  expect(html).not.toMatch(/dos perfiles/i)
  const manifest = await (await request.get('manifest.webmanifest')).text()
  expect(manifest).not.toMatch(/dos perfiles/i)
})

test('the local path creates a profile with no network at all', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Continuar sin cuenta' }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(ANA.name)
  await page.getByText(ANA.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(ANA.birth)
  await page.getByLabel('Estatura').fill(ANA.height)
  await page.getByLabel('Peso actual').fill(ANA.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Mantener' }).click()
  await page.getByRole('button', { name: 'Guardar y continuar' }).click()
  await expect(page.getByRole('heading', { name: `Perfil de ${ANA.name} listo` })).toBeVisible()
  const profiles = await page.evaluate(async () => {
    const req = indexedDB.open('salud-pho')
    return await new Promise<number>((res, rej) => {
      req.onerror = () => rej(req.error)
      req.onsuccess = () => {
        const r = req.result.transaction('profiles').objectStore('profiles').count()
        r.onsuccess = () => res(r.result)
      }
    })
  })
  expect(profiles).toBe(1)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
})

test('basics ask only for what is needed (colour is folded)', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Continuar sin cuenta' }).click()
  for (const label of ['Nombre', 'Fecha de nacimiento', 'Estatura', 'Peso actual', 'Actividad habitual']) await expect(page.getByLabel(label, { exact: label === 'Nombre' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Color / })).toHaveCount(0)
  await page.getByTestId('profile-color').getByText('Color del perfil').click()
  await expect(page.getByRole('button', { name: /^Color / }).first()).toBeVisible()
})

test('goals: four choices, four figures, and the formula only after opening the disclosure', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Continuar sin cuenta' }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(ANA.name)
  await page.getByText(ANA.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(ANA.birth)
  await page.getByLabel('Estatura').fill(ANA.height)
  await page.getByLabel('Peso actual').fill(ANA.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await page.getByRole('button', { name: 'Continuar' }).click()

  const editor = page.getByTestId('goal-editor')
  for (const g of ['Perder grasa', 'Mantener', 'Ganar masa', 'Recomposición']) await expect(editor.getByRole('button', { name: g })).toBeVisible()
  await editor.getByRole('button', { name: 'Mantener' }).click()
  const figures = page.getByTestId('goal-figures')
  for (const f of ['Calorías', 'Proteína', 'Carbos', 'Grasa']) await expect(figures).toContainText(f)
  await expect(figures.getByRole('button', { name: 'Ajustar' })).toBeVisible()

  // Everything technical is folded: formula name, TMB, parameters, method text.
  await expect(page.getByText(/Mifflin/).filter({ visible: true })).toHaveCount(0)
  await expect(page.getByLabel('Déficit')).toBeHidden()
  await expect(page.getByText(/TMB/).filter({ visible: true })).toHaveCount(0)
  await page.getByTestId('goal-method').getByText('Cómo calculamos tus objetivos').click()
  await expect(page.getByText(/Mifflin/).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByLabel('Déficit')).toBeVisible()
  await expect(page.getByText(/TMB/).filter({ visible: true }).first()).toBeVisible()

  // Manual adjustment stays possible.
  await figures.getByRole('button', { name: 'Ajustar' }).click()
  await expect(page.getByLabel('Energía')).toBeVisible()
  await page.getByTestId('goal-auto').click()
  await expect(page.getByTestId('goal-figures')).toBeVisible()
})

test('settings is a short list in the agreed order; credits and method live under Avanzado', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/ajustes')
  await expect(page.getByTestId('settings-list')).toBeVisible()
  const rows = page.getByTestId('settings-list').locator('[data-row]')
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-row')))).toEqual(['cuenta', 'perfil', 'preferencias', 'tiempos', 'actualizaciones', 'privacidad', 'datos', 'avanzado'])
  await expect(page.locator('[data-row="cuenta"]')).toContainText('Sin cuenta')
  await expect(page.locator('[data-row="actualizaciones"]')).toContainText('Actualizaciones')
  // Closed by default: nothing technical on the screen.
  await expect(page.getByTestId('repdb-credit')).toBeHidden()
  await expect(page.getByText('Fuentes de datos y licencias')).toBeHidden()
  await expect(page.getByText(/IndexedDB/)).toBeHidden()
  await page.getByTestId('privacy-detail').getByText('Cómo se guardan tus datos').click()
  await expect(page.getByText(/IndexedDB/)).toBeVisible()
  await page.getByTestId('settings-advanced').getByText('Avanzado', { exact: true }).click()
  await expect(page.getByText('Fuentes de datos y licencias')).toBeVisible()
  await expect(page.getByTestId('bodyparts3d-credit')).toBeAttached()
  await expect(page.getByRole('heading', { name: 'Cómo se calcula' })).toBeAttached()
  await expect(page.getByTestId('app-version')).toBeAttached()
  // The rows lead where they say.
  await page.locator('[data-row="datos"]').getByRole('link').click()
  await expect(page).toHaveURL(/#\/respaldo$/)
})

test('backup: export and import are plain; advanced tools sit in a closed disclosure with every control intact', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/respaldo')
  await expect(page.getByTestId('export-profile')).toBeVisible()
  await expect(page.getByTestId('import-backup-file')).toBeAttached()
  await expect(page.getByTestId('backup-note')).toContainText('respaldo')
  for (const t of ['Historial previo (fase 0)', 'Tabla ICBF (TCAC 2015)', 'Almacenamiento', 'Verificar datos']) await expect(page.getByRole('heading', { name: t })).toBeHidden()
  await page.getByTestId('backup-advanced').getByText('Herramientas avanzadas').click()
  for (const t of ['Historial previo (fase 0)', 'Tabla ICBF (TCAC 2015)', 'Almacenamiento', 'Verificar datos']) await expect(page.getByRole('heading', { name: t })).toBeVisible()
  await page.getByTestId('integrity-run').click()
  await expect(page.getByTestId('integrity-ok')).toContainText('Todo en orden')
})

test('"Más" lists the account first and follows the settings order', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/mas')
  const labels = await page.getByRole('main').getByRole('link').allInnerTexts()
  const clean = labels.map((l) => l.trim())
  const idx = (t: string) => clean.findIndex((l) => l.startsWith(t))
  expect(idx('Cuenta y sincronización')).toBeGreaterThan(-1)
  expect(idx('Cuenta y sincronización')).toBeLessThan(idx('Perfil y objetivos'))
  expect(idx('Perfil y objetivos')).toBeLessThan(idx('Ajustes'))
  expect(idx('Ajustes')).toBeLessThan(idx('Datos y respaldos'))
  await page.getByRole('main').getByRole('link', { name: /Cuenta y sincronización/ }).click()
  await expect(page.getByTestId('sync-not-configured')).toBeVisible()
})
