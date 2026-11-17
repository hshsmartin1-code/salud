// V3 QA: overflow, clipped text, layout shift, empty states, long-name stress and sheets with the Android keyboard.
// Every check is strict. A case that fails because of an app defect is marked `fixme` with its issue id from
// the project notes (remove its entry from KNOWN_* once the defect is fixed).
//
//   PW_PORT=4171 npx playwright test e2e/v3-layout.spec.ts
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { ANA, clockTest as test, demoJson, installClock, onboard, TZ } from './helpers'

async function restoreDemo(page: Page) {
  const json = await demoJson()
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

/** Routine pages need a real id: take the first routine of the library. */
/** Session pages: a finished demo session (from the training home), and one live session started once. */
let liveSessionHash: string | null = null
async function resolveSessionHash(page: Page, hash: string): Promise<string> {
  if (hash === 'session:done') {
    await page.goto('./#/entreno')
    await page.locator('main').waitFor()
    const links = page.locator('main a[href*="/entreno/sesion/"]:not([data-testid=active-session])')
    await links.first().waitFor({ timeout: 15_000 })
    for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))) {
      const h = href.slice(href.indexOf('#'))
      if (h !== liveSessionHash) return h
    }
    throw new Error('sin sesión terminada en la demo')
  }
  if (liveSessionHash) return liveSessionHash
  await page.goto('./#/entreno')
  await page.getByTestId('start-routine').first().click()
  await page.getByTestId('live-session').waitFor({ timeout: 15_000 })
  liveSessionHash = new URL(page.url()).hash
  return liveSessionHash
}

async function resolveHash(page: Page, hash: string): Promise<string> {
  if (hash.startsWith('session:')) return resolveSessionHash(page, hash)
  if (!hash.startsWith('routine:')) return hash
  await page.goto('./#/entreno/rutinas')
  await page.locator('main').waitFor()
  const link = page.locator('main a[href*="/entreno/rutinas/"]:not([href$="/nueva"]):not([href$="/editar"])').first()
  await link.waitFor({ timeout: 15_000 })
  const href = (await link.getAttribute('href'))!
  const base = href.slice(href.indexOf('#'))
  return hash === 'routine:edit' ? base + '/editar' : base
}

async function open(page: Page, rawHash: string) {
  const hash = await resolveHash(page, rawHash)
  if (await page.getByRole('dialog').count()) {
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {})
  }
  await page.evaluate(() => {
    ;(window as unknown as { __cls: number }).__cls = 0
  })
  await page.goto('./' + hash)
  await page.waitForLoadState('domcontentloaded')
  await page.locator('main').waitFor()
  await expect(page.locator('.skeleton, [role=status]:has-text("Cargando")')).toHaveCount(0, { timeout: 15_000 })
  await page.waitForTimeout(1200) // let late layout (charts, images, fonts) happen so shifts are counted
}

const SCREENS: { name: string; hash: string; cta?: RegExp }[] = [
  { name: 'hoy', hash: '#/' },
  { name: 'salud', hash: '#/salud', cta: /Registrar|Peso/ },
  { name: 'cuerpo', hash: '#/cuerpo', cta: /Registrar|Nueva|Añadir|Medición/ },
  { name: 'cuerpo-nueva', hash: '#/cuerpo/nueva' },
  { name: 'actividad', hash: '#/actividad', cta: /Registrar|Añadir|Nueva|actividad/i },
  { name: 'sueno', hash: '#/sueno', cta: /Registrar|Añadir|Nuevo|sueño/i },
  { name: 'signos', hash: '#/signos', cta: /Registrar|Añadir|Nueva|Nuevo|signo/i },
  { name: 'agua', hash: '#/agua', cta: /Añadir|Registrar|\+|ml|vaso|botella/i },
  { name: 'habitos', hash: '#/habitos', cta: /Añadir|Nuevo|Crear|hábito|suplemento/i },
  { name: 'ejercicios', hash: '#/entreno/ejercicios' },
  { name: 'ejercicio-detalle', hash: '#/entreno/ejercicios/fedb:Barbell_Squat' },
  { name: 'progreso', hash: '#/progreso' },
  { name: 'perfil', hash: '#/perfil' },
  { name: 'ajustes', hash: '#/ajustes' },
  { name: 'respaldo', hash: '#/respaldo' },
  { name: 'cuenta', hash: '#/cuenta' },
  { name: 'fotos', hash: '#/fotos', cta: /Añadir|Nueva|foto/i },
  { name: 'integraciones', hash: '#/integraciones' },
  { name: 'mas', hash: '#/mas' },
  { name: 'entreno', hash: '#/entreno', cta: /Iniciar|rutina|Crear|Empezar|entrenamiento/i },
  { name: 'entreno-estadisticas', hash: '#/entreno/estadisticas' },
  { name: 'entreno-historial', hash: '#/entreno/historial' },
  { name: 'rutinas', hash: '#/entreno/rutinas' },
  { name: 'rutina-detalle', hash: 'routine:detail' },
  { name: 'rutina-editor', hash: 'routine:edit' },
  { name: 'comida', hash: '#/comida', cta: /Agregar|Buscar|Añadir|Registrar/i },
  { name: 'comida-buscar', hash: '#/comida/buscar?meal=almuerzo' },
  { name: 'sesion-terminada', hash: 'session:done' },
  { name: 'sesion-en-vivo', hash: 'session:live' },
]

/** Horizontal overflow of the page, elements sticking out of the viewport, and text that is cut off. */
function measureOverflow(rootSel?: string | null) {
  const out: { kind: string; sel: string; detail: string; text: string }[] = []
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth + 1) out.push({ kind: 'página con desbordamiento horizontal', sel: 'html', detail: `scrollWidth ${de.scrollWidth} > ${de.clientWidth}`, text: '' })
  const sel = (el: Element) => {
    const t = el.getAttribute('data-testid')
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    return el.tagName.toLowerCase() + (t ? `[data-testid=${t}]` : '') + (cls ? '.' + cls : '')
  }
  const inScroller = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true
    return false
  }
  const scope = rootSel ? (document.querySelector(rootSel) ?? document.body) : document.body
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    if (el.closest('.sr-only, svg')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)
    if (cs.position !== 'fixed' && (r.right > innerWidth + 1 || r.left < -1) && !inScroller(el) && !el.closest('[role=dialog]'))
      out.push({ kind: 'elemento fuera del viewport', sel: sel(el), detail: `left ${Math.round(r.left)} right ${Math.round(r.right)} (viewport ${innerWidth})`, text })
    const clipsX = /(hidden|clip)/.test(cs.overflowX)
    if (clipsX && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && el.children.length <= 1)
      out.push({ kind: 'texto recortado sin puntos suspensivos', sel: sel(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`, text })
    if (el.children.length === 0 && /(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && !/-webkit-box/.test(cs.display) && text)
      out.push({ kind: 'texto recortado en vertical', sel: sel(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`, text })
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && /\d/.test(text) && el.children.length === 0)
      out.push({ kind: 'cifra o dato truncado con puntos suspensivos', sel: sel(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`, text })
  }
  return out
}

const clsOf = (p: Page) => p.evaluate(() => (window as unknown as { __cls: number }).__cls)

const KNOWN_OVERFLOW: Record<string, string> = {}
const KNOWN_CLS: Record<string, string> = {}
const KNOWN_EMPTY: Record<string, string> = {}
const KNOWN_KEYBOARD: Record<string, string> = {}
const KNOWN_LONGNAME: Record<string, string> = {
}

let ctx: BrowserContext
let page: Page

const COMBOS = [
  { state: 'demo', width: 360, height: 800 },
  { state: 'demo', width: 412, height: 915 },
  { state: 'vacío', width: 360, height: 800 },
  { state: 'vacío', width: 412, height: 915 },
] as const

for (const combo of COMBOS) {
  test.describe(`V3 desbordamiento, saltos y estados · ${combo.state} · ${combo.width} px`, () => {
    test.describe.configure({ mode: 'default' })
    test.beforeAll(async ({ browser, baseURL }) => {
      ctx = await browser.newContext({ baseURL, viewport: { width: combo.width, height: combo.height }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
      await installClock(ctx)
      await ctx.addInitScript(() => {
        ;(window as unknown as { __cls: number }).__cls = 0
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value
          }).observe({ type: 'layout-shift', buffered: true })
        } catch {
          /* layout-shift unsupported */
        }
      })
      page = await ctx.newPage()
      liveSessionHash = null
      if (combo.state === 'demo') await restoreDemo(page)
      else await onboard(page)
    })
    test.afterAll(async () => {
      await ctx.close()
    })

    for (const s of SCREENS) {
      const key = `${s.name}:${combo.state}:${combo.width}`
      const needsRoutine = s.hash.startsWith('routine:') || s.hash.startsWith('session:')
      test(`sin desbordes ni recortes · ${s.name}`, async () => {
        test.fixme(!!KNOWN_OVERFLOW[key], KNOWN_OVERFLOW[key])
        test.skip(needsRoutine && combo.state === 'vacío', 'un perfil vacío no tiene rutinas ni sesiones')
        await open(page, s.hash)
        expect(await page.evaluate(measureOverflow), `desbordes en ${s.hash}`).toEqual([])
      })
      test(`sin saltos de maquetación · ${s.name}`, async () => {
        test.fixme(!!KNOWN_CLS[key], KNOWN_CLS[key])
        test.skip(needsRoutine && combo.state === 'vacío', 'un perfil vacío no tiene rutinas ni sesiones')
        await open(page, s.hash)
        const cls = await clsOf(page)
        expect(cls, `CLS acumulado al cargar ${s.hash}`).toBeLessThan(0.1)
      })
      if (combo.state === 'vacío' && s.cta) {
        test(`estado vacío con acción clara · ${s.name}`, async () => {
          test.fixme(!!KNOWN_EMPTY[s.name], KNOWN_EMPTY[s.name])
          await open(page, s.hash)
          const actions = page.locator('main').getByRole('button').or(page.locator('main').getByRole('link'))
          await expect(actions.filter({ hasText: s.cta! }).first(), `acción que diga qué hacer en ${s.hash}`).toBeVisible()
        })
      }
    }
  })
}

// 4. Long-name stress: a 60-character profile name and a 60-character custom exercise name
const LONG_NAME = 'María Fernanda González Rodríguez de la Cruz Pereira del Valle'.slice(0, 60)
const LONG_TOKEN = 'EjercicioPersonalizadoConUnNombreExtremadamenteLargoSinEspacio'.slice(0, 60)

test.describe('V3 nombres de 60 caracteres', () => {
  test.describe.configure({ mode: 'default' })
  test.beforeAll(async ({ browser, baseURL }) => {
    ctx = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
    await installClock(ctx)
    page = await ctx.newPage()
    await onboard(page, { ...ANA, name: LONG_NAME })
  })
  test.afterAll(async () => {
    await ctx.close()
  })

  test('el perfil conserva los 60 caracteres', async () => {
    await open(page, '#/perfil')
    await expect(page.locator('main').getByText(LONG_NAME).first()).toBeVisible()
  })
  for (const s of ['hoy', 'salud', 'perfil', 'mas', 'ajustes'].map((n) => SCREENS.find((x) => x.name === n)!)) {
    test(`perfil largo sin desbordes · ${s.name}`, async () => {
      test.fixme(!!KNOWN_LONGNAME[s.name], KNOWN_LONGNAME[s.name])
      await open(page, s.hash)
      expect(await page.evaluate(measureOverflow), `desbordes con nombre de 60 caracteres en ${s.hash}`).toEqual([])
    })
  }
  test('perfil largo sin desbordes · selector de perfiles y confirmación de borrado', async () => {
    test.fixme(!!KNOWN_LONGNAME['sheets'], KNOWN_LONGNAME['sheets'])
    await open(page, '#/')
    await page.getByTestId('profile-switcher').filter({ visible: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(measureOverflow, '[role=dialog]'), 'selector de perfiles').toEqual([])
    await page.keyboard.press('Escape')
    await open(page, '#/perfil')
    await page.getByRole('button', { name: /Eliminar perfil/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(measureOverflow, '[role=dialog]'), 'hoja «Eliminar a …»').toEqual([])
    await page.keyboard.press('Escape')
  })
  test('ejercicio propio de 60 caracteres sin desbordes en biblioteca y detalle', async () => {
    test.fixme(!!KNOWN_LONGNAME['ejercicio'], KNOWN_LONGNAME['ejercicio'])
    await open(page, '#/entreno/ejercicios')
    await page.getByRole('button', { name: /Crear ejercicio propio/ }).click()
    await page.getByRole('dialog').getByLabel('Nombre').fill(LONG_TOKEN)
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).or(page.getByRole('dialog').locator('button.btn-primary')).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('exercise-search').fill(LONG_TOKEN.slice(0, 20))
    const row = page.getByTestId('exercise-row').first()
    await expect(row).toBeVisible()
    expect(await page.evaluate(measureOverflow), 'biblioteca con ejercicio de nombre largo').toEqual([])
    await row.locator('a, button').first().click()
    await expect(page).toHaveURL(/#\/entreno\/ejercicios\//)
    await page.locator('main h1').waitFor()
    await page.waitForTimeout(600)
    expect(await page.evaluate(measureOverflow), 'detalle con ejercicio de nombre largo').toEqual([])
  })
})

// 6. Sheets with the Android keyboard (visualViewport shrinks like in e2e/v21-mobile.spec.ts)
const KB_SHEETS: { name: string; hash: string; trigger: (p: Page) => Promise<void> }[] = [
  { name: 'peso', hash: '#/salud', trigger: (p) => p.getByTestId('quick-weight').click() },
  { name: 'agua (otra cantidad)', hash: '#/salud', trigger: (p) => p.getByTestId('quick-water').click() },
  { name: 'sueño', hash: '#/salud', trigger: (p) => p.getByTestId('quick-sleep').click() },
  { name: 'presión arterial', hash: '#/salud', trigger: (p) => p.getByTestId('quick-bloodPressure').click() },
  { name: 'glucosa', hash: '#/salud', trigger: async (p) => { await p.getByTestId('quick-more').click(); await p.getByRole('dialog').getByRole('button', { name: /Glucosa/ }).click() } },
  { name: 'actividad', hash: '#/actividad', trigger: (p) => p.getByTestId('new-activity').click() },
  { name: 'signos vitales', hash: '#/signos', trigger: (p) => p.getByTestId('new-vital').click() },
  { name: 'editar perfil', hash: '#/perfil', trigger: (p) => p.getByRole('button', { name: 'Editar', exact: true }).click() },
  { name: 'nuevo objetivo', hash: '#/perfil', trigger: (p) => p.getByRole('button', { name: /Nuevo objetivo/ }).click() },
  { name: 'ejercicio propio', hash: '#/entreno/ejercicios', trigger: (p) => p.getByRole('button', { name: /Crear ejercicio propio/ }).click() },
]
const KB_VIEWPORT = 430

test.describe('V3 hojas con teclado de Android simulado', () => {
  test.describe.configure({ mode: 'default' })
  test.beforeAll(async ({ browser, baseURL }) => {
    ctx = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
    await installClock(ctx)
    page = await ctx.newPage()
    await restoreDemo(page)
  })
  test.afterAll(async () => {
    await ctx.close()
  })

  for (const s of KB_SHEETS) {
    for (const which of ['primero', 'último'] as const) {
      test(`campo ${which} y acción principal visibles · ${s.name}`, async () => {
        const key = `${s.name}:${which}`
        test.fixme(!!KNOWN_KEYBOARD[key], KNOWN_KEYBOARD[key])
        await open(page, s.hash)
        await s.trigger(page)
        const dlg = page.getByRole('dialog').last()
        await expect(dlg).toBeVisible()
        await page.waitForTimeout(350)
        // Fields folded in a closed Disclosure (<details>) are not on screen: only the open ones count.
        const fields = dlg.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(details:not([open]) *), textarea:not(details:not([open]) *), select:not(details:not([open]) *)')
        const n = await fields.count()
        test.skip(n === 0, 'la hoja no tiene campos')
        const field = which === 'primero' ? fields.first() : fields.nth(n - 1)
        await field.scrollIntoViewIfNeeded()
        await field.focus()
        await page.evaluate((h) => {
          const vv = window.visualViewport!
          Object.defineProperty(vv, 'height', { configurable: true, value: h })
          vv.dispatchEvent(new Event('resize'))
        }, KB_VIEWPORT)
        await page.waitForTimeout(400)
        const m = await dlg.evaluate((d) => {
          const f = document.activeElement as HTMLElement
          const fr = f.getBoundingClientRect()
          const sc = d.querySelector('.sheet-scroll') as HTMLElement
          const sr = sc.getBoundingClientRect()
          const prim = Array.from(d.querySelectorAll<HTMLElement>('button.btn-primary, button.btn-accent')).filter((b) => b.getClientRects().length).pop()
          const pr = prim?.getBoundingClientRect()
          const inFooter = !!prim && !sc.contains(prim)
          return {
            tag: f.tagName.toLowerCase(),
            fieldTop: Math.round(fr.top), fieldBottom: Math.round(fr.bottom),
            scrollTop: Math.round(sr.top), scrollBottom: Math.round(sr.bottom),
            dialogTop: Math.round(d.getBoundingClientRect().top), dialogBottom: Math.round(d.getBoundingClientRect().bottom),
            primaryBottom: pr ? Math.round(pr.bottom) : null, primaryTop: pr ? Math.round(pr.top) : null, inFooter,
          }
        })
        expect(m.dialogBottom, 'la hoja cabe en el viewport reducido').toBeLessThanOrEqual(KB_VIEWPORT + 1)
        expect(m.dialogTop, 'la hoja no sale por arriba').toBeGreaterThanOrEqual(0)
        expect(m.fieldBottom, `campo enfocado dentro del viewport (${JSON.stringify(m)})`).toBeLessThanOrEqual(KB_VIEWPORT + 1)
        expect(m.fieldTop, `campo enfocado no queda tapado por el borde de la hoja (${JSON.stringify(m)})`).toBeGreaterThanOrEqual(m.scrollTop - 1)
        expect(m.fieldBottom, `campo enfocado dentro del área desplazable (${JSON.stringify(m)})`).toBeLessThanOrEqual(m.scrollBottom + 1)
        if (m.primaryBottom !== null && m.inFooter) expect(m.primaryBottom, 'acción principal del pie visible sin desplazar').toBeLessThanOrEqual(KB_VIEWPORT + 1)
        if (m.primaryBottom !== null && !m.inFooter) {
          // No sticky footer: the action must at least be reachable by scrolling the sheet.
          await dlg.locator('.sheet-scroll').evaluate((e) => { e.scrollTop = e.scrollHeight })
          const b = await dlg.locator('button.btn-primary, button.btn-accent').last().boundingBox()
          expect(b!.y + b!.height, 'acción principal alcanzable al desplazar').toBeLessThanOrEqual(KB_VIEWPORT + 1)
        }
      })
    }
  }
})
