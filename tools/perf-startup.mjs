// Cold-start timing on a production preview: time from navigation start to the dashboard being visible,
// with the synthetic demo seed already restored, 4x CPU throttling (CDP) and no HTTP/service-worker cache.
// Usage: node tools/perf-startup.mjs [baseURL=http://localhost:4206/salud/] [--runs=5] [--cpu=4]
// Needs a running preview: npx vite preview --port 4206 --strictPort  (Chromium via PW_EXECUTABLE).
import { join } from 'node:path'
import { rolldown } from 'rolldown'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4206/salud/'
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const runs = Number(opt('runs', 5))
const cpu = Number(opt('cpu', 4))
const TZ = 'America/Bogota'

const bundle = await rolldown({ input: join(process.cwd(), 'src/test/seed/demoSeed.ts'), platform: 'node', logLevel: 'silent' })
const { output } = await bundle.generate({ format: 'esm' })
await bundle.close()
const mod = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'))
const now = new Date()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const json = JSON.stringify(mod.buildDemoBackup(today, now.toISOString()))

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
const dash = [], fcp = [], transferred = []
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.getByTestId('restore-link').click()
  await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await page.getByTestId('import-target').waitFor()
  await page.getByTestId('apply-import').click()
  await page.getByTestId('import-result').waitFor()
  await page.goto('about:blank')
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  let bytes = 0
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength })
  const t0 = Date.now()
  await page.goto(base, { waitUntil: 'commit' })
  await page.getByTestId('dashboard').waitFor({ state: 'visible', timeout: 120_000 })
  const t = Date.now() - t0
  const paint = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0)
  dash.push(t); fcp.push(Math.round(paint)); transferred.push(bytes)
  console.log(`run ${i + 1}: dashboard ${t} ms, FCP ${Math.round(paint)} ms, transferred ${(bytes / 1024).toFixed(0)} kB`)
  await ctx.close()
}
await browser.close()
console.log(`MEDIAN of ${runs} (cpu x${cpu}): dashboard ${median(dash)} ms, FCP ${median(fcp)} ms, transferred ${(median(transferred) / 1024).toFixed(0)} kB`)
