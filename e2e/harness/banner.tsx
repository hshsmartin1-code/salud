// Test harness (served only by a throwaway vite dev server in the e2e/capture tooling, never part of a build): the REAL
// AppShell (bottom navigation, "+" button, profile switcher), the REAL UpdateBanner and a fake update service that the
// test drives through window.__harness. Query: ?dock=1 adds a real DockBar, ?sheet=1 opens a real Sheet with a footer.
// Nothing in src/ knows about this file.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import '../../src/app/fonts.css'
import '../../src/index.css'
import { ProfileProvider, useProfiles } from '../../src/app/profile'
import { useTheme } from '../../src/app/theme'
import { createProfile, listProfiles } from '../../src/db/profiles'
import { OTA_FORMAT_V2, type OtaManifest } from '../../src/ota/manifest'
import { UpdateBanner, type BannerService } from '../../src/features/updates/UpdateBanner'
import { UpdatesView } from '../../src/features/updates/UpdatesPage'
import type { UpdateState } from '../../src/features/updates/state'
import { DockBar } from '../../src/features/training/shared/DockBar'
import { AppShell } from '../../src/ui/AppShell'
import { Card, PageHeader, Sheet } from '../../src/ui/kit'
import { UiProviders } from '../../src/ui/providers'

const manifest: OtaManifest = { format: OTA_FORMAT_V2, version: '3.2.0', channel: 'stable', url: 'https://example.test/salud-3.2.0.zip', sha256: 'a'.repeat(64), size: 9_400_000,
  minNativeVersionCode: 7, schemaVersion: 5, createdAt: '2026-11-16T00:00:00Z', notes: 'Mejoras.' }
const nativeOffer = { versionCode: 8, versionName: '3.3.0', apkSha256: 'b'.repeat(64), notes: 'Nueva app.', route: 'apk' as const, apkUrl: 'https://example.test/salud.apk' }

const STATES: Record<string, UpdateState> = {
  idle: { status: 'idle' },
  web: { status: 'available', kind: 'web', manifest, releaseNotes: 'Mejoras.' },
  native: { status: 'available', kind: 'native', native: nativeOffer, releaseNotes: 'Nueva app.' },
  progress: { status: 'downloading', progress: 42, releaseNotes: '' },
  ready: { status: 'ready-to-restart', version: '3.2.0', releaseNotes: '' },
  error: { status: 'error', code: 'download', reason: 'La descarga falló o se perdió la conexión. Puedes volver a intentarlo.' },
  applied: { status: 'applied', version: '3.2.0' },
  rolled: { status: 'rolled-back', version: '3.1.0', failedVersions: ['3.2.0'], reason: 'x' },
}

let state: UpdateState = STATES.idle
const listeners = new Set<() => void>()
const calls: string[] = []
const flags = { failDownload: false }
const emit = (next: UpdateState) => { state = next; for (const l of listeners) l() }
const fake: BannerService = {
  getState: () => state,
  subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } },
  check: async () => { calls.push('check'); return state },
  download: async () => { calls.push('download'); if (flags.failDownload) emit(STATES.error); return state },
  apply: async () => { calls.push('apply'); return state },
  acknowledge: () => { calls.push('acknowledge'); if (state.status === 'applied' || state.status === 'rolled-back') emit({ status: 'idle' }) },
}
;(window as unknown as { __harness: unknown }).__harness = { set: (name: string) => emit(STATES[name]), flags, calls }

function Filler({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} back="/" />
      <div className="space-y-3">
        {Array.from({ length: 14 }, (_, i) => (
          <Card key={i}>
            <p className="text-sm font-semibold">Elemento sintético {i + 1}</p>
            <p className="text-sm text-muted">Texto de relleno para comprobar que el contenido se desplaza por debajo del aviso.</p>
          </Card>
        ))}
        <button type="button" className="btn-primary w-full" data-testid="last-control">Último control de la página</button>
      </div>
    </>
  )
}

/** The real settings view with the fake state (first line of the notes page screenshots). */
function UpdatesRoute() {
  const current = useSyncExternalStore(fake.subscribe, fake.getState)
  const notes = new URLSearchParams(window.location.search).get('notes') === '0' ? '' : 'Más rápido al abrir el diario.\nCorrige el aviso de la hora de la comida.'
  return (
    <UpdatesView state={current} version={{ webVersion: '3.2.0', nativeVersionCode: 7, nativeVersionName: '3.1.0' }} enabled native installedNotes={notes}
      details={{ bundleId: 'app.salud.personal', channel: 'stable', manifestHost: 'github.com', keyIds: ['k2026a', 'k2026b'] }} onCheck={() => undefined} onDownload={() => undefined} onApply={() => undefined} />
  )
}

function Content() {
  const params = new URLSearchParams(window.location.search)
  const [sheet, setSheet] = useState(params.get('sheet') === '1')
  return (
    <>
      <Filler title="Hoy" />
      {params.get('dock') === '1' ? <DockBar label="Acciones de la rutina"><button type="button" className="btn-primary flex-1">Guardar rutina</button></DockBar> : null}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Registrar" footer={<button type="button" className="btn-primary w-full" data-testid="sheet-footer">Guardar</button>}>
        <p className="py-4 text-sm text-muted">Contenido de la hoja.</p>
      </Sheet>
    </>
  )
}

function Seeded() {
  const { profiles } = useProfiles()
  useEffect(() => {
    void listProfiles().then((list) => list.length ? undefined : createProfile({ name: 'Perfil sintético', sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }))
  }, [])
  useSyncExternalStore(fake.subscribe, fake.getState)
  if (!profiles || profiles.length === 0) return <div className="min-h-dvh bg-bg" />
  return (
    <AppShell header={<span className="text-sm font-semibold">Perfil sintético</span>}>
      <UpdateBanner service={fake} native enabled />
      <Routes>
        <Route path="/entreno/sesion/:id" element={<Filler title="Sesión en curso" />} />
        <Route path="/ajustes/actualizaciones" element={<UpdatesRoute />} />
        <Route path="*" element={<Content />} />
      </Routes>
    </AppShell>
  )
}

function Root() {
  useTheme()
  return <UiProviders><ProfileProvider><Seeded /></ProfileProvider></UiProviders>
}

createRoot(document.getElementById('root')!).render(<HashRouter><Root /></HashRouter>)
