import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { expect, test } from '@playwright/test'

// Global update notice, in the REAL app shell (e2e/harness/banner.tsx: AppShell + UpdateBanner + a fake update service that
// the test drives). Layout contract: the notice floats above the bottom navigation and every other bottom bar, never moves
// the page, never covers a control, and never shows on a live session or on the updates page.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PW_BANNER_PORT ?? 4192)
const URL_BASE = `http://localhost:${PORT}/e2e/harness/banner.html`

// The whole file runs in ONE worker (serial), so there is exactly one throwaway dev server, on a fixed port.
test.describe.configure({ mode: 'serial' })
let server: ViteDevServer | undefined
test.beforeAll(async () => {
  // The fonts live in the shared node_modules junction: allow only its real directory (same rule as vite.config.ts).
  server = await createServer({ root, configFile: false, plugins: [react()], logLevel: 'error', optimizeDeps: { entries: ['e2e/harness/banner.html'] },
    server: { port: PORT, strictPort: true, host: 'localhost', fs: { allow: [root, realpathSync(resolve(root, 'node_modules'))] } } })
  await server.listen()
})
test.afterAll(async () => { await server?.close() })

type Harness = { set(name: string): void; calls: string[]; flags: { failDownload: boolean } }
async function open(page: Page, theme: 'light' | 'dark', query = '', hash = '') {
  await page.addInitScript((t) => { try { localStorage.setItem('pho-theme', t) } catch { /* private mode */ } }, theme)
  await page.goto(`${URL_BASE}${query}${hash}`)
  await page.getByTestId('last-control').waitFor()
  await page.evaluate(() => document.fonts.ready)
}
const show = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __harness: Harness }).__harness.set(n), name)
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.calls.slice())
const card = (page: Page) => page.getByTestId('update-banner').locator('> div')

const SIZES = [{ width: 360, height: 800 }, { width: 412, height: 915 }]
const NAV = 'nav[aria-label="Principal"].fixed'

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${size.width}x${size.height} ${theme}`, () => {
      test.use({ viewport: size, colorScheme: theme })

      test('every state: fits, no overlap with the navigation or the "+" button, 44 px targets, nothing truncated', async ({ page }) => {
        await open(page, theme)
        for (const name of ['web', 'native', 'progress', 'ready', 'error', 'applied', 'rolled']) {
          await show(page, name)
          // An error shows only after an operation started from the notice failed: drive that path for real.
          if (name === 'error') {
            await show(page, 'web')
            await page.evaluate(() => { (window as unknown as { __harness: Harness }).__harness.flags.failDownload = true })
            await page.getByTestId('update-banner-action').click()
            await expect(page.getByTestId('update-banner-action')).toHaveText('Reintentar')
          }
          await expect(page.getByTestId('update-banner')).toBeVisible()
          const m = await page.evaluate((navSel) => {
            const c = document.querySelector('[data-testid="update-banner"] > div') as HTMLElement
            const r = c.getBoundingClientRect()
            const nav = document.querySelector(navSel)!.getBoundingClientRect()
            const plus = document.querySelector('[aria-label="Registrar"]')!.getBoundingClientRect()
            const text = document.querySelector('[data-testid="update-banner-text"]') as HTMLElement
            const targets = [...c.querySelectorAll('button')].map((b) => { const t = b.getBoundingClientRect(); return { w: t.width, h: t.height, right: t.right, left: t.left } })
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, navTop: nav.top, plusTop: plus.top, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
              textClipped: text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1, targets, cardH: r.height }
          }, NAV)
          expect(m.bottom, `${name}: card above the bottom navigation`).toBeLessThanOrEqual(m.navTop)
          expect(m.bottom, `${name}: card above the "+" button`).toBeLessThanOrEqual(m.plusTop)
          expect(m.left).toBeGreaterThanOrEqual(0)
          expect(m.right).toBeLessThanOrEqual(m.vw)
          expect(m.sw).toBeLessThanOrEqual(m.vw)
          expect(m.textClipped, `${name}: text clipped`).toBe(false)
          for (const t of m.targets) { expect(t.w).toBeGreaterThanOrEqual(43.5); expect(t.h).toBeGreaterThanOrEqual(43.5); expect(t.right).toBeLessThanOrEqual(m.vw) }
          expect(m.cardH).toBeLessThanOrEqual(96)
        }
      })

      test('appearing moves nothing on the page and the last control scrolls clear of the notice', async ({ page }) => {
        await open(page, theme)
        const probe = () => page.evaluate(() => {
          const h1 = document.querySelector('h1')!.getBoundingClientRect()
          const main = document.querySelector('main')!.getBoundingClientRect()
          const first = document.querySelector('main .card')!.getBoundingClientRect()
          return { h1: h1.top, main: main.top, first: first.top, left: first.left, width: first.width }
        })
        const before = await probe()
        await show(page, 'web')
        await expect(page.getByTestId('update-banner')).toBeVisible()
        expect(await probe()).toEqual(before)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const last = await page.getByTestId('last-control').boundingBox()
        const banner = await card(page).boundingBox()
        expect(last!.y + last!.height).toBeLessThanOrEqual(banner!.y)
        // The inset is published for the page padding and cleared again when the notice goes away.
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--update-banner-inset'))).toMatch(/^\d+px$/)
        await show(page, 'idle')
        await expect(page.getByTestId('update-banner')).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--update-banner-inset'))).toBe('')
      })
    })
  }
}

test.describe('behaviour (412 x 915)', () => {
  test.use({ viewport: { width: 412, height: 915 } })

  test('Actualizar starts the download; dismissing is remembered per version', async ({ page }) => {
    await open(page, 'light')
    await show(page, 'web')
    await expect(page.getByTestId('update-banner-text')).toHaveText('Actualización disponible')
    await expect(page.getByTestId('update-banner')).toContainText('Versión 3.2.0')
    await page.getByTestId('update-banner-action').click()
    expect(await calls(page)).toEqual(['download'])
    await show(page, 'web')
    await page.getByRole('button', { name: 'Cerrar aviso' }).click()
    await expect(page.getByTestId('update-banner')).toHaveCount(0)
    await show(page, 'web') // same version offered again: stays hidden until the app restarts
    await expect(page.getByTestId('update-banner')).toHaveCount(0)
    await show(page, 'progress') // an answer to a tap is never hidden
    await expect(page.getByTestId('update-banner')).toContainText('Descargando… 42 %')
  })

  test('native offer opens the updates page; the one-time notices acknowledge themselves', async ({ page }) => {
    await open(page, 'dark')
    await show(page, 'native')
    await expect(page.getByTestId('update-banner')).toContainText('Hay una versión nueva de la app')
    await page.getByTestId('update-banner-action').click()
    await expect(page).toHaveURL(/#\/ajustes\/actualizaciones$/)
    await expect(page.getByTestId('update-banner')).toHaveCount(0) // the page itself says it
    await page.goto(`${URL_BASE}`)
    await show(page, 'applied')
    await expect(page.getByTestId('update-banner')).toContainText('Actualizado a la versión 3.2.0')
    await page.getByTestId('update-banner-action').click()
    expect(await calls(page)).toContain('acknowledge')
    await expect(page).toHaveURL(/#\/ajustes\/actualizaciones$/)
    await page.goto(`${URL_BASE}`)
    await show(page, 'rolled')
    await expect(page.getByTestId('update-banner')).toContainText('No se pudo aplicar la versión 3.2.0; sigues en la anterior.')
    await page.getByRole('button', { name: 'Cerrar aviso' }).click()
    await expect(page.getByTestId('update-banner')).toHaveCount(0)
    expect(await calls(page)).toContain('acknowledge')
  })

  test('hidden on the live session route and on the updates page', async ({ page }) => {
    await open(page, 'light')
    await show(page, 'web')
    await expect(page.getByTestId('update-banner')).toBeVisible()
    await page.evaluate(() => { window.location.hash = '#/entreno/sesion/abc' })
    await expect(page.getByTestId('update-banner')).toHaveCount(0)
    await page.evaluate(() => { window.location.hash = '#/' })
    await expect(page.getByTestId('update-banner')).toBeVisible()
  })

  test('stacks above a bottom action bar and stays under a sheet and its footer', async ({ page }) => {
    await open(page, 'light', '?dock=1')
    await show(page, 'web')
    const dock = await page.getByTestId('dock-bar').boundingBox()
    const banner = await card(page).boundingBox()
    expect(banner!.y + banner!.height).toBeLessThanOrEqual(dock!.y)
    await page.getByTestId('last-control').scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const last = await page.getByTestId('last-control').boundingBox()
    const top = await card(page).boundingBox()
    expect(last!.y + last!.height).toBeLessThanOrEqual(top!.y)

    const sheet = await (async () => { await open(page, 'light', '?sheet=1'); await show(page, 'web'); return page.getByTestId('sheet-footer') })()
    await expect(sheet).toBeVisible()
    const box = (await sheet.boundingBox())!
    const topmost = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(topmost).toBe('sheet-footer')
    const overlap = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="sheet-footer"]')!.getBoundingClientRect()
      const b = document.querySelector('[data-testid="update-banner"] > div')!.getBoundingClientRect()
      const x = Math.max(f.left, b.left) + 1, y = Math.max(f.top, b.top) + 1
      return x < Math.min(f.right, b.right) && y < Math.min(f.bottom, b.bottom) ? (document.elementFromPoint(x, y) as HTMLElement).closest('[data-testid]')?.getAttribute('data-testid') ?? 'other' : 'none'
    })
    expect(['none', 'sheet-footer', 'other']).toContain(overlap) // the sheet is above the notice wherever they meet
  })

  test('keyboard focus is visible on the action and the dismiss control, and the live region is polite', async ({ page }) => {
    await open(page, 'light')
    await show(page, 'web')
    const region = page.getByTestId('update-banner').locator('[role="status"]')
    await expect(region).toHaveAttribute('aria-live', 'polite')
    const action = page.getByTestId('update-banner-action')
    await action.focus()
    await page.keyboard.press('Tab')
    for (const target of [page.getByTestId('update-banner-dismiss')]) {
      await expect(target).toBeFocused()
      expect(await target.evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 })).toBe(true)
    }
    await page.keyboard.press('Shift+Tab')
    await expect(action).toBeFocused()
    expect(await action.evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 })).toBe(true)
  })
})
