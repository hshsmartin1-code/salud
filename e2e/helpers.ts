import { join } from 'node:path'
import { rolldown } from 'rolldown'
import { expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * THE CLOCK OF THE SUITE. Every spec runs on one instant that does not depend on when the suite is run:
 *   - default: Wednesday 2026-11-18 16:30 (America/Bogota), mid-week and mid-afternoon;
 *   - `E2E_NOW=<ISO instant with offset>` runs the same suite at another moment (e.g. 2026-11-16T00:10:00-05:00);
 *   - `E2E_NOW=real` uses the real clock (no fake clock in the browser, seeds built from the real "now").
 * The browser gets a Playwright fake clock installed on the context before any page loads (time starts at
 * that instant and keeps flowing at normal speed, so timers, the rest timer and Dexie behave as usual), and
 * the demo seed is built for the very same instant (see `demoJson`). Specs must never read `new Date()` in
 * Node for anything the app also reads: use `today()`, `nowDate()` or `page.evaluate(() => Date.now())`.
 */
export const TZ = 'America/Bogota'
export const DEFAULT_NOW = '2026-11-18T16:30:00-05:00'
export const REAL_CLOCK = process.env.E2E_NOW === 'real'

/** The instant this run pretends it is (or the real one). `at` overrides it for one test (see `clockAt`). */
export function nowDate(at?: string | null): Date {
  if (at) return new Date(at)
  if (REAL_CLOCK) return new Date()
  const d = new Date(process.env.E2E_NOW ?? DEFAULT_NOW)
  if (Number.isNaN(d.getTime())) throw new Error(`E2E_NOW is not an ISO instant: ${process.env.E2E_NOW}`)
  return d
}
/** Local date (YYYY-MM-DD, America/Bogota) of the suite clock. */
export const today = (at?: string | null): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowDate(at))
/** Local "HH:MM" of the suite clock. */
export const clockTime = (at?: string | null): string => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(nowDate(at))

let seedModule: Promise<{ buildDemoBackup: (today: string, now: string) => unknown }> | null = null
/** The synthetic demo backup (src/test/seed/demoSeed.ts) built for the suite clock: nothing in it is later than "now". */
export async function demoBackup<T = unknown>(at?: string | null): Promise<T> {
  seedModule ??= (async () => {
    const bundle = await rolldown({ input: join(process.cwd(), 'src/test/seed/demoSeed.ts'), platform: 'node', logLevel: 'silent' })
    const { output } = await bundle.generate({ format: 'esm' })
    await bundle.close()
    return import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'))
  })()
  const mod = await seedModule
  const now = nowDate(at)
  return mod.buildDemoBackup(today(at), now.toISOString()) as T
}
export async function demoJson(at?: string | null): Promise<string> {
  return JSON.stringify(await demoBackup(at))
}

/** For specs that open their own browser contexts: puts the suite clock on it. */
export async function installClock(ctx: BrowserContext, at?: string | null): Promise<void> {
  if (!REAL_CLOCK || at) await ctx.clock.install({ time: nowDate(at) })
}

/** Playwright's `test` with the suite clock installed on every context (specs that bring their own error handling). */
export const clockTest = base.extend<{ clockAt: string | null }>({
  /** Pins this test (or describe) to another instant: `test.use({ clockAt: '2026-11-16T00:10:00-05:00' })`. */
  clockAt: [null, { option: true }],
  context: [
    async ({ context, clockAt }, use) => {
      await installClock(context, clockAt)
      await use(context)
    },
    { scope: 'test' },
  ],
})

/** Fails the test on any console error or uncaught page error. Synthetic data only. */
export const test = clockTest.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export interface TestProfile {
  name: string
  sex: 'Hombre' | 'Mujer'
  birth: string
  height: string
  weight: string
  goal?: 'Perder grasa' | 'Mantener' | 'Ganar masa' | 'Recomposición'
}

export const ANA: TestProfile = { name: 'Ana Prueba', sex: 'Mujer', birth: '1994-04-10', height: '165', weight: '60', goal: 'Mantener' }
export const BETO: TestProfile = { name: 'Beto Prueba', sex: 'Hombre', birth: '1990-08-20', height: '178', weight: '80', goal: 'Perder grasa' }

/**
 * Fills the basics + goal steps of the onboarding (first run or "nuevo perfil"). On the very first run the
 * welcome screen comes first: pass `welcome: true` (what `onboard` does) to take "Continuar sin cuenta".
 */
export async function fillProfile(page: Page, p: TestProfile, opts: { welcome?: boolean } = {}) {
  if (opts.welcome) await page.getByRole('button', { name: 'Continuar sin cuenta' }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(p.name)
  await page.getByText(p.sex, { exact: true }).click()
  await page.getByLabel('Fecha de nacimiento').fill(p.birth)
  await page.getByLabel('Estatura').fill(p.height)
  await page.getByLabel('Peso actual').fill(p.weight)
  await page.getByLabel('Actividad habitual').selectOption('moderate')
  await page.getByRole('button', { name: 'Continuar' }).click()
  if (p.goal) {
    await page.getByRole('button', { name: p.goal }).click()
    await page.getByRole('button', { name: 'Guardar y continuar' }).click()
  } else {
    await page.getByRole('button', { name: /Omitir|Ahora no|Saltar/ }).click()
  }
}

/** First run: creates one or two profiles and lands on the dashboard. */
export async function onboard(page: Page, first: TestProfile = ANA, second?: TestProfile) {
  await page.goto('./')
  await fillProfile(page, first, { welcome: true })
  if (second) {
    await page.getByRole('button', { name: /Agregar segundo perfil/ }).click()
    await fillProfile(page, second)
  }
  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByTestId('dashboard')).toBeVisible()
}

/** The visible profile switcher (top bar on mobile, sidebar on desktop). */
export const switcher = (page: Page) => page.getByTestId('profile-switcher').filter({ visible: true })

export async function switchProfile(page: Page, name: string) {
  await switcher(page).click()
  await page.getByRole('button', { name }).click()
  await expect(switcher(page)).toContainText(name)
}

/** Searches the catalog and logs `grams` of the first result into today's breakfast. */
export async function logFood(page: Page, query: string, qty: string) {
  await page.goto('./#/comida/buscar?meal=desayuno')
  await page.getByTestId('food-search').fill(query)
  await page.getByTestId('food-results').locator('button').first().click()
  await chooseUnit(page, 'g')
  const qtyField = page.getByRole('textbox', { name: 'Cantidad' })
  await qtyField.fill(qty)
  await saveFood(page)
}

/** Logs `qty` g of the first result of `query` into `meal` of `date` (default today) and returns to the diary. */
export async function logInMeal(page: Page, meal: string, opts: { qty?: string; date?: string; query?: string } = {}) {
  await page.goto(`./#/comida/buscar?meal=${meal}${opts.date ? `&d=${opts.date}` : ''}`)
  await page.getByTestId('food-search').fill(opts.query ?? 'arroz cocido')
  await page.getByTestId('food-results').locator('button').first().click()
  await chooseUnit(page, 'g')
  await page.getByRole('textbox', { name: 'Cantidad' }).fill(opts.qty ?? '100')
  await page.getByTestId('save-food').click()
  await finishLogging(page)
}

/**
 * Clicks "Registrar" in the quantity sheet and waits for the day view. "Seguir agregando" is on by default,
 * so a log made from the search stays there: this then takes "Ver diario", the way out.
 */
export async function saveFood(page: Page) {
  await page.getByTestId('save-food').click()
  await finishLogging(page)
}

/** From the search page after a log (or already in the diary): go to the diary and wait for it. */
export async function finishLogging(page: Page) {
  const summary = page.getByTestId('day-summary')
  const counter = page.getByTestId('food-added-count')
  await expect(summary.or(counter)).toBeVisible()
  if (await counter.isVisible()) await counter.getByRole('link', { name: 'Ver diario' }).click()
  await expect(page).toHaveURL(/#\/comida(\?.*)?$/)
  await expect(summary).toBeVisible()
}

/**
 * Opens the unit chooser of the food detail (a small sheet) and picks a unit: 'g' and 'ml' by exact name, anything else
 * by a substring or RegExp of the option's text ("porción (150 g)"). kg, oz and L sit behind "Más unidades": it opens them.
 * `scope` is the inline panel on the desktop; on the phone the detail is the dialog and the default (the page) works.
 */
export async function chooseUnit(page: Page, unit: string | RegExp, scope?: Locator) {
  await (scope ?? page).getByTestId('unit-button').click()
  const chooser = page.getByTestId('chooser')
  await expect(chooser).toBeVisible()
  const exact = typeof unit === 'string' && ['g', 'ml', 'kg', 'oz', 'lb', 'litros'].includes(unit)
  const option = chooser.getByRole('radio', { name: unit, exact })
  if (typeof unit === 'string' && ['kg', 'oz', 'lb', 'litros'].includes(unit) && !(await chooser.locator('details').evaluate((d) => (d as HTMLDetailsElement).open)))
    await chooser.getByText('Más unidades', { exact: true }).click()
  await option.first().click()
  await expect(chooser).toHaveCount(0)
}

/** The visible options of the unit chooser, as their texts (opens it and closes it with Escape). */
export async function unitChoices(page: Page, scope?: Locator): Promise<string[]> {
  await (scope ?? page).getByTestId('unit-button').click()
  const chooser = page.getByTestId('chooser')
  await expect(chooser).toBeVisible()
  // the options on view: the ones inside a closed "Más unidades" do not count
  const texts = await chooser.locator('[role="radio"]').evaluateAll((els) => els.filter((el) => !el.closest('details:not([open])')).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()))
  await page.keyboard.press('Escape')
  await expect(chooser).toHaveCount(0)
  return texts
}

/** Picks the meal that receives the log from the search header (a small chooser). */
export async function chooseSearchMeal(page: Page, meal: string) {
  await page.getByTestId('strip-meal').click()
  await page.getByTestId('chooser').getByRole('radio', { name: meal, exact: true }).click()
  await expect(page.getByTestId('chooser')).toHaveCount(0)
}

/** Opens the "Filtros" sheet of the search, runs `fn` inside it and closes it with "Listo". */
export async function withFilters(page: Page, fn: (sheet: Locator) => Promise<void>) {
  await page.getByTestId('filters-button').click()
  const sheet = page.getByTestId('filters-sheet')
  await expect(sheet).toBeVisible()
  await fn(sheet)
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

/** "Seguir agregando alimentos" lives in the Filtros sheet. */
export async function setKeepAdding(page: Page, on: boolean) {
  await withFilters(page, async (sheet) => {
    const box = sheet.getByTestId('keep-adding')
    if (on) await box.check()
    else await box.uncheck()
  })
}

/** Opens a meal's "⋯" menu (a real role="menu") and picks an item. */
export async function mealMenu(page: Page, meal: string, item: string) {
  await page.getByTestId(`meal-${meal}`).getByRole('button', { name: /^Opciones de/ }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

export async function kcalToday(page: Page): Promise<string> {
  await page.goto('./#/comida')
  // A hash change from another diary date (?d=...) re-renders after goto() returns: read it on a fresh load, never mid-transition.
  await page.reload()
  await expect(page.getByTestId('kcal-total')).toBeVisible()
  return (await page.getByTestId('kcal-total').textContent())?.trim() ?? ''
}

/** Presses "Deshacer" in the toast (the PWA notes stack above it, they never cover it). */
export async function clickUndo(page: Page) {
  await page.locator('.toast-host').getByRole('button', { name: 'Deshacer' }).click()
}

// ───────────── Hoy / training plan fixtures (V3.2): the synthetic demo profile with a plan, a step goal or a finished session today ─────────────

type DemoBackup = { profiles: { settings: Record<string, unknown> }[]; tables: { routines: { id: string; name: string }[]; trainingSessions: Record<string, unknown>[] } }
export interface DemoOptions {
  /** ISO weekday (1 = Monday … 7 = Sunday) → training day; `routine` is a demo routine name ('Torso A', 'Pierna A'…). */
  plan?: Record<number, { routine?: string }>
  /** `null` removes the step goal (the demo has 8000). */
  stepGoal?: null
  /** A finished session today (from the demo's «Pierna A»), ended before the suite clock. */
  doneToday?: boolean
  at?: string | null
}
/** The demo backup (as JSON) with the plan, step goal and today's session the test asks for. Nothing real is involved. */
export async function demoWith(o: DemoOptions = {}): Promise<string> {
  const b = await demoBackup<DemoBackup>(o.at)
  const settings = b.profiles[0]!.settings
  if (o.plan) {
    const days: Record<string, { routineId?: string }> = {}
    for (const [wd, v] of Object.entries(o.plan)) {
      const id = v.routine ? b.tables.routines.find((r) => r.name === v.routine)?.id : undefined
      if (v.routine && !id) throw new Error(`demo routine not found: ${v.routine}`)
      days[wd] = id ? { routineId: id } : {}
    }
    settings.training = { ...((settings.training as object | undefined) ?? {}), plan: { days } }
  }
  if (o.stepGoal === null) delete settings.stepGoal
  if (o.doneToday) {
    const todayStr = today(o.at)
    const src = b.tables.trainingSessions.find((s) => s.name === 'Pierna A') ?? b.tables.trainingSessions[0]!
    b.tables.trainingSessions.push({ ...src, id: 'hoy-done-today', date: todayStr, status: 'done', startedAt: `${todayStr}T14:00:00-05:00`, endedAt: `${todayStr}T15:05:00-05:00`, durationMin: 65 })
  }
  return JSON.stringify(b)
}
/** Restores a demo backup through the app's own import flow and lands on Hoy. */
export async function restoreJson(page: Page, json: string): Promise<void> {
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
