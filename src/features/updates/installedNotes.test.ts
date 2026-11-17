import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { UpdatesView, type UpdatesViewProps } from './UpdatesPage'

const base: UpdatesViewProps = {
  state: { status: 'idle' }, version: { webVersion: '3.2.0', nativeVersionCode: 7, nativeVersionName: '3.1.0' }, enabled: true, native: true,
  details: { bundleId: null, channel: 'stable', manifestHost: 'github.com', keyIds: ['k2026a'] },
  onCheck: vi.fn(), onDownload: vi.fn(), onApply: vi.fn(),
}
const render = (over: Partial<UpdatesViewProps>) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UpdatesView, { ...base, ...over })))

describe('Novedades de esta versión', () => {
  it('shows the signed notes of the applied bundle as plain text, next to «Buscar actualizaciones»', () => {
    const html = render({ installedNotes: 'Mejoras <b>de</b> estabilidad.\nSegunda línea.' })
    expect(html).toContain('Novedades de esta versión')
    expect(html).toContain('Buscar actualizaciones')
    expect(html).toContain('&lt;b&gt;de&lt;/b&gt;')
    expect(html).not.toContain('<b>de</b>')
    expect(html).toContain('data-testid="installed-notes"')
  })
  it.each([undefined, ''])('has no section for the built-in interface (%j)', (installedNotes) => {
    const html = render({ installedNotes })
    expect(html).not.toContain('Novedades de esta versión')
    expect(html).not.toContain('installed-notes')
  })
})
