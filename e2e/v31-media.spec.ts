import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { makeZip } from '../src/features/training/media/testZip'
import { demoJson as buildDemoJson, expect, test } from './helpers'

// V3.1 exercise media: ONE anatomical thumbnail style, the detail from the active pack, and the
// device-private pack (Cache Storage). Synthetic data only: the clips are the original shapes in
// e2e/fixtures/exercise-media and nothing here is ever part of a build.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(root, 'e2e/fixtures/exercise-media')
const SQUAT = 'fedb:Barbell_Squat'
const BENCH = 'fedb:Barbell_Bench_Press_-_Medium_Grip'
const COVERED_BY_BUNDLED = 'fedb:Decline_Crunch' // has a bundled RepDB illustration, is NOT in the synthetic private pack
const ATTRIBUTION = 'Material sintético de prueba'
const CACHE = 'salud-private-media'
const detailUrl = (id: string) => `./#/entreno/ejercicios/${encodeURIComponent(id)}`

let demoJson = ''
let workDir = ''
let zipPath = ''
let manifest: Record<string, unknown> = {}

test.use({ serviceWorkers: 'block' })

test.beforeAll(async () => {
  demoJson = await buildDemoJson()
  // Build the pack with the real owner tool (scripts/media-pack/build-private-pack.mjs) from the synthetic fixtures.
  workDir = mkdtempSync(join(tmpdir(), 'salud-pack-'))
  const media = join(workDir, 'media')
  mkdirSync(media)
  cpSync(join(FIX, 'clip.mp4'), join(media, 'fedb_Barbell_Squat.mp4'))
  cpSync(join(FIX, 'poster.webp'), join(media, 'fedb_Barbell_Squat-poster.webp'))
  cpSync(join(FIX, 'clip.webp'), join(media, 'fedb_Barbell_Bench_Press_-_Medium_Grip-start.webp'))
  cpSync(join(FIX, 'poster.webp'), join(media, 'fedb_Barbell_Bench_Press_-_Medium_Grip-peak.webp'))
  writeFileSync(
    join(workDir, 'map.csv'),
    ['exerciseId,name,datasetId,needsReview', `${SQUAT},Sentadilla,0043,no`, `${BENCH},Press banca,0025,no`, `${COVERED_BY_BUNDLED},Abdominales,0001,yes`].join('\n'),
  )
  execFileSync(process.execPath, [join(root, 'scripts/media-pack/build-private-pack.mjs'), '--media', media, '--map', join(workDir, 'map.csv'), '--attribution', ATTRIBUTION, '--id', 'synthetic-private', '--out', join(workDir, 'out')])
  zipPath = join(workDir, 'out', 'synthetic-private.zip')
})
test.afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

async function restoreDemo(page: Page) {
  await page.goto('./')
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(demoJson) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('./')
  await page.getByTestId('dashboard').waitFor()
}

/** The manifest the owner tool wrote, read back from the zip it produced (first stored/deflated entry named manifest.json). */
async function readManifest(): Promise<Record<string, unknown>> {
  const { readZipDirectory, readZipEntry } = await import('../src/features/training/media/zip')
  const blob = new Blob([readFileSync(zipPath)])
  const entries = await readZipDirectory(blob)
  const m = entries.find((e) => e.name === 'manifest.json')!
  return JSON.parse(new TextDecoder().decode(await readZipEntry(blob, m))) as Record<string, unknown>
}

interface Seed {
  active?: boolean
  /** Paths (zip layout) to leave out of the cache (missing file) ... */
  omit?: string[]
  /** ... or to fill with garbage (corrupt file). */
  corrupt?: string[]
  /** Replace the manifest text (corrupt manifest). */
  manifestText?: string
}

/** Writes the cache exactly as the importer does (manifest last), straight from the owner-tool output. */
async function seedPrivate(page: Page, seed: Seed = {}) {
  const { readZipDirectory, readZipEntry } = await import('../src/features/training/media/zip')
  const blob = new Blob([readFileSync(zipPath)])
  const files: Record<string, string> = {}
  for (const e of await readZipDirectory(blob)) {
    if (e.name === 'manifest.json' || seed.omit?.includes(e.name)) continue
    files[e.name] = Buffer.from(seed.corrupt?.includes(e.name) ? Buffer.from('not a real media file') : await readZipEntry(blob, e)).toString('base64')
  }
  const manifestText = seed.manifestText ?? JSON.stringify(manifest)
  await page.evaluate(
    async ({ files, manifestText, active, cacheName }) => {
      const key = (p: string) => new URL('/__salud-private__/' + p.split('/').map(encodeURIComponent).join('/'), location.origin).href
      await caches.delete(cacheName)
      const cache = await caches.open(cacheName)
      const mime = (p: string) => (p.endsWith('.mp4') ? 'video/mp4' : p.endsWith('.webm') ? 'video/webm' : 'image/webp')
      for (const [p, b64] of Object.entries(files)) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        await cache.put(key(p), new Response(bytes, { headers: { 'Content-Type': mime(p) } }))
      }
      await cache.put(key('meta.json'), new Response(JSON.stringify({ bytes: 1000, files: Object.keys(files).length })))
      await cache.put(key('state.json'), new Response(JSON.stringify({ active })))
      await cache.put(key('manifest.json'), new Response(manifestText, { headers: { 'Content-Type': 'application/json' } }))
    },
    { files, manifestText, active: seed.active ?? true, cacheName: CACHE },
  )
}

test.beforeEach(async ({ page }) => {
  manifest = await readManifest()
  await restoreDemo(page)
})

test('every library row uses the same anatomical thumbnail, never a bundled illustration', async ({ page }) => {
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-results').waitFor()
  // Page the list inside the page (no per-click actionability waits: rows animate and the sentinel may
  // append the next page at the same moment). Stops when the button is gone.
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
    for (let i = 0; i < 20; i++) {
      const more = [...document.querySelectorAll('button')].find((b) => /^Mostrar más/.test(b.textContent ?? ''))
      if (!more) break
      more.click()
      await frame()
      await frame()
    }
  })
  await expect(page.getByRole('button', { name: /^Mostrar más/ })).toHaveCount(0)
  const rows = await page.getByTestId('exercise-row').count()
  expect(rows).toBeGreaterThan(800)
  expect(await page.locator('[data-testid=exercise-row] svg[data-thumb=anatomy]').count()).toBe(rows)
  expect(await page.locator('[data-testid=exercise-row] img[data-testid=exercise-thumb]').count()).toBe(0)
  expect(await page.locator('[data-testid=exercise-row] img[src*="exercise-media/"]').count()).toBe(0)
  // Same family: one view and one region attribute per thumbnail, whole figure only without muscle data.
  const regions = await page.locator('[data-testid=exercise-row] svg[data-thumb=anatomy]').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-region'))).size)
  expect(regions).toBeGreaterThan(5)
})

test('a covered exercise keeps the anatomical thumbnail in the library and the bundled illustration in the detail', async ({ page }) => {
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-search').fill('decline crunch')
  await expect(page.getByTestId('exercise-row').first().locator('svg[data-thumb=anatomy]')).toBeVisible()
  await page.goto(detailUrl(COVERED_BY_BUNDLED))
  await expect(page.getByTestId('exercise-illustration')).toBeVisible()
  await expect(page.getByTestId('exercise-attribution')).toContainText('RepDB')
})

test('a seeded private pack is the single active pack: animation and attribution in the detail, anatomy elsewhere', async ({ page }) => {
  await seedPrivate(page)
  await page.goto(detailUrl(SQUAT))
  await page.reload()
  const box = page.getByTestId('exercise-animation')
  await expect(box).toBeVisible()
  await expect(box.locator('video')).toHaveAttribute('src', /^blob:/)
  await expect(page.getByTestId('exercise-attribution')).toContainText(ATTRIBUTION)
  await expect(page.getByTestId('exercise-attribution')).not.toContainText('RepDB')
  // A still-image record shows its two poses from the private cache.
  await page.goto(detailUrl(BENCH))
  await expect(page.getByTestId('exercise-poses').locator('img[src^="blob:"]')).toHaveCount(2)
  // Never a mix: an exercise the private pack does not cover shows the anatomical view, not the bundled illustration.
  await page.goto(detailUrl(COVERED_BY_BUNDLED))
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await expect(page.getByTestId('exercise-tile')).toHaveAttribute('data-thumb', 'anatomy')
  await expect(page.getByTestId('exercise-illustration')).toHaveCount(0)
  // List thumbnails are the same anatomical component either way.
  await page.goto('./#/entreno/ejercicios')
  await page.getByTestId('exercise-results').waitFor()
  expect(await page.locator('[data-testid=exercise-row] img[data-testid=exercise-thumb]').count()).toBe(0)
})

test('a private pack that is imported but switched off is not used', async ({ page }) => {
  await seedPrivate(page, { active: false })
  await page.goto(detailUrl(COVERED_BY_BUNDLED))
  await page.reload()
  await expect(page.getByTestId('exercise-illustration')).toBeVisible()
  await expect(page.getByTestId('exercise-attribution')).toContainText('RepDB')
})

test('a missing or corrupt private file falls back to the anatomical view without breaking the screen', async ({ page }) => {
  const clip = (Object.values((manifest.records as Record<string, { animation?: { src: string } }>))[0]!.animation!).src
  await seedPrivate(page, { omit: [clip] })
  await page.goto(detailUrl(SQUAT))
  await page.reload()
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await expect(page.getByTestId('exercise-illustration-fallback')).toContainText('paquete privado')
  await expect(page.getByTestId('exercise-animation-error')).toHaveCount(0)
  await expect(page.getByTestId('exercise-detail')).toBeVisible()

  await seedPrivate(page, { corrupt: [clip] })
  await page.goto(detailUrl(SQUAT))
  await page.reload()
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('exercise-detail')).toBeVisible()
})

test('a corrupt private manifest disables the pack and the bundled pack keeps working', async ({ page }) => {
  await seedPrivate(page, { manifestText: '{"format":"pho-media-pack","version":1,"pack":' })
  await page.goto(detailUrl(COVERED_BY_BUNDLED))
  await page.reload()
  await expect(page.getByTestId('exercise-illustration')).toBeVisible()
  await expect(page.getByTestId('exercise-attribution')).toContainText('RepDB')
  // A manifest that parses but is not a valid private pack is disabled too.
  const bad = JSON.stringify({ ...manifest, pack: { ...(manifest.pack as object), license: { status: 'licensed' } } })
  await seedPrivate(page, { manifestText: bad })
  await page.goto(detailUrl(SQUAT))
  await page.reload()
  await expect(page.getByTestId('exercise-attribution')).toContainText('RepDB')
})

test('removing the private pack restores the bundled one', async ({ page }) => {
  await seedPrivate(page)
  await page.goto(detailUrl(COVERED_BY_BUNDLED))
  await page.reload()
  await expect(page.getByTestId('exercise-illustration-fallback')).toBeVisible()
  await page.evaluate((c) => caches.delete(c), CACHE)
  await page.reload()
  await expect(page.getByTestId('exercise-illustration')).toBeVisible()
  await expect(page.getByTestId('exercise-attribution')).toContainText('RepDB')
})

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' })
  test('the private pack survives a reload with no connection', async ({ page, context }) => {
    await seedPrivate(page)
    await page.goto(detailUrl(SQUAT))
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect(page.getByTestId('exercise-animation')).toBeVisible()
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByTestId('exercise-animation').locator('video')).toHaveAttribute('src', /^blob:/)
    await expect(page.getByTestId('exercise-attribution')).toContainText(ATTRIBUTION)
    await context.setOffline(false)
  })
})

// The importer is a self-contained component that Settings mounts. Here the real component is mounted in a
// harness page (e2e/harness) served by a throwaway vite dev server, so these tests do not depend on Settings.
test.describe('importer UI', () => {
  test.describe.configure({ mode: 'serial' })
  const PORT = 4144
  const HARNESS = `http://localhost:${PORT}/e2e/harness/importer.html`
  let server: ViteDevServer | undefined
  test.beforeAll(async () => {
    server = await createServer({ root, configFile: false, plugins: [react()], logLevel: 'error', optimizeDeps: { entries: ['e2e/harness/importer.html'] }, server: { port: PORT, strictPort: true, host: 'localhost' } })
    await server.listen()
  })
  test.afterAll(async () => {
    await server?.close()
  })

  test('offers the pack, imports it with a summary, activates it, switches back and deletes it', async ({ page }) => {
    await page.goto(HARNESS)
    await page.getByTestId('private-pack').waitFor()
    await page.getByTestId('private-pack-file').setInputFiles(zipPath)
    const review = page.getByTestId('private-pack-review')
    await expect(review).toContainText('synthetic-private')
    await expect(review).toContainText(ATTRIBUTION)
    await expect(review).toContainText('Ejercicios')
    await page.getByTestId('private-pack-import').click()
    await expect(page.getByTestId('private-pack-installed')).toBeVisible()
    await expect(page.getByTestId('private-pack-count')).toHaveText('2')
    await expect(page.getByTestId('private-pack-state')).toHaveText('Paquete incluido')
    await expect(page.getByTestId('probe-squat').getByTestId('exercise-attribution')).toContainText('RepDB')
    await page.getByTestId('private-pack-use').click()
    await expect(page.getByTestId('private-pack-state')).toHaveText('Paquete privado')
    const squat = page.getByTestId('probe-squat')
    await expect(squat.getByTestId('exercise-animation')).toBeVisible()
    await expect(squat.getByTestId('exercise-attribution')).toContainText(ATTRIBUTION)
    // Never a mix: the bundled illustration of an exercise the private pack lacks is not shown.
    await expect(page.getByTestId('probe-covered').getByTestId('exercise-illustration-fallback')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('probe-squat').getByTestId('exercise-animation')).toBeVisible()
    await page.getByTestId('private-pack-bundled').click()
    await expect(page.getByTestId('probe-covered').getByTestId('exercise-attribution')).toContainText('RepDB')
    await page.getByTestId('private-pack-delete').click()
    await page.getByTestId('private-pack-delete-confirm').click()
    await expect(page.getByTestId('private-pack-installed')).toHaveCount(0)
    expect(await page.evaluate(() => caches.has('salud-private-media'))).toBe(false)
  })

  test('rejects a zip with path traversal, a non-media file or a bad manifest, and stores nothing', async ({ page }) => {
    await page.goto(HARNESS)
    const input = page.getByTestId('private-pack-file')
    await input.waitFor({ state: 'attached' })
    const bytes = new Uint8Array(20).fill(1)
    const m = new TextEncoder().encode(JSON.stringify(manifest))
    const cases: [string, { name: string; data: Uint8Array }[], RegExp][] = [
      ['traversal.zip', [{ name: 'manifest.json', data: m }, { name: '../evil.webp', data: bytes }], /Ruta no permitida/],
      ['exe.zip', [{ name: 'manifest.json', data: m }, { name: 'run.exe', data: bytes }], /no son imagen/],
      ['nomanifest.zip', [{ name: 'a.webp', data: bytes }], /manifest.json/],
    ]
    for (const [name, files, message] of cases) {
      await input.setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(await makeZip(files)) })
      await expect(page.getByTestId('private-pack-error')).toContainText(message)
    }
    await input.setInputFiles({ name: 'x.zip', mimeType: 'application/zip', buffer: Buffer.from('definitely not a zip file') })
    await expect(page.getByTestId('private-pack-error')).toBeVisible()
    expect(await page.evaluate(() => caches.has('salud-private-media'))).toBe(false)
  })

  test('a corrupt stored manifest is reported and the pack stays disabled', async ({ page }) => {
    await page.goto(HARNESS)
    await page.evaluate(async () => {
      const cache = await caches.open('salud-private-media')
      await cache.put(new URL('/__salud-private__/manifest.json', location.origin).href, new Response('{"format":'))
    })
    await page.reload()
    await expect(page.getByTestId('private-pack-corrupt')).toBeVisible()
    await expect(page.getByTestId('private-pack-installed')).toHaveCount(0)
    await expect(page.getByTestId('probe-covered').getByTestId('exercise-attribution')).toContainText('RepDB')
  })
})

test.describe('check-distributable', () => {
  const script = join(root, 'scripts/check-distributable.mjs')
  const run = (dir: string) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' }) }
    } catch (e) {
      const err = e as { status: number; stderr: string }
      return { code: err.status, out: err.stderr }
    }
  }
  test('passes on the real tree and fails when a private pack is planted in a copy', async () => {
    expect(run(root).code).toBe(0)
    const tmp = mkdtempSync(join(tmpdir(), 'salud-dist-'))
    try {
      mkdirSync(join(tmp, 'dist/data'), { recursive: true })
      writeFileSync(join(tmp, 'dist/index.html'), '<html></html>')
      expect(run(tmp).code).toBe(0)
      writeFileSync(join(tmp, 'dist/data/exercise-media.json'), JSON.stringify(manifest))
      const planted = run(tmp)
      expect(planted.code).toBe(1)
      expect(planted.out).toContain('private-local')
      rmSync(join(tmp, 'dist/data/exercise-media.json'))
      mkdirSync(join(tmp, 'android/app/src/main/assets/private-media'), { recursive: true })
      cpSync(join(FIX, 'poster.webp'), join(tmp, 'android/app/src/main/assets/private-media/p.webp'))
      expect(run(tmp).code).toBe(1)
      rmSync(join(tmp, 'android'), { recursive: true })
      cpSync(zipPath, join(tmp, 'dist/private-pack.zip'))
      expect(run(tmp).code).toBe(1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
