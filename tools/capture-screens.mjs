// Screenshot every main screen with the synthetic demo seed (no real data).
// Usage: node tools/capture-screens.mjs <outDir> [baseURL] [--themes=light,dark] [--sizes=mobile,desktop] [--only=hoy,comida]
// Needs a running preview (npx vite preview --port 4173) or pass a baseURL.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { rolldown } from 'rolldown'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = args[0] ?? 'screens'
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/salud/'
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d).split(',').filter(Boolean)
const themes = opt('themes', 'light,dark')
const sizes = opt('sizes', 'mobile,desktop')
const only = opt('only', '')
const NOW = process.env.E2E_NOW ?? '2026-11-18T16:30:00-05:00'
const TZ = 'America/Bogota'
mkdirSync(out, { recursive: true })

const SIZES = { mobile: { width: 390, height: 844 }, small: { width: 360, height: 740 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1366, height: 900 } }
const ROUTES = [
  ['hoy', '/'], ['comida', '/comida'], ['buscar', '/comida/buscar'], ['recetas', '/comida/recetas'], ['plantillas', '/comida/plantillas'], ['etiqueta', '/comida/etiqueta'],
  ['entreno', '/entreno'], ['historial', '/entreno/historial'], ['estadisticas', '/entreno/estadisticas'], ['ejercicios', '/entreno/ejercicios'], ['rutinas', '/entreno/rutinas'],
  ['salud', '/salud'], ['actividad', '/actividad'], ['sueno', '/sueno'], ['habitos', '/habitos'], ['signos', '/signos'], ['agua', '/agua'], ['cuerpo', '/cuerpo'],
  ['progreso', '/progreso'], ['fotos', '/fotos'], ['ajustes', '/ajustes'], ['perfil', '/perfil'], ['mas', '/mas'], ['respaldo', '/respaldo'], ['cuenta', '/cuenta'], ['integraciones', '/integraciones'], ['nutrientes', '/comida/nutrientes'],
]

const bundle = await rolldown({ input: join(process.cwd(), 'src/test/seed/demoSeed.ts'), platform: 'node', logLevel: 'silent' })
const { output } = await bundle.generate({ format: 'esm' })
await bundle.close()
const mod = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'))
const now = new Date(NOW)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const json = JSON.stringify(mod.buildDemoBackup(today, now.toISOString()))

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
for (const size of sizes) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: SIZES[size], locale: 'es-CO', timezoneId: TZ, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' })
    await ctx.clock.install({ time: now })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(base)
    await page.getByTestId('restore-link').click()
    await page.getByTestId('import-backup-file').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(json) })
    await page.getByTestId('import-target').waitFor()
    await page.getByTestId('apply-import').click()
    await page.getByTestId('import-result').waitFor()
    await page.goto(base)
    await page.reload()
    await page.getByTestId('dashboard').waitFor()
    for (const [name, route] of ROUTES) {
      if (only.length && !only.includes(name)) continue
      await page.goto(base + '#' + route)
      await page.waitForTimeout(900)
      const file = join(out, `${size}-${theme}-${name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      console.log(`${size}-${theme}-${name}\theight=${h}${overflow ? '\tOVERFLOW-X' : ''}`)
    }
    if (errors.length) console.log(`ERRORS ${size}-${theme}:`, [...new Set(errors)].slice(0, 10).join(' | '))
    await ctx.close()
  }
}
await browser.close()
