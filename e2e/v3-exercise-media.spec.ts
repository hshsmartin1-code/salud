import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { demoJson as buildDemoJson, expect, test } from './helpers'

// Exercise media (stage A). Synthetic demo data and ORIGINAL synthetic clips (e2e/fixtures/exercise-media,
// geometric shapes made with ffmpeg) injected through network interception only: production code has no
// test switch and the clips are never part of the build.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(root, 'e2e/fixtures/exercise-media')
let demoJson = ''

// The service worker would answer the manifest from its precache and bypass page.route.
test.use({ serviceWorkers: 'block' })

test.beforeAll(async () => {
  demoJson = await buildDemoJson()
})

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(demoJson) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('./')
  await page.getByTestId('dashboard').waitFor()
})

const SQUAT = 'fedb:Barbell_Squat'
const detailUrl = (id: string) => `./#/entreno/ejercicios/${encodeURIComponent(id)}`

/** Native pack with one animated record (Barbell_Squat), served from the synthetic fixtures. */
async function injectPack(page: Page, opts: { animation?: string; format?: 'mp4' | 'webm' | 'webp' } = {}) {
  const src = opts.animation ?? 'clip.mp4'
  const format = opts.format ?? 'mp4'
  const pack = {
    format: 'pho-media-pack',
    version: 1,
    pack: { id: 'synthetic-test', style: 'synthetic shapes', attribution: 'Clip sintético de prueba', license: { status: 'licensed' }, version: 1, basePath: 'exercise-media-test/' },
    records: {
      [SQUAT]: {
        exerciseId: SQUAT,
        thumb: { src: 'poster.webp', width: 320, height: 320, format: 'webp' },
        images: [],
        animation: { src, format, width: 320, height: 320, durationMs: 2000, poster: 'poster.webp' },
        source: 'synthetic-test',
        license: { status: 'licensed' },
        version: 1,
        availability: 'bundled',
        label: 'Synthetic clip',
      },
    },
  }
  const state = { fail: src.startsWith('missing') }
  await page.route('**/data/exercise-media.json', (r) => r.fulfill({ json: pack }))
  await page.route('**/exercise-media-test/**', (r) => {
    const raw = new URL(r.request().url()).pathname.split('/').pop()!
    const name = raw === 'missing.mp4' ? 'clip.mp4' : raw // 'missing' only 404s while state.fail is set
    if (name === 'poster.webp' || (name === 'clip.mp4' && !state.fail) || name === 'clip.webm' || name === 'clip.webp') {
      return r.fulfill({ body: readFileSync(join(FIX, name)), contentType: name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.webm') ? 'video/webm' : 'image/webp' })
    }
    return r.fulfill({ status: 404, body: 'not found' })
  })
  return state
}

async function openInjected(page: Page, opts?: Parameters<typeof injectPack>[1]) {
  const state = await injectPack(page, opts)
  await page.goto(detailUrl(SQUAT))
  await page.reload() // the manifest is cached per page load
  await expect(page.getByTestId('exercise-detail')).toBeVisible()
  return state
}
const paused = (page: Page) => page.locator('[data-testid=exercise-animation] video').first().evaluate((v: HTMLVideoElement) => v.paused)

test('library thumbnails are one anatomical component: no per-exercise image requests, the shared base loads once', async ({ page }) => {
  const media: string[] = []
  const base: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/exercise-media/')) media.push(r.url())
    if (/muscle-figure[/](front|back)[.]webp/.test(r.url())) base.push(r.url())
  })
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-results').waitFor()
  await page.waitForTimeout(800)
  const inDom = await page.locator('svg[data-testid=exercise-thumb][data-thumb=anatomy]').count()
  expect(inDom).toBeGreaterThan(20)
  expect(await page.locator('img[data-testid=exercise-thumb]').count()).toBe(0)
  expect(media).toEqual([])
  expect(base.length).toBeLessThanOrEqual(2) // front.webp and back.webp, each once
  await page.getByTestId('exercise-thumb').last().scrollIntoViewIfNeeded()
  expect(media).toEqual([])
})

test('an exercise without media shows the same anatomical thumbnail in the library, the routine editor and the substitute sheet', async ({ page }) => {
  // Library
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-search').fill('Narrow Stance Leg Press')
  const libTile = page.getByTestId('exercise-results').getByTestId('exercise-thumb').first()
  await expect(libTile).toBeVisible()
  const region = await libTile.getAttribute('data-region')
  expect(region).toBe('front-legs')
  const cls = await libTile.getAttribute('class')
  // Routine editor
  await page.goto('./#/entreno')
  await page.getByTestId('routine-link').filter({ hasText: 'Pierna A' }).first().click()
  await page.getByTestId('routine-detail').waitFor()
  await page.goto(page.url() + '/editar')
  const block = page.getByTestId('routine-exercise-block').filter({ hasText: 'estrecha' })
  await expect(block).toBeVisible()
  const edTile = block.getByTestId('exercise-thumb')
  expect(await edTile.getAttribute('data-region')).toBe(region)
  expect(await edTile.getAttribute('class')).toBe(cls)
  // Substitute sheet (from a live session): options use the same component
  await page.goto('./#/entreno')
  await page.locator('li').filter({ hasText: 'Pierna A' }).filter({ has: page.getByTestId('start-routine') }).first().getByTestId('start-routine').click()
  await page.waitForURL(/#[/]entreno[/]sesion[/]/)
  await page.getByRole('button', { name: /^Opciones de (?!la sesión)/ }).first().click()
  await page.getByRole('menuitem', { name: 'Sustituir' }).click()
  const sheet = page.getByTestId('substitute-sheet')
  await expect(sheet).toBeVisible()
  const opts = sheet.getByTestId('substitute-option')
  await expect(opts.first()).toBeVisible()
  const tiles = sheet.getByTestId('exercise-thumb')
  expect(await tiles.count()).toBeGreaterThan(0)
  expect(await tiles.first().getAttribute('data-thumb')).toBe('anatomy')
  expect(await tiles.first().getAttribute('class')).toBe(cls)
})

test('detail with a bundled still pair shows Inicio / Final and the pack attribution; without media shows the anatomical view', async ({ page }) => {
  await page.goto(detailUrl(SQUAT))
  const fig = page.getByTestId('exercise-illustration')
  await expect(fig).toBeVisible()
  await expect(fig.getByTestId('exercise-attribution')).toContainText('RepDB')
  await expect(fig.getByText('Inicio', { exact: true })).toBeVisible()
  await expect(fig.getByText('Final', { exact: true })).toBeVisible()
  await page.goto(detailUrl('fedb:Narrow_Stance_Leg_Press'))
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await expect(page.getByTestId('exercise-illustration')).toHaveCount(0)
})

test('animation autoplays when visible, thumbnails stay static and nothing is fetched before play', async ({ page }) => {
  const clipRequests: string[] = []
  page.on('request', (r) => {
    if (/clip\.(mp4|webm|webp)/.test(r.url())) clipRequests.push(r.url())
  })
  await openInjected(page)
  const box = page.getByTestId('exercise-animation')
  await expect(box).toBeVisible()
  await expect(box).toHaveAttribute('data-playing', 'true')
  await expect.poll(() => paused(page)).toBe(false)
  await expect(page.getByRole('button', { name: 'Pausar animación' })).toBeVisible()
  const hit = await page.getByTestId('exercise-animation-toggle').boundingBox()
  expect(hit!.width).toBeGreaterThanOrEqual(44)
  expect(hit!.height).toBeGreaterThanOrEqual(44)
  expect(clipRequests.length).toBeGreaterThan(0)
  // Thumbnails never use video.
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-results').waitFor()
  await expect(page.locator('video')).toHaveCount(0)
})

test('the pause button pauses and resumes, and the state is announced', async ({ page }) => {
  await openInjected(page)
  await expect.poll(() => paused(page)).toBe(false)
  await page.getByRole('button', { name: 'Pausar animación' }).click()
  await expect.poll(() => paused(page)).toBe(true)
  await expect(page.getByTestId('exercise-animation')).toHaveAttribute('data-playing', 'false')
  await expect(page.getByText('Animación en pausa')).toBeAttached()
  await page.getByRole('button', { name: 'Reproducir animación' }).click()
  await expect.poll(() => paused(page)).toBe(false)
  await expect(page.getByText('Animación en reproducción')).toBeAttached()
})

test('autoplay refusal leaves an honest paused state and a Play control', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('exercise-media-test/')) return Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'))
      return play.call(this)
    }
  })
  await openInjected(page)
  const box = page.getByTestId('exercise-animation')
  await expect(box).toHaveAttribute('data-playing', 'false')
  await expect(box.getByRole('button', { name: 'Reproducir animación' })).toBeVisible()
  await expect(box.getByText('Animación en pausa')).toBeAttached()
})

test('it pauses when scrolled off-screen', async ({ page }) => {
  await openInjected(page)
  await expect.poll(() => paused(page)).toBe(false)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => paused(page)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => paused(page)).toBe(false)
})

test('reduced motion never autoplays: poster plus a Play button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openInjected(page)
  await expect(page.getByTestId('exercise-animation')).toBeVisible()
  await page.waitForTimeout(700)
  expect(await paused(page)).toBe(true)
  expect(await page.locator('video').first().getAttribute('poster')).toContain('poster.webp')
  await page.getByRole('button', { name: 'Reproducir animación' }).click()
  await expect.poll(() => paused(page)).toBe(false)
})

test('Ampliar opens the media large with the same controls', async ({ page }) => {
  await openInjected(page)
  await page.getByTestId('exercise-animation-zoom').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const large = dialog.getByTestId('exercise-animation')
  await expect(large).toBeVisible()
  await expect(large.getByRole('button', { name: /Pausar animación|Reproducir animación/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('a 404 animation shows the error state and Reintentar recovers', async ({ page, errors }) => {
  const state = await openInjected(page, { animation: 'missing.mp4' })
  const err = page.getByTestId('exercise-animation-error')
  await expect(err).toBeVisible()
  // The rejected play() promise must not replace the media error with a paused state.
  await page.waitForTimeout(250)
  await expect(err).toBeVisible()
  await expect(err.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  expect(state.fail).toBe(true)
  state.fail = false
  await err.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByTestId('exercise-animation')).toHaveAttribute('data-playing', 'true')
  await expect(err).toHaveCount(0)
  // The browser logs the expected 404 as a console error: drop only those.
  errors.splice(0, errors.length, ...errors.filter((e) => !/404|Failed to load resource/.test(e)))
})

test('an animated webp is shown as an image swap (poster when paused)', async ({ page }) => {
  await openInjected(page, { animation: 'clip.webp', format: 'webp' })
  const img = page.locator('[data-testid=exercise-animation] img')
  await expect(img).toHaveAttribute('src', /clip\.webp/)
  await page.getByRole('button', { name: 'Pausar animación' }).click()
  await expect(img).toHaveAttribute('src', /poster\.webp/)
})
