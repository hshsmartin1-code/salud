import { ANA, BETO, expect, fillProfile, installClock, test, type TestProfile } from '../e2e/helpers'
import type { Browser, Page } from '@playwright/test'

// "Continuar con Google" on a fresh device, end to end against the local Firebase emulators (fake Google
// identities, synthetic people). Every context is a separate device sharing the same emulated cloud.
test.describe.configure({ mode: 'serial' })

const uniq = Date.now().toString(36)
const mail = (who: string) => `${who}.${uniq}@example.test`
const MARA: TestProfile = { name: 'Mara Prueba', sex: 'Mujer', birth: '1992-02-02', height: '168', weight: '61', goal: 'Mantener' }

async function device(browser: Browser) {
  const ctx = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 412, height: 915 } })
  await installClock(ctx)
  return { ctx, page: await ctx.newPage() }
}

/** Reads every row of one Dexie table straight from IndexedDB. */
async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(
    (t) =>
      new Promise<any[]>((res, rej) => {
        const open = indexedDB.open('salud-pho')
        open.onerror = () => rej(open.error)
        open.onsuccess = () => {
          const r = open.result.transaction(t).objectStore(t).getAll()
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        }
      }),
    table,
  )
}

/** Keys of the persisted Firebase sessions (one per signed-in app instance). */
async function authKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((res) => {
        const open = indexedDB.open('firebaseLocalStorageDb')
        open.onerror = () => res([])
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) return res([])
          const r = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAllKeys()
          r.onsuccess = () => res((r.result as string[]).map(String))
          r.onerror = () => res([])
        }
      }),
  )
}
const sessionsOf = (keys: string[], app: string) => keys.filter((k) => k.startsWith('firebase:authUser:') && k.endsWith(`:${app}`))

async function signInWelcome(page: Page, email: string) {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continuar sin cuenta' })).toBeVisible()
  await expect(page.getByText('Sincroniza tus datos entre dispositivos. Los respaldos siguen siendo tuyos.')).toBeVisible()
  await page.getByTestId('emu-email').fill(email)
  await page.getByTestId('welcome-google').click()
}

async function fillBasics(page: Page, p: TestProfile) {
  await page.getByLabel('Nombre', { exact: true }).fill(p.name)
  await page.getByText(p.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(p.birth)
  await page.getByLabel('Estatura').fill(p.height)
  await page.getByLabel('Peso actual').fill(p.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await page.getByRole('button', { name: 'Continuar' }).click()
}

/** Google first with an empty account: basics → explicit link → goals → dashboard. */
async function createLinked(page: Page, email: string, p: TestProfile, opts: { keepOpen?: boolean } = {}) {
  await signInWelcome(page, email)
  await expect(page.getByRole('heading', { name: 'Cuéntanos de ti' })).toBeVisible()
  await fillBasics(page, p)
  await expect(page.getByTestId('link-step')).toBeVisible()
  // Nothing is linked until the person confirms.
  expect(await rows(page, 'syncLinks')).toHaveLength(0)
  await page.getByRole('button', { name: `Vincular este perfil a ${email}` }).click()
  await expect(page.getByRole('heading', { name: `Objetivos de ${p.name}` })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: p.goal! }).click()
  await page.getByRole('button', { name: 'Guardar y continuar' }).click()
  if (opts.keepOpen) return
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
}

async function syncNow(page: Page) {
  await page.goto('./#/cuenta')
  await page.getByTestId('sync-now').click()
  await expect(page.getByTestId('sync-status')).toContainText('Sincronizado', { timeout: 30_000 })
}

const EMAIL_MARA = mail('mara')

test('Google first with an EMPTY cloud: a new profile is linked and verified, and a fresh device restores it', async ({ browser }) => {
  const d1 = await device(browser)
  await createLinked(d1.page, EMAIL_MARA, MARA)
  const links = await rows(d1.page, 'syncLinks')
  expect(links).toHaveLength(1)
  expect(links[0]).toMatchObject({ email: EMAIL_MARA, state: 'linked' })
  expect(links[0].verifiedAt).toBeTruthy()
  const profiles1 = await rows(d1.page, 'profiles')
  expect(profiles1.map((p) => p.name)).toEqual([MARA.name])
  expect(links[0].profileId).toBe(profiles1[0].id)
  // The pending session is gone: the only session left is the profile's own.
  const keys1 = await authKeys(d1.page)
  expect(sessionsOf(keys1, 'salud-pending')).toHaveLength(0)
  expect(sessionsOf(keys1, `salud-${profiles1[0].id}`)).toHaveLength(1)
  await syncNow(d1.page)
  const counts1 = { profiles: (await rows(d1.page, 'profiles')).length, goals: (await rows(d1.page, 'goals')).length, body: (await rows(d1.page, 'bodyMeasurements')).length }
  expect(counts1.goals).toBe(1)
  expect(counts1.body).toBe(1)

  // A second, fresh device: the account already has a profile → restore it, no basics form.
  const d2 = await device(browser)
  await signInWelcome(d2.page, EMAIL_MARA)
  await expect(d2.page.getByTestId('existing-account')).toBeVisible({ timeout: 30_000 })
  await expect(d2.page.getByRole('heading', { name: `Encontramos tu perfil «${MARA.name}»` })).toBeVisible()
  await expect(d2.page.getByTestId('existing-count')).toContainText(/\d+ registros/)
  expect(await rows(d2.page, 'profiles')).toHaveLength(0) // reading the account created nothing
  await d2.page.getByRole('button', { name: `Restaurar «${MARA.name}» en este dispositivo` }).click()
  await expect(d2.page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 })
  const profiles2 = await rows(d2.page, 'profiles')
  expect(profiles2.map((p) => p.name)).toEqual([MARA.name])
  expect((await rows(d2.page, 'goals')).length).toBe(counts1.goals)
  expect((await rows(d2.page, 'bodyMeasurements')).length).toBe(counts1.body)
  const links2 = await rows(d2.page, 'syncLinks')
  expect(links2).toHaveLength(1)
  expect(links2[0]).toMatchObject({ uid: links[0].uid, profileId: profiles2[0].id })
  // Session moved: the profile holds it, the pending one is signed out.
  const keys2 = await authKeys(d2.page)
  expect(sessionsOf(keys2, 'salud-pending')).toHaveLength(0)
  expect(sessionsOf(keys2, `salud-${profiles2[0].id}`)).toHaveLength(1)
  await d2.page.goto('./#/cuenta')
  await expect(d2.page.getByTestId('sync-status')).toBeVisible()
  await expect(d2.page.getByText(EMAIL_MARA)).toBeVisible()
  await d1.ctx.close()
  await d2.ctx.close()
})

test('cancelling, going back, leaving midway or being offline leaves nothing behind', async ({ browser }) => {
  const d = await device(browser)
  const { page } = d

  // 1. Blocked / offline sign-in: stays on the welcome screen with a short message, nothing is created.
  await page.route(/127\.0\.0\.1:9099/, (r) => r.abort())
  await signInWelcome(page, mail('bloqueada'))
  await expect(page.getByTestId('welcome-error')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('welcome')).toBeVisible()
  expect(await rows(page, 'profiles')).toHaveLength(0)
  await page.unroute(/127\.0\.0\.1:9099/)

  // 2. Existing account → "Volver": back on the welcome screen, session ended, still nothing local.
  await signInWelcome(page, EMAIL_MARA)
  await expect(page.getByTestId('existing-account')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Volver' }).click()
  await expect(page.getByTestId('welcome')).toBeVisible()
  expect(await rows(page, 'profiles')).toHaveLength(0)
  expect(await rows(page, 'syncLinks')).toHaveLength(0)
  expect(sessionsOf(await authKeys(page), 'salud-pending')).toHaveLength(0)

  // 3. Leaving midway (empty account, basics on screen, tab reloaded): no session and no profile remain.
  await signInWelcome(page, mail('a.medias'))
  await expect(page.getByRole('heading', { name: 'Cuéntanos de ti' })).toBeVisible({ timeout: 30_000 })
  expect(sessionsOf(await authKeys(page), 'salud-pending')).toHaveLength(1)
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await expect.poll(async () => sessionsOf(await authKeys(page), 'salud-pending').length, { timeout: 20_000 }).toBe(0)
  expect(await rows(page, 'profiles')).toHaveLength(0)

  // 4. Existing account → "Empezar un perfil nuevo sin usar esos datos": local mode, the cloud is not touched.
  await signInWelcome(page, EMAIL_MARA)
  await expect(page.getByTestId('existing-account')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Empezar un perfil nuevo sin usar esos datos' }).click()
  await expect(page.getByRole('heading', { name: 'Cuéntanos de ti' })).toBeVisible()
  expect(sessionsOf(await authKeys(page), 'salud-pending')).toHaveLength(0)
  await fillBasics(page, ANA)
  await expect(page.getByTestId('link-step')).toHaveCount(0) // local mode: no link offered
  await page.getByRole('button', { name: 'Mantener' }).click()
  await page.getByRole('button', { name: 'Guardar y continuar' }).click()
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
  expect(await rows(page, 'syncLinks')).toHaveLength(0)
  await page.goto('./#/cuenta')
  await expect(page.getByTestId('sign-in')).toBeVisible()
  await d.ctx.close()

  // The account was never touched: a fresh device still finds Mara's single profile.
  const d2 = await device(browser)
  await signInWelcome(d2.page, EMAIL_MARA)
  await expect(d2.page.getByRole('heading', { name: `Encontramos tu perfil «${MARA.name}»` })).toBeVisible({ timeout: 30_000 })
  await d2.page.getByRole('button', { name: 'Volver' }).click()
  await d2.ctx.close()
})

test('an account already linked to another local profile is refused, and two linked profiles stay isolated', async ({ browser }) => {
  const d = await device(browser)
  const { page } = d
  const emailA = mail('tres.a')
  const emailB = mail('tres.b')
  // First profile: Google first (account A). Then add a second profile locally on the same device.
  await createLinked(page, emailA, MARA, { keepOpen: true })
  await page.getByRole('button', { name: /Agregar segundo perfil/ }).click()
  await fillProfile(page, BETO)
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
  expect((await rows(page, 'profiles')).map((p) => p.name).sort()).toEqual([BETO.name, MARA.name])

  // Beto (active, unlinked) cannot take Mara's account on this device.
  await page.goto('./#/cuenta')
  await page.getByTestId('emu-email').fill(emailA)
  await page.getByTestId('sign-in').click()
  await expect(page.getByText(/ya está vinculada a otro perfil/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('link-run')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancelar y cerrar sesión' }).click()

  // He links his own account instead.
  await page.getByTestId('emu-email').fill(emailB)
  await page.getByTestId('sign-in').click()
  await page.getByTestId('confirm-owner').check()
  await page.getByTestId('link-run').click()
  await expect(page.getByText(/Vinculado y verificado/)).toBeVisible({ timeout: 30_000 })
  const links = await rows(page, 'syncLinks')
  expect(links).toHaveLength(2)
  expect(new Set(links.map((l) => l.uid)).size).toBe(2)
  await d.ctx.close()

  // Isolation in the cloud: account A holds only Mara's profile and weight; account B only Beto's.
  const check = async (email: string, name: string, weight: number) => {
    const dev = await device(browser)
    await signInWelcome(dev.page, email)
    await expect(dev.page.getByRole('heading', { name: `Encontramos tu perfil «${name}»` })).toBeVisible({ timeout: 30_000 })
    await dev.page.getByRole('button', { name: `Restaurar «${name}» en este dispositivo` }).click()
    await expect(dev.page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 })
    expect((await rows(dev.page, 'profiles')).map((p) => p.name)).toEqual([name])
    expect((await rows(dev.page, 'bodyMeasurements')).map((b) => b.weightKg)).toEqual([weight])
    await dev.ctx.close()
  }
  await check(emailA, MARA.name, Number(MARA.weight))
  await check(emailB, BETO.name, Number(BETO.weight))
})
