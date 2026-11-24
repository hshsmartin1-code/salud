// Large-dataset screen timings. Builds a synthetic ~3-year profile on top of the demo seed, restores it through the
// real backup import path and measures, in Chromium with CPU throttling, how long each screen takes to appear.
// Usage: node tools/perf-dataset.mjs [baseURL=http://localhost:4206/salud/] [--runs=3] [--cpu=4]
//          [--days=1100] [--sessions=450] [--photos=300] [--photoKb=200] [--only=entreno,fotos]
// Needs a running preview (npx vite preview --port 4206 --strictPort) and PW_EXECUTABLE for Chromium.
// Dataset (defaults): ~1100 days x 6 food entries, 450 sessions x 20 sets (9 000 sets), daily weights, 300 photos of ~200 kB.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rolldown } from 'rolldown'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4206/salud/'
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const runs = Number(opt('runs', 3))
const cpu = Number(opt('cpu', 4))
const DAYS = Number(opt('days', 1100))
const SESSIONS = Number(opt('sessions', 450))
const PHOTOS = Number(opt('photos', 300))
const PHOTO_KB = Number(opt('photoKb', 200))
const profile = args.includes('--profile') // print the top self-time functions of the last run of each screen
const only = opt('only', '').split(',').filter(Boolean)
const TZ = 'America/Bogota'

const bundle = await rolldown({ input: join(process.cwd(), 'src/test/seed/demoSeed.ts'), platform: 'node', logLevel: 'silent' })
const { output } = await bundle.generate({ format: 'esm' })
await bundle.close()
const mod = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'))
const now = new Date()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

// One noisy JPEG of about PHOTO_KB (full size) and one thumbnail, produced by the browser itself.
await page.goto(base)
const { full, thumb } = await page.evaluate(async (kb) => {
  const draw = (w, h, q) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const img = g.createImageData(w, h)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0
      img.data[i] = v; img.data[i + 1] = (v * 0.7) | 0; img.data[i + 2] = 255 - v; img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/jpeg', q)
  }
  let q = 0.5
  let url = draw(900, 1200, q)
  for (let i = 0; i < 8; i++) {
    const size = url.length * 0.75
    if (Math.abs(size - kb * 1024) < kb * 1024 * 0.1) break
    q = Math.min(0.95, Math.max(0.05, q * (kb * 1024) / size))
    url = draw(900, 1200, q)
  }
  return { full: url, thumb: draw(180, 240, 0.5) }
}, PHOTO_KB)
console.log(`photo: ${(full.length * 0.75 / 1024).toFixed(0)} kB, thumb ${(thumb.length * 0.75 / 1024).toFixed(1)} kB`)

// Synthetic profile: cycle the demo rows over many days with new ids.
const demo = mod.buildDemoBackup(today, now.toISOString())
const T = demo.tables
const pid = demo.profiles[0].id
const byDate = (rows) => {
  const m = new Map()
  for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r])
  return [...m.values()]
}
const foodDays = byDate(T.foodLogs)
const bodyRows = T.bodyMeasurements
const sessions = T.trainingSessions
const setsBySession = new Map()
for (const s of T.exerciseSets) setsBySession.set(s.sessionId, [...(setsBySession.get(s.sessionId) ?? []), s])
const foodLogs = []
const bodyMeasurements = []
for (let off = 0; off < DAYS; off++) {
  const date = addDays(today, -off)
  const tpl = foodDays[off % foodDays.length]
  for (let i = 0; i < 6; i++) {
    const src = tpl[i % tpl.length]
    foodLogs.push({ ...src, id: `${src.id}#${off}-${i}`, date })
  }
  const b = bodyRows[off % bodyRows.length]
  bodyMeasurements.push({ ...b, id: `${b.id}#${off}`, date, weightKg: Math.round((84 - (off / DAYS) * -6 + Math.sin(off / 5)) * 10) / 10 })
}
const trainingSessions = []
const exerciseSets = []
const spacing = Math.max(1, Math.floor(DAYS / SESSIONS))
for (let n = 0; n < SESSIONS; n++) {
  const date = addDays(today, -1 - n * spacing)
  const tpl = sessions[n % sessions.length]
  const sid = `${tpl.id}#${n}`
  trainingSessions.push({ ...tpl, id: sid, date, startedAt: `${date}T23:00:00.000Z`, endedAt: `${date}T23:55:00.000Z` })
  const tplSets = setsBySession.get(tpl.id) ?? []
  for (let i = 0; i < 20; i++) {
    const s = tplSets[i % tplSets.length]
    exerciseSets.push({ ...s, id: `${s.id}#${n}-${i}`, sessionId: sid, date, setIndex: i })
  }
}
const poses = ['front', 'side', 'back', 'other']
const progressPhotos = Array.from({ length: PHOTOS }, (_, i) => {
  const date = addDays(today, -Math.floor((i * DAYS) / PHOTOS))
  return { id: `photo-${i}`, profileId: pid, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`, date, pose: poses[i % 4], dataUrl: full, thumbUrl: thumb, width: 900, height: 1200, bytes: Math.round(full.length * 0.75) }
})
const backup = { ...demo, media: true, includedTables: [...demo.includedTables, 'progressPhotos'], tables: { ...T, foodLogs, bodyMeasurements, trainingSessions, exerciseSets, progressPhotos } }
const json = JSON.stringify(backup)
console.log(`dataset: ${foodLogs.length} food logs, ${trainingSessions.length} sessions, ${exerciseSets.length} sets, ${bodyMeasurements.length} weights, ${PHOTOS} photos; JSON ${(json.length / 1048576).toFixed(0)} MB`)

const dir = mkdtempSync(join(tmpdir(), 'salud-perf-'))
const file = join(dir, 'big.json')
writeFileSync(file, json)
const tImport = Date.now()
await page.getByTestId('restore-link').click()
await page.getByTestId('import-backup-file').setInputFiles(file)
await page.getByTestId('import-target').waitFor({ timeout: 300_000 })
await page.getByTestId('apply-import').click()
await page.getByTestId('import-result').waitFor({ timeout: 600_000 })
rmSync(dir, { recursive: true, force: true })
console.log(`import: ${((Date.now() - tImport) / 1000).toFixed(1)} s`)

const SCREENS = [
  ['entreno', '/entreno', '[data-testid="training-home"]'],
  ['ejercicios', '/entreno/ejercicios', '[data-testid="exercise-results"]'],
  ['detalle', '/entreno/ejercicios/' + encodeURIComponent('fedb:Barbell_Squat'), '[data-testid="exercise-detail"]'],
  ['comida', '/comida', '[data-testid="meals"]'],
  ['salud', '/salud', '[data-testid="health-hub"]'],
  ['progreso', '/progreso', '[data-testid="progress-charts"]'],
  ['fotos', '/fotos', '[data-testid="photos-gallery"]'],
]
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const results = {}
for (const [name, route, sel] of SCREENS) {
  if (only.length && !only.includes(name)) continue
  const times = []
  for (let i = 0; i < runs; i++) {
    await page.goto('about:blank')
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    await page.goto(base)
    await page.getByTestId('dashboard').waitFor({ timeout: 120_000 })
    if (profile && i === runs - 1) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start') }
    const ms = await page.evaluate(async ([r, s]) => {
      const t0 = performance.now()
      location.hash = r
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 120_000)
        const iv = setInterval(() => {
          if (document.querySelector(s)) { clearInterval(iv); clearTimeout(t); res() }
        }, 4)
      })
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      return performance.now() - t0
    }, [route, sel]).catch((e) => { console.log(`${name}: ${e.message}`); return NaN })
    times.push(Math.round(ms))
    if (profile && i === runs - 1) {
      const { profile: prof } = await cdp.send('Profiler.stop')
      const self = new Map()
      const dt = prof.timeDeltas
      const byId = new Map(prof.nodes.map((n) => [n.id, n]))
      prof.samples.forEach((id, k) => {
        const f = byId.get(id).callFrame
        const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`
        self.set(key, (self.get(key) ?? 0) + (dt[k] ?? 0))
      })
      console.log(`  profile ${name} (self ms, x${cpu} throttled):`)
      for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${(v / 1000).toFixed(0).padStart(6)}  ${k}`)
    }
    await cdp.detach()
  }
  results[name] = median(times)
  console.log(`${name}\tmedian ${results[name]} ms\t(${times.join(', ')})`)
}
console.log(JSON.stringify(results))
await browser.close()
