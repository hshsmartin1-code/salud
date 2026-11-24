import { ANA, BETO, expect, fillProfile, installClock, onboard, switchProfile, test } from '../e2e/helpers'
import type { Page } from '@playwright/test'

// Account linking end to end against the local Firebase emulators (fake Google identities,
// synthetic profiles). Two browser contexts act as two devices sharing the same emulated cloud.
const SHOTS = process.env.SALUD_SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function signIn(page: Page, email: string) {
  await page.getByTestId('emu-email').fill(email)
  await page.getByTestId('sign-in').click()
}

test('links two local profiles to two accounts, refuses mixing, and restores on a second device', async ({ page, browser }) => {
  await onboard(page, ANA, BETO)
  await switchProfile(page, ANA.name)
  await page.goto('./#/ajustes')
  await page.getByRole('link', { name: /Cuenta y sincronización/ }).click()
  await expect(page.getByTestId('sign-in')).toBeVisible()
  await shot(page, '01-sign-in')

  await signIn(page, 'ana@example.test')
  await expect(page.getByTestId('link-wizard')).toBeVisible()
  await expect(page.getByTestId('link-run')).toBeDisabled()
  await shot(page, '02-wizard')
  await page.getByTestId('confirm-owner').check()
  await page.getByTestId('link-run').click()
  await expect(page.getByText(/Vinculado y verificado/)).toBeVisible({ timeout: 30_000 })
  await shot(page, '03a-result')
  await page.getByRole('button', { name: 'Ver estado de la sincronización' }).click()
  await expect(page.getByTestId('sync-status')).toContainText(/Sincronizado|Sincronizando/)
  await shot(page, '03-linked')

  // The second person cannot reuse the first person's account on this device.
  await switchProfile(page, BETO.name)
  await page.goto('./#/cuenta')
  await signIn(page, 'ana@example.test')
  await expect(page.getByText(/ya está vinculada a otro perfil/)).toBeVisible()
  await expect(page.getByTestId('link-run')).toHaveCount(0)
  await shot(page, '04-account-in-use')
  await page.getByRole('button', { name: 'Cancelar y cerrar sesión' }).click()
  await signIn(page, 'beto@example.test')
  await page.getByTestId('confirm-owner').check()
  await page.getByTestId('link-run').click()
  await expect(page.getByText(/Vinculado y verificado/)).toBeVisible({ timeout: 30_000 })

  // Second device: an unrelated profile signs in to Ana's account and downloads into a NEW profile.
  const ctx = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 412, height: 915 } })
  const other = await ctx.newPage()
  await other.goto('./')
  await fillProfile(other, { name: 'Otra Persona', sex: 'Mujer', birth: '1980-01-01', height: '160', weight: '55', goal: 'Mantener' }, { welcome: true })
  await other.getByRole('button', { name: 'Empezar' }).click()
  await other.goto('./#/cuenta')
  await signIn(other, 'ana@example.test')
  await expect(other.getByText(/no coincide con «Otra Persona»/)).toBeVisible()
  await expect(other.getByTestId('strategy-new')).toBeChecked()
  await shot(other, '05-name-mismatch')
  await other.getByTestId('confirm-owner').check()
  await other.getByTestId('link-run').click()
  await other.getByRole('button', { name: 'Abrir el perfil nuevo' }).click({ timeout: 30_000 })
  await expect(other.getByTestId('profile-switcher').filter({ visible: true })).toContainText(ANA.name)
  await other.goto('./#/cuenta')
  await expect(other.getByTestId('sync-status')).toBeVisible()
  await expect(other.getByText('ana@example.test')).toBeVisible()
  await shot(other, '06-second-device')

  // The original profile on that device is untouched and not linked.
  await switchProfile(other, 'Otra Persona')
  await other.goto('./#/cuenta')
  await expect(other.getByTestId('sign-in')).toBeVisible()
  await ctx.close()

  // Signing out keeps the data and the link.
  await switchProfile(page, ANA.name)
  await page.goto('./#/cuenta')
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('sync-status')).toContainText('Sesión cerrada')
  await expect(page.getByText('Vuelve a iniciar sesión')).toBeVisible()
  await shot(page, '07-signed-out')
})

test('"Unir" on a second device that recorded the same weigh-in shows it as a probable duplicate and leaves it out', async ({ page, browser }) => {
  // Device 1: Ana's profile (onboarding records today's weight) linked to a fresh account.
  await onboard(page, ANA)
  await page.goto('./#/cuenta')
  await signIn(page, 'ana.dup@example.test')
  await page.getByTestId('confirm-owner').check()
  await page.getByTestId('link-run').click()
  await expect(page.getByText(/Vinculado y verificado/)).toBeVisible({ timeout: 30_000 })

  // Device 2: the same person onboarded separately (same weigh-in today, different ids) and joins.
  const ctx = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 412, height: 915 } })
  await installClock(ctx) // same "today" as device 1
  const other = await ctx.newPage()
  await onboard(other, ANA)
  await other.goto('./#/cuenta')
  await signIn(other, 'ana.dup@example.test')
  await expect(other.getByTestId('link-duplicates')).toContainText('Posibles duplicados: 1 en mediciones')
  await expect(other.getByTestId('skip-duplicates')).toBeChecked()
  await shot(other, '08-duplicates')
  await other.getByTestId('confirm-owner').check()
  await other.getByTestId('link-run').click()
  await expect(other.getByText(/Se omitió 1 duplicado probable/)).toBeVisible({ timeout: 30_000 })
  await ctx.close()
})
