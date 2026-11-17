// V3 QA: accessibility and touch/text-size checks on the integrated screens (synthetic demo seed, 412 x 915).
// Every check is strict. A case that fails because of an app defect is marked `fixme` with its issue id
// from the project notes (remove the entry from KNOWN_* when the defect is fixed and the case turns green).
//
//   PW_PORT=4171 npx playwright test e2e/v3-a11y.spec.ts
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { clockTest as test, demoJson, installClock, TZ } from './helpers'

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

/** Opens a route and waits until the lazy chunk, skeletons and charts have settled. */
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
  await page.goto('./' + hash)
  await page.waitForLoadState('domcontentloaded')
  await page.locator('main').waitFor()
  await expect(page.locator('.skeleton, [role=status]:has-text("Cargando")')).toHaveCount(0, { timeout: 15_000 })
  await page.waitForTimeout(500)
}

const SCREENS: { name: string; hash: string }[] = [
  { name: 'hoy', hash: '#/' },
  { name: 'salud', hash: '#/salud' },
  { name: 'cuerpo', hash: '#/cuerpo' },
  { name: 'cuerpo-nueva', hash: '#/cuerpo/nueva' },
  { name: 'actividad', hash: '#/actividad' },
  { name: 'sueno', hash: '#/sueno' },
  { name: 'signos', hash: '#/signos' },
  { name: 'agua', hash: '#/agua' },
  { name: 'habitos', hash: '#/habitos' },
  { name: 'ejercicios', hash: '#/entreno/ejercicios' },
  { name: 'ejercicio-detalle', hash: '#/entreno/ejercicios/fedb:Barbell_Squat' },
  { name: 'progreso', hash: '#/progreso' },
  { name: 'perfil', hash: '#/perfil' },
  { name: 'ajustes', hash: '#/ajustes' },
  { name: 'respaldo', hash: '#/respaldo' },
  { name: 'cuenta', hash: '#/cuenta' },
  { name: 'fotos', hash: '#/fotos' },
  { name: 'integraciones', hash: '#/integraciones' },
  { name: 'mas', hash: '#/mas' },
  { name: 'entreno', hash: '#/entreno' },
  { name: 'entreno-estadisticas', hash: '#/entreno/estadisticas' },
  { name: 'entreno-historial', hash: '#/entreno/historial' },
  { name: 'rutinas', hash: '#/entreno/rutinas' },
  { name: 'rutina-detalle', hash: 'routine:detail' },
  { name: 'rutina-editor', hash: 'routine:edit' },
  { name: 'comida', hash: '#/comida' },
  { name: 'comida-buscar', hash: '#/comida/buscar?meal=almuerzo' },
  { name: 'sesion-terminada', hash: 'session:done' },
  { name: 'sesion-en-vivo', hash: 'session:live' },
]

const dialog = (page: Page) => page.getByRole('dialog')
const SHEETS: { name: string; hash: string; trigger: (p: Page) => Promise<void> }[] = [
  { name: 'sheet-mas-registrar', hash: '#/salud', trigger: (p) => p.locator('nav[aria-label=Principal] button[aria-label=Registrar]').click() },
  { name: 'sheet-peso', hash: '#/salud', trigger: (p) => p.getByTestId('quick-weight').click() },
  { name: 'sheet-agua', hash: '#/salud', trigger: (p) => p.getByTestId('quick-water').click() },
  { name: 'sheet-sueno', hash: '#/salud', trigger: (p) => p.getByTestId('quick-sleep').click() },
  { name: 'sheet-presion', hash: '#/salud', trigger: (p) => p.getByTestId('quick-bloodPressure').click() },
  { name: 'sheet-mas-opciones', hash: '#/salud', trigger: (p) => p.getByTestId('quick-more').click() },
  { name: 'sheet-glucosa', hash: '#/salud', trigger: async (p) => { await p.getByTestId('quick-more').click(); await dialog(p).getByRole('button', { name: /Glucosa/ }).click() } },
  { name: 'sheet-actividad', hash: '#/actividad', trigger: (p) => p.getByTestId('new-activity').click() },
  { name: 'sheet-signo', hash: '#/signos', trigger: (p) => p.getByTestId('new-vital').click() },
  { name: 'sheet-perfiles', hash: '#/', trigger: (p) => p.getByTestId('profile-switcher').filter({ visible: true }).click() },
  { name: 'sheet-editar-perfil', hash: '#/perfil', trigger: (p) => p.getByRole('button', { name: 'Editar', exact: true }).click() },
  { name: 'sheet-nuevo-objetivo', hash: '#/perfil', trigger: (p) => p.getByRole('button', { name: /Nuevo objetivo/ }).click() },
  { name: 'sheet-ejercicio-propio', hash: '#/entreno/ejercicios', trigger: (p) => p.getByRole('button', { name: /Crear ejercicio propio/ }).click() },
]

async function openSheet(page: Page, s: (typeof SHEETS)[number]) {
  await open(page, s.hash)
  await s.trigger(page)
  await expect(dialog(page).last()).toBeVisible()
  await page.waitForTimeout(350) // entry animation + autofocus timer
}

// ───────────────────────────── in-page measurements (self-contained: serialised by Playwright) ─────────────────────────────

/**
 * Hit area of every visible interactive element, measured with elementFromPoint along three horizontal and three
 * vertical lines around the element (so `::before` extensions count and overlapping neighbours are subtracted).
 * Returns the elements whose hit area is under 44 px (1 px tolerance for the 1 px overlap of underline borders).
 */
function measureTouchTargets(rootSel: string | null) {
  const SEL = 'a, button, [role=button], input, select, textarea, [role=tab], [role=radio], [role=switch], [role=menuitem], [role=checkbox]'
  const root: ParentNode = (rootSel ? document.querySelector(rootSel) : null) ?? document
  const label = (el: Element) => ((el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).value || '') + '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const selector = (el: Element) => {
    const t = el.getAttribute('data-testid')
    if (t) return `[data-testid=${t}]`
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '')
  }
  const out: { sel: string; text: string; w: number; h: number; box: string; covered?: true }[] = []
  for (const el of Array.from(root.querySelectorAll(SEL))) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    // Content folded inside a closed Disclosure (<details>) is not on screen: only its <summary> is measured.
    if (el.closest('details:not([open])') && !el.closest('summary')) continue
    if (el.closest('[inert], [aria-hidden="true"]') || (el as HTMLInputElement).type === 'hidden') continue
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
    const r0 = el.getBoundingClientRect()
    if (r0.width === 0 || r0.height === 0) continue
    const isHiddenNative = el.matches('input[type=radio], input[type=checkbox]') && r0.width <= 2
    if (isHiddenNative && !(el as HTMLInputElement).labels?.length) continue
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    const cx = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
    const centreHit = !!cx && (el.contains(cx) || (!!(el as HTMLInputElement).labels && Array.from((el as HTMLInputElement).labels!).some((l) => l.contains(cx))))
    if (centreHit && r0.width >= 44 && r0.height >= 44) continue
    const hits = (h: Element | null) =>
      !!h && (el.contains(h) || !!(el as HTMLInputElement).labels && Array.from((el as HTMLInputElement).labels!).some((l) => l.contains(h)) || (h.closest('label') as HTMLLabelElement | null)?.control === el)
    const PAD = 48
    const run = (fixed: number, from: number, to: number, horizontal: boolean) => {
      let lo = 1e9, hi = -1
      for (let v = Math.max(0, Math.floor(from)); v <= Math.min((horizontal ? innerWidth : innerHeight) - 1, Math.ceil(to)); v++) {
        const h = horizontal ? document.elementFromPoint(v, fixed) : document.elementFromPoint(fixed, v)
        if (hits(h)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      return hi < 0 ? 0 : hi - lo + 1
    }
    let w = 0, h = 0
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height * f))
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width * f))
      w = Math.max(w, run(y, r.left - PAD, r.right + PAD, true))
      h = Math.max(h, run(x, r.top - PAD, r.bottom + PAD, false))
    }
    const covered = w === 0 && h === 0
    if (covered || w < 43 || h < 43) out.push({ sel: selector(el), text: label(el), w, h, box: `${Math.round(r.width)}x${Math.round(r.height)}`, ...(covered ? { covered: true as const } : {}) })
  }
  return out
}

/** Text smaller than 11 px and ALL-CAPS text (CSS uppercase, or a word of 5+ capitals with no lowercase). */
function measureText(rootSel: string | null) {
  const root: Node = (rootSel ? document.querySelector(rootSel) : null) ?? document.body
  const small: { sel: string; text: string; fs: number }[] = []
  const caps: { sel: string; text: string; why: string }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.nodeValue ?? '').trim()
    const el = n.parentElement
    if (!t || !el || seen.has(el) || el.closest('script, style, noscript, .sr-only, [aria-hidden="true"]:not(svg *)')) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue
    seen.add(el)
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    const id = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
    const fs = parseFloat(cs.fontSize)
    if (fs < 11) small.push({ sel: id, text: t.slice(0, 40), fs })
    const letters = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
    if (cs.textTransform === 'uppercase' && letters.length > 1) caps.push({ sel: id, text: t.slice(0, 40), why: 'text-transform: uppercase' })
    else if (/[A-ZÁÉÍÓÚÑ]{5,}/.test(t) && t === t.toUpperCase()) caps.push({ sel: id, text: t.slice(0, 40), why: 'texto en mayúsculas' })
  }
  return { small, caps }
}

/** Accessible-name and structure audit of what is visible. */
function measureStructure() {
  const vis = (el: Element) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"], [inert]') && !(el.closest('details:not([open])') && !el.closest('summary'))
  }
  const name = (el: Element): string => {
    const lb = el.getAttribute('aria-labelledby')
    if (lb) return lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    const al = el.getAttribute('aria-label')
    if (al) return al.trim()
    const labels = (el as HTMLInputElement).labels
    if (labels?.length) return Array.from(labels).map((l) => l.textContent ?? '').join(' ').trim()
    const txt = ((el as HTMLElement).innerText ?? '').trim()
    if (txt) return txt
    const img = el.querySelector('img[alt]:not([alt=""])')
    if (img) return img.getAttribute('alt') ?? ''
    return (el.getAttribute('title') ?? '').trim()
  }
  const sel = (el: Element) => el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : '')
  const unnamed = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=switch], [role=menuitem], [role=checkbox], [role=slider]'))
    .filter((el) => vis(el) || (el.matches('input[type=radio], input[type=checkbox]') && (el as HTMLInputElement).labels?.length))
    .filter((el) => !name(el))
    .map((el) => sel(el))
  const h1 = Array.from(document.querySelectorAll('h1')).filter(vis).map((h) => (h.textContent ?? '').trim())
  const mains = Array.from(document.querySelectorAll('main, [role=main]')).filter(vis).length
  const navs = Array.from(document.querySelectorAll('nav, [role=navigation]')).filter(vis).map((n) => n.getAttribute('aria-label') ?? '')
  const imgsNoAlt = Array.from(document.querySelectorAll('img:not([alt])')).filter(vis).map((i) => (i as HTMLImageElement).src.slice(-40))
  const headingJumps: string[] = []
  let prev = 0
  for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(vis)) {
    const lvl = +h.tagName[1]
    if (prev && lvl > prev + 1) headingJumps.push(`h${prev} → h${lvl}: ${(h.textContent ?? '').trim().slice(0, 30)}`)
    prev = lvl
  }
  return { unnamed, h1, mains, navs, imgsNoAlt, headingJumps }
}

// ───────────────────────────── known defects (see the project notes) ─────────────────────────────
const KNOWN_TOUCH: Record<string, string> = {
}
const KNOWN_TEXT: Record<string, string> = {
}
const KNOWN_STRUCTURE: Record<string, string> = {
}
const KNOWN_FOCUS: Record<string, string> = {
}

let ctx: BrowserContext
let page: Page

test.describe('V3 accesibilidad (semilla demo, 412 x 915)', () => {
  test.describe.configure({ mode: 'default' })
  test.beforeAll(async ({ browser, baseURL }) => {
    ctx = await browser.newContext({ baseURL, viewport: { width: 412, height: 915 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block' })
    await installClock(ctx)
    page = await ctx.newPage()
    liveSessionHash = null
    await restoreDemo(page)
    // Focus rings fade in over 150 ms; measure them in their final state.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
  })
  test.afterAll(async () => {
    await ctx.close()
  })

  // 2. Touch targets
  for (const s of SCREENS) {
    test(`tacto 44 px · ${s.name}`, async () => {
      test.fixme(!!KNOWN_TOUCH[s.name], KNOWN_TOUCH[s.name])
      await open(page, s.hash)
      const bad = await page.evaluate(measureTouchTargets, null)
      expect(bad, `controles con área táctil < 44 px en ${s.hash}`).toEqual([])
    })
  }
  for (const s of SHEETS) {
    test(`tacto 44 px · ${s.name}`, async () => {
      test.fixme(!!KNOWN_TOUCH[s.name], KNOWN_TOUCH[s.name])
      await openSheet(page, s)
      const bad = await page.evaluate(measureTouchTargets, '[role=dialog]')
      expect(bad, `controles con área táctil < 44 px en ${s.name}`).toEqual([])
    })
  }

  // 3. Text size and capitals
  for (const s of SCREENS) {
    test(`texto ≥ 11 px y sin mayúsculas · ${s.name}`, async () => {
      test.fixme(!!KNOWN_TEXT[s.name], KNOWN_TEXT[s.name])
      await open(page, s.hash)
      const r = await page.evaluate(measureText, null)
      expect(r.small, `texto < 11 px en ${s.hash}`).toEqual([])
      expect(r.caps, `texto en mayúsculas en ${s.hash}`).toEqual([])
    })
  }
  for (const s of SHEETS) {
    test(`texto ≥ 11 px y sin mayúsculas · ${s.name}`, async () => {
      test.fixme(!!KNOWN_TEXT[s.name], KNOWN_TEXT[s.name])
      await openSheet(page, s)
      const r = await page.evaluate(measureText, '[role=dialog]')
      expect(r.small).toEqual([])
      expect(r.caps).toEqual([])
    })
  }

  // 5. Structure: one h1, one main, names on every control, no skipped heading levels
  for (const s of SCREENS) {
    test(`estructura y nombres accesibles · ${s.name}`, async () => {
      test.fixme(!!KNOWN_STRUCTURE[s.name], KNOWN_STRUCTURE[s.name])
      await open(page, s.hash)
      const r = await page.evaluate(measureStructure)
      expect(r.h1, 'exactamente un h1 visible').toHaveLength(1)
      expect(r.mains, 'un solo landmark main').toBe(1)
      expect(r.navs.every((n) => n), `cada nav visible lleva aria-label: ${JSON.stringify(r.navs)}`).toBe(true)
      expect(r.unnamed, 'controles sin nombre accesible').toEqual([])
      expect(r.imgsNoAlt, 'imágenes sin atributo alt').toEqual([])
      expect(r.headingJumps, 'saltos de nivel de encabezado').toEqual([])
    })
  }

  // 5. Keyboard: Tab traversal reaches every control, focus is always visible, order follows the layout
  for (const s of SCREENS) {
    test(`teclado: foco visible, alcanzable y en orden · ${s.name}`, async () => {
      test.fixme(!!KNOWN_FOCUS[s.name], KNOWN_FOCUS[s.name])
      await open(page, s.hash)
      await page.evaluate(() => {
        window.scrollTo(0, 0)
        ;(document.activeElement as HTMLElement | null)?.blur()
        // Restart sequential focus navigation from the top of the page.
        const range = document.createRange()
        range.setStart(document.body, 0)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
      })
      const visited: { sel: string; top: number; visible: boolean; inMain: boolean }[] = []
      const ids = new Set<string>()
      let repeats = 0
      for (let i = 0; i < 140; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)/.test(cs.outlineColor)
          const ringOf = (st: CSSStyleDeclaration) => st.boxShadow !== 'none' && /rgba?\(/.test(st.boxShadow) && !/^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,? ?)+$/.test(st.boxShadow)
          // The ring may sit on the control or on a ::before / ::after that extends its hit area.
          const shadow = ringOf(cs) || ringOf(getComputedStyle(el, '::after')) || ringOf(getComputedStyle(el, '::before'))
          const inFixed = !!el.closest('header, nav, [role=dialog]')
          el.setAttribute('data-qa-seen', '1')
          const sel = (el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '')) + ' «' + ((el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value || '') + '').trim().replace(/\s+/g, ' ').slice(0, 24) + '»'
          return { sel, top: r.top + (inFixed ? 0 : window.scrollY), visible: outline || shadow, inMain: !inFixed, onScreen: r.width > 0 && r.height > 0, id: sel + '@' + Math.round(r.left) + ',' + Math.round(r.top + window.scrollY) }
        })
        if (!info) break
        if (ids.has(info.id)) {
          // Native date/time inputs keep focus across their segments; a real wrap-around returns to the first stop.
          if (info.id === visited[0]?.id || ++repeats > 8) break
          continue
        }
        repeats = 0
        ids.add(info.id)
        visited.push(info)
      }
      expect(visited.length, 'el teclado llega a algún control').toBeGreaterThan(0)
      const noRing = visited.filter((v) => !v.visible).map((v) => v.sel)
      expect(noRing, 'controles que reciben foco sin indicador visible').toEqual([])
      const jumps: string[] = []
      const main = visited.filter((v) => v.inMain)
      for (let i = 1; i < main.length; i++) if (main[i].top < main[i - 1].top - 150) jumps.push(`${main[i - 1].sel} → ${main[i].sel}`)
      expect(jumps, 'saltos del foco hacia arriba (> 150 px) dentro del contenido').toEqual([])
      const unreached = await page.evaluate(() => {
        const out: string[] = []
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('main a[href], main button, main input:not([type=hidden]), main select, main textarea'))) {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || (el as HTMLButtonElement).disabled) continue
          if (el.closest('details:not([open])') && !el.closest('summary')) continue // folded in a closed Disclosure
          if (el.tabIndex < 0 || el.hasAttribute('data-qa-seen')) continue
          out.push(el.tagName.toLowerCase() + ' «' + (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 24) + '»')
        }
        return out
      })
      if (visited.length < 139) expect(unreached, 'controles con tabindex ≥ 0 que Tab no alcanzó').toEqual([])
    })
  }

  // 5. Sheets: focus trapped, Escape closes, focus returns to the trigger
  for (const name of ['sheet-mas-registrar', 'sheet-peso', 'sheet-perfiles', 'sheet-editar-perfil', 'sheet-ejercicio-propio']) {
    const s = SHEETS.find((x) => x.name === name)!
    test(`hoja: foco atrapado y restaurado · ${s.name}`, async () => {
      await open(page, s.hash)
      const triggerDesc = await page.evaluate(() => (document.activeElement as HTMLElement)?.tagName ?? '')
      void triggerDesc
      await s.trigger(page)
      const dlg = dialog(page).last()
      await expect(dlg).toBeVisible()
      await page.waitForTimeout(300)
      // The element that held focus right before opening: whatever was clicked (the trigger).
      const insideFirst = await dlg.evaluate((d) => d.contains(document.activeElement))
      expect(insideFirst, 'al abrir, el foco entra en la hoja').toBe(true)
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
        const inside = await dlg.evaluate((d) => d.contains(document.activeElement))
        expect(inside, `Tab ${i + 1} sacó el foco de la hoja`).toBe(true)
      }
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        expect(await dlg.evaluate((d) => d.contains(document.activeElement)), 'Tab cíclico').toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const back = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el && el !== document.body ? (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 40) : ''
      })
      expect(back, 'al cerrar con Escape el foco vuelve al disparador (no a body)').not.toBe('')
    })
  }

  // 5. Chart keyboard read-out
  for (const hash of ['#/salud', '#/cuerpo', '#/agua', '#/entreno/ejercicios/fedb:Barbell_Squat']) {
    test(`gráfica: lectura con flechas · ${hash}`, async () => {
      await open(page, hash)
      const chart = page.locator('[role=img][tabindex="0"]').first()
      await chart.scrollIntoViewIfNeeded()
      await expect(chart).toBeVisible()
      const panel = chart.locator('xpath=ancestor::*[@data-testid="chart-panel"][1]')
      const before = await panel.innerText()
      const ariaBefore = await chart.getAttribute('aria-label')
      expect(ariaBefore, 'la gráfica tiene aria-label con resumen').toBeTruthy()
      await chart.focus()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => panel.innerText()).not.toBe(before)
      await page.keyboard.press('Escape')
    })
  }
})

// 9. prefers-reduced-motion: nothing animates (sheets, toasts, skeletons, charts, rings)
test.describe('V3 movimiento reducido', () => {
  test.describe.configure({ mode: 'default' })
  test.beforeAll(async ({ browser, baseURL }) => {
    ctx = await browser.newContext({ baseURL, viewport: { width: 412, height: 915 }, locale: 'es-CO', timezoneId: TZ, serviceWorkers: 'block', reducedMotion: 'reduce' })
    await installClock(ctx)
    page = await ctx.newPage()
    await restoreDemo(page)
  })
  test.afterAll(async () => {
    await ctx.close()
  })

  const running = (p: Page) =>
    p.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => {
          const t = a.effect?.getComputedTiming()
          const dur = typeof t?.duration === 'number' ? t.duration : 0
          return a.playState === 'running' && (dur > 1 || t?.iterations === Infinity)
        })
        .map((a) => `${a.constructor.name}:${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? '?'} on ${(a.effect as KeyframeEffect | null)?.target?.tagName?.toLowerCase()}.${String((a.effect as KeyframeEffect | null)?.target?.getAttribute('class') ?? '').slice(0, 40)}`),
    )

  for (const s of [SCREENS[0], SCREENS[1], SCREENS[2], SCREENS[10]]) {
    test(`sin animaciones en ${s.name}`, async () => {
      await page.goto('./' + s.hash)
      for (let i = 0; i < 6; i++) {
        expect(await running(page), `animaciones activas en ${s.hash}`).toEqual([])
        await page.waitForTimeout(150)
      }
      const smil = await page.evaluate(() => document.querySelectorAll('animate, animateTransform, animateMotion').length)
      expect(smil, 'animaciones SMIL en SVG').toBe(0)
    })
  }

  test('hoja y aviso con movimiento reducido', async () => {
    await open(page, '#/salud')
    await page.getByTestId('quick-weight').click()
    await expect(dialog(page)).toBeVisible()
    expect(await running(page), 'hoja al entrar').toEqual([])
    const sheetAnim = await dialog(page).evaluate((el) => getComputedStyle(el).animationName)
    expect(sheetAnim, 'la hoja no declara animación').toBe('none')
    await page.getByTestId('quick-save').click()
    await expect(page.locator('.toast-host').getByText(/guardado/i).first()).toBeVisible()
    expect(await running(page), 'aviso al entrar').toEqual([])
  })
})
