import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OTA_FORMAT_V2, type OtaManifest } from '../../ota/manifest'
import { bannerHiddenOn, bannerModel, type BannerContext } from './bannerModel'
import { UpdateBannerView } from './UpdateBanner'
import type { UpdateState } from './state'

const manifest: OtaManifest = { format: OTA_FORMAT_V2, version: '3.2.0', channel: 'stable', url: 'https://x.test/b.zip', sha256: 'a'.repeat(64), size: 3000000,
  minNativeVersionCode: 7, schemaVersion: 5, createdAt: '2026-11-16T00:00:00Z', notes: 'Mejoras.' }
const nativeOffer = { versionCode: 8, versionName: '3.3.0', apkSha256: 'b'.repeat(64), notes: 'Nueva app.', route: 'apk' as const, apkUrl: 'https://x.test/salud.apk' }
const ctx: BannerContext = { native: true, enabled: true, hidden: false, failureCode: null }

const web: UpdateState = { status: 'available', kind: 'web', manifest, releaseNotes: 'Mejoras.' }
const nativeState: UpdateState = { status: 'available', kind: 'native', native: nativeOffer, releaseNotes: 'Nueva app.' }
const downloading = (progress: number): UpdateState => ({ status: 'downloading', progress, releaseNotes: '' })
const ready: UpdateState = { status: 'ready-to-restart', version: '3.2.0', releaseNotes: '' }
const err = (code: 'download' | 'integrity' | 'installer' | 'network' | 'signature'): UpdateState => ({ status: 'error', code, reason: `Razón ${code} larga y detallada del servicio.` })

describe('bannerModel', () => {
  it.each<[string, UpdateState, Partial<BannerContext>, object | null]>([
    ['idle', { status: 'idle' }, {}, null],
    ['checking (manual or automatic)', { status: 'checking' }, {}, null],
    ['none', { status: 'none', code: 'no-update', reason: 'x' }, {}, null],
    ['browser-managed none', { status: 'none', code: 'browser', reason: 'x' }, {}, null],
    ['incompatible is for the settings page only', { status: 'incompatible', code: 'schema', reason: 'x' }, {}, null],
    ['web update available', web, {}, { kind: 'available', text: 'Actualización disponible', detail: 'Versión 3.2.0', action: { id: 'download', label: 'Actualizar' }, dismissible: true, key: '3.2.0' }],
    ['native update required', nativeState, {}, { kind: 'native', text: 'Hay una versión nueva de la app', detail: 'Versión 3.3.0', action: { id: 'settings', label: 'Ver' }, dismissible: true, key: 'app-8' }],
    ['downloading 0 %', downloading(0), {}, { kind: 'progress', text: 'Descargando… 0 %', progress: 0, dismissible: false }],
    ['downloading 41.6 % rounds', downloading(41.6), {}, { kind: 'progress', text: 'Descargando… 42 %', progress: 42, dismissible: false }],
    ['downloading clamps above 100', downloading(180), {}, { text: 'Descargando… 100 %', progress: 100 }],
    ['downloading clamps below 0', downloading(-5), {}, { text: 'Descargando… 0 %', progress: 0 }],
    ['ready to restart', ready, {}, { kind: 'ready', text: 'Lista. Reiniciar para aplicar', action: { id: 'apply', label: 'Reiniciar' }, dismissible: true, key: '3.2.0' }],
    ['applied once', { status: 'applied', version: '3.2.0' }, {}, { kind: 'applied', text: 'Actualizado a la versión 3.2.0', action: { id: 'notes', label: 'Ver novedades' }, dismissible: true }],
    ['rolled back (existing warning text)', { status: 'rolled-back', version: '3.1.0', failedVersions: ['3.2.0'], reason: 'r' }, {},
      { kind: 'rolled-back', tone: 'warn', text: 'No se pudo aplicar la versión 3.2.0; sigues en la anterior.', dismissible: true }],
    ['rolled back, two versions', { status: 'rolled-back', version: '3.1.0', failedVersions: ['3.2.0', '3.2.1'], reason: 'r' }, {}, { text: 'No se pudo aplicar la versión 3.2.0, 3.2.1; sigues en la anterior.' }],
    ['download error started from the banner: short reason + Reintentar', err('download'), { failureCode: 'download' },
      { kind: 'error', tone: 'bad', text: 'No se pudo descargar. Revisa la conexión.', action: { id: 'retry', label: 'Reintentar' } }],
    ['integrity error', err('integrity'), { failureCode: 'integrity' }, { text: 'La descarga no es válida. No se instaló nada.' }],
    ['installer error', err('installer'), { failureCode: 'installer' }, { text: 'No se pudo preparar el reinicio.' }],
    ['code without a short text falls back to the service reason', err('signature'), { failureCode: 'signature' }, { text: 'Razón signature larga y detallada del servicio.' }],
    ['an error nobody started from the banner (failed manual check) is not announced', err('network'), {}, null],
    ['an error with another code than the banner operation is not announced', err('network'), { failureCode: 'download' }, null],
  ])('%s', (_name, state, over, expected) => {
    const model = bannerModel(state, null, { ...ctx, ...over })
    if (expected === null) expect(model).toBeNull()
    else expect(model).toMatchObject(expected)
  })

  it.each<[string, Partial<BannerContext>]>([
    ['browser build', { native: false }],
    ['OTA off in this build', { enabled: false }],
    ['hidden route / keyboard', { hidden: true }],
  ])('shows nothing for any state in: %s', (_name, over) => {
    for (const state of [web, nativeState, downloading(10), ready, err('download'), { status: 'applied', version: '3.2.0' } as UpdateState]) {
      expect(bannerModel(state, null, { ...ctx, failureCode: 'download', ...over })).toBeNull()
    }
  })

  describe('dismissal (remembered per version until the app restarts)', () => {
    it('hides the notice of the dismissed version only', () => {
      expect(bannerModel(web, '3.2.0', ctx)).toBeNull()
      expect(bannerModel(web, '3.1.9', ctx)).not.toBeNull()
      expect(bannerModel({ ...web, manifest: { ...manifest, version: '3.2.1' } }, '3.2.0', ctx)).toMatchObject({ detail: 'Versión 3.2.1' })
    })
    it('a native offer is dismissed by its build, independently of web versions', () => {
      expect(bannerModel(nativeState, 'app-8', ctx)).toBeNull()
      expect(bannerModel(nativeState, '3.2.0', ctx)).not.toBeNull()
      expect(bannerModel(web, 'app-8', ctx)).not.toBeNull()
    })
    it('never hides progress: it is the answer to a tap', () => {
      expect(bannerModel(downloading(10), 'downloading', ctx)).not.toBeNull()
    })
    it('dismissing an error only hides that error code', () => {
      expect(bannerModel(err('download'), 'error-download', { ...ctx, failureCode: 'download' })).toBeNull()
      expect(bannerModel(err('integrity'), 'error-download', { ...ctx, failureCode: 'integrity' })).not.toBeNull()
    })
  })

  it('announces progress to screen readers only in quarters', () => {
    const quarters = [0, 10, 24, 25, 49, 50, 99, 100].map((p) => bannerModel(downloading(p), null, ctx)!.announce)
    expect(quarters).toEqual(['Descargando la actualización, 0 %', 'Descargando la actualización, 0 %', 'Descargando la actualización, 0 %', 'Descargando la actualización, 25 %',
      'Descargando la actualización, 25 %', 'Descargando la actualización, 50 %', 'Descargando la actualización, 75 %', 'Descargando la actualización, 100 %'])
  })

  it('has no technical jargon in any text', () => {
    const states = [web, nativeState, downloading(42), ready, { status: 'applied', version: '3.2.0' } as UpdateState, err('download'), err('integrity'), err('installer'), err('network')]
    for (const state of states) {
      const m = bannerModel(state, null, { ...ctx, failureCode: state.status === 'error' ? state.code : null })!
      expect(`${m.text} ${m.detail ?? ''} ${m.action?.label ?? ''}`).not.toMatch(/bundle|manifest|firma|sha|checksum|OTA|APK|hash|canal/i)
    }
  })
})

describe('bannerHiddenOn', () => {
  it.each([
    ['/entreno/sesion/abc', true], ['/entreno/sesion/', true], ['/ajustes/actualizaciones', true],
    ['/perfiles/nuevo', true], ['/', false], ['/entreno', false], ['/entreno/rutinas', false], ['/ajustes', false], ['/comida/buscar', false], ['/perfil', false],
  ])('%s -> %s', (path, hidden) => { expect(bannerHiddenOn(path)).toBe(hidden) })
})

describe('UpdateBannerView markup', () => {
  const html = (state: UpdateState, over: Partial<BannerContext> = {}) =>
    renderToStaticMarkup(createElement(UpdateBannerView, { model: bannerModel(state, null, { ...ctx, ...over })!, onAction: () => undefined, onDismiss: () => undefined }))

  it('is one polite status region with a labelled dismiss control', () => {
    const out = html(web)
    expect(out).toContain('role="status"')
    expect(out).toContain('aria-live="polite"')
    expect(out).toContain('aria-label="Cerrar aviso"')
    expect(out).toContain('Actualizar')
    expect(out).toContain('h-11 w-11') // 44 px dismiss target
  })
  it('progress has a progressbar and no dismiss control', () => {
    const out = html(downloading(42))
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-valuenow="42"')
    expect(out).not.toContain('Cerrar aviso')
    expect(out).not.toContain('update-banner-action')
  })
  it('the rollback notice has no action', () => {
    const out = html({ status: 'rolled-back', version: '3.1.0', failedVersions: ['3.2.0'], reason: 'r' })
    expect(out).not.toContain('update-banner-action')
    expect(out).toContain('Cerrar aviso')
  })
  it('renders text, never markup', () => {
    const out = html({ status: 'error', code: 'signature', reason: 'Fallo <b>raro</b>' }, { failureCode: 'signature' })
    expect(out).toContain('&lt;b&gt;raro&lt;/b&gt;')
  })
})
