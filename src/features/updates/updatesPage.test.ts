import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { OTA_FORMAT_V2, type OtaManifest } from '../../ota/manifest'
import { OTA_OFF_TEXT, UpdatesView, type UpdatesViewProps } from './UpdatesPage'
import type { UpdateState } from './state'

const manifest: OtaManifest = { format: OTA_FORMAT_V2, version: '3.0.1', channel: 'beta', url: 'https://x.test/b.zip', sha256: 'a'.repeat(64), size: 3 * 1048576 + 262144,
  minNativeVersionCode: 6, schemaVersion: 5, createdAt: '2026-11-16T00:00:00Z', notes: 'Mejoras <b>de</b> estabilidad.' }
const base: UpdatesViewProps = {
  state: { status: 'idle' }, version: { webVersion: '3.0.0', nativeVersionCode: 6, nativeVersionName: '3.0.0' }, enabled: true, native: true,
  details: { bundleId: 'app.salud.personal.dev', channel: 'beta', manifestHost: 'localhost:4156', keyIds: ['dev-test'] },
  onCheck: vi.fn(), onDownload: vi.fn(), onApply: vi.fn(),
}
const render = (over: Partial<UpdatesViewProps>) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UpdatesView, { ...base, ...over })))
const nativeOffer = { versionCode: 7, versionName: '3.1.0', apkSha256: 'b'.repeat(64), notes: 'Nueva app.', mandatory: false }

describe('updates page states', () => {
  it('shows both versions in one line each, one primary button, and a closed technical disclosure', () => {
    const html = render({})
    expect(html).toContain('Interfaz')
    expect(html).toContain('3.0.0 (6)')
    expect(html).toContain('Buscar actualizaciones')
    expect(html.match(/data-testid="update-check"/g)).toHaveLength(1)
    expect(html).toMatch(/<details[^>]*data-testid="update-details"(?![^>]*\sopen)/)
    expect(html).toContain('Detalles técnicos')
    expect(html).toContain('app.salud.personal.dev')
  })

  const cases: [string, UpdateState, RegExp[]][] = [
    ['checking', { status: 'checking' }, [/Buscando…/]],
    ['up to date', { status: 'none', code: 'no-update', reason: 'x' }, [/Tienes la última versión/, /Buscar actualizaciones/]],
    ['web update with notes and size', { status: 'available', kind: 'web', manifest, releaseNotes: manifest.notes! }, [/3\.0\.1/, /3,3 MB/, /Novedades/, /Descargar e instalar/]],
    ['downloading', { status: 'downloading', progress: 41.6, releaseNotes: '' }, [/Descargando… 42 %/, /aria-valuenow="42"/]],
    ['ready to restart', { status: 'ready-to-restart', version: '3.0.1', releaseNotes: '' }, [/Reiniciar para aplicar/]],
    ['applied', { status: 'applied', version: '3.0.1' }, [/Actualizado a la versión 3\.0\.1/]],
    ['rolled back', { status: 'rolled-back', version: '3.0.0', failedVersions: ['3.0.2'], reason: 'r' }, [/No se pudo aplicar la versión 3\.0\.2; sigues en la anterior\./]],
    ['incompatible', { status: 'incompatible', code: 'schema', reason: 'Necesita otro esquema.' }, [/Necesita otro esquema\./, /Buscar actualizaciones/]],
    ['error', { status: 'error', code: 'download', reason: 'La descarga falló.' }, [/La descarga falló\./, /Volver a intentar/]],
    ['native sideload', { status: 'available', kind: 'native', native: { ...nativeOffer, route: 'apk', apkUrl: 'https://x.test/salud.apk' }, releaseNotes: 'Nueva app.' },
      [/Esta versión necesita instalar una nueva app/, /Descargar APK/, /href="https:\/\/x\.test\/salud\.apk"/, /tus datos se conservan/]],
  ]
  it.each(cases)('%s', (_name, state, patterns) => {
    const html = render({ state })
    for (const p of patterns) expect(html).toMatch(p)
  })

  it('available and ready states offer a secondary "Buscar de nuevo"', () => {
    for (const state of [{ status: 'available', kind: 'web', manifest, releaseNotes: '' }, { status: 'ready-to-restart', version: '3.0.1', releaseNotes: '' }, { status: 'available', kind: 'native', native: { ...nativeOffer, route: 'play' }, releaseNotes: '' }] as UpdateState[]) {
      expect(render({ state })).toContain('Buscar de nuevo')
    }
    expect(render({ state: { status: 'idle' } })).not.toContain('Buscar de nuevo')
  })

  it('renders release notes as text, never as markup', () => {
    const html = render({ state: { status: 'available', kind: 'web', manifest, releaseNotes: manifest.notes! } })
    expect(html).toContain('&lt;b&gt;de&lt;/b&gt;')
    expect(html).not.toContain('<b>de</b>')
  })

  it('Play distribution has no APK link', () => {
    const html = render({ state: { status: 'available', kind: 'native', native: { ...nativeOffer, route: 'play' }, releaseNotes: 'Nueva app.' } })
    expect(html).toContain('Esta versión necesita instalar una nueva app')
    expect(html).toContain('Google Play')
    expect(html).not.toContain('Descargar APK')
    expect(html).not.toContain('.apk')
  })

  it('OTA disabled: versions and one muted line, no button', () => {
    const html = render({ enabled: false })
    expect(html).toContain(OTA_OFF_TEXT)
    expect(html).not.toContain('update-check')
    expect(html).toContain('3.0.0 (6)')
    expect(html).toContain('sin canal')
  })

  it('web defers to the existing PWA prompt: no check button, no native version line', () => {
    const html = render({ native: false, version: { webVersion: '3.0.0', nativeVersionCode: null, nativeVersionName: null } })
    expect(html).toContain('aviso de nueva versión')
    expect(html).not.toContain('update-check')
    expect(html).not.toContain('App nativa')
  })
})
