import type { ReactNode } from 'react'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Card, PageHeader, ProgressBar } from '../../ui/kit'
import { formatNumber } from '../../domain/units'
import { OTA_BUILD } from '../../ota/config'
import type { UpdateService, VersionInfo } from './service'
import type { UpdateState } from './state'
import { isNativeShell } from './shared'
import { useUpdates, type UpdateDetails } from './useUpdates'

export const OTA_OFF_TEXT = 'Las actualizaciones dentro de la app no están activadas en esta versión.'

export interface UpdatesViewProps {
  state: UpdateState
  version: VersionInfo | null
  versionFailed?: boolean
  enabled: boolean
  native: boolean
  details: UpdateDetails
  /** Signed notes of the bundle that is applied now; empty for the interface built into the APK (no section). */
  installedNotes?: string
  onCheck: () => void
  onDownload: () => void
  onApply: () => void
}

function Notes({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="mt-3" data-testid="update-notes">
      <h2 className="section-title mb-1">Novedades</h2>
      {/* Plain text only: release notes are never rendered as HTML. */}
      <p className="whitespace-pre-line break-words text-sm text-muted">{text}</p>
    </div>
  )
}

function StatusLine({ children, tone = 'ink', testId = 'update-status' }: { children: ReactNode; tone?: 'ink' | 'good' | 'warn' | 'bad'; testId?: string }) {
  const cls = { ink: 'text-ink', good: 'text-good', warn: 'text-warn', bad: 'text-bad' }[tone]
  return <p role="status" data-testid={testId} className={`text-sm font-medium ${cls}`}>{children}</p>
}

/** Presentational: every state of the update service has one calm, short rendering here. */
export function UpdatesView({ state, version, versionFailed, enabled, native, details, installedNotes, onCheck, onDownload, onApply }: UpdatesViewProps) {
  const checkButton = (label = 'Buscar actualizaciones') => (
    <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={onCheck} data-testid="update-check">{label}</button>
  )
  const recheck = (
    <button type="button" className="btn-secondary mt-2 w-full sm:w-auto" onClick={onCheck} data-testid="update-recheck">Buscar de nuevo</button>
  )
  let body: ReactNode = null
  if (!native) {
    body = <p className="text-sm text-muted" data-testid="update-web">En el navegador, la app se actualiza con el aviso de nueva versión que aparece en pantalla.</p>
  } else if (!enabled) {
    body = <p className="text-sm text-muted" data-testid="update-off">{OTA_OFF_TEXT}</p>
  } else {
    switch (state.status) {
      case 'idle':
        body = checkButton()
        break
      case 'checking':
        body = (
          <>
            <StatusLine>Buscando…</StatusLine>
            <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled data-testid="update-check">Buscando…</button>
          </>
        )
        break
      case 'none':
        body = (
          <>
            <StatusLine tone="good">{state.code === 'no-update' ? 'Tienes la última versión.' : state.reason}</StatusLine>
            {checkButton()}
          </>
        )
        break
      case 'available':
        if (state.kind === 'web') {
          body = (
            <>
              <StatusLine>Hay una versión nueva: {state.manifest.version} · {formatNumber(state.manifest.size / 1048576, 1)} MB</StatusLine>
              <Notes text={state.releaseNotes} />
              <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={onDownload} data-testid="update-download">Descargar e instalar</button>
              {recheck}
            </>
          )
        } else {
          body = (
            <>
              <StatusLine>Esta versión necesita instalar una nueva app</StatusLine>
              <p className="mt-1 text-sm text-muted">Versión {state.native.versionName}{state.native.mandatory ? ' · recomendada' : ''}</p>
              <Notes text={state.releaseNotes} />
              {state.native.route === 'apk' && state.native.apkUrl ? (
                <>
                  <a href={state.native.apkUrl} target="_blank" rel="noreferrer noopener" className="btn-primary mt-4 w-full sm:w-auto" data-testid="update-apk">Descargar APK</a>
                  <p className="mt-2 text-label text-muted">Se abre en el navegador y Android te pide confirmar la instalación. Al instalar sobre la misma app, tus datos se conservan.</p>
                </>
              ) : (
                <p className="mt-3 text-label text-muted" data-testid="update-play">Esta actualización llegará por Google Play.</p>
              )}
              {recheck}
            </>
          )
        }
        break
      case 'downloading':
        body = (
          <>
            <StatusLine>Descargando… {Math.round(state.progress)} %</StatusLine>
            <div className="mt-3" role="progressbar" aria-label="Progreso de la descarga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress)} data-testid="update-progress">
              <ProgressBar value={state.progress} max={100} height={8} />
            </div>
          </>
        )
        break
      case 'ready-to-restart':
        body = (
          <>
            <StatusLine tone="good">La versión {state.version} está lista.</StatusLine>
            <Notes text={state.releaseNotes} />
            <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={onApply} data-testid="update-apply">Reiniciar para aplicar</button>
            {recheck}
          </>
        )
        break
      case 'applied':
        body = (
          <>
            <StatusLine tone="good">Actualizado a la versión {state.version}.</StatusLine>
            {checkButton()}
          </>
        )
        break
      case 'rolled-back':
        body = (
          <>
            <StatusLine tone="warn" testId="update-rolled-back">No se pudo aplicar la versión {state.failedVersions.join(', ')}; sigues en la anterior.</StatusLine>
            {checkButton()}
          </>
        )
        break
      case 'incompatible':
        body = (
          <>
            <StatusLine tone="warn">{state.reason}</StatusLine>
            {checkButton()}
          </>
        )
        break
      case 'error':
        body = (
          <>
            <StatusLine tone="bad">{state.reason}</StatusLine>
            {checkButton('Volver a intentar')}
          </>
        )
        break
    }
  }
  const tech = (
    <Disclosure summary="Detalles técnicos" testId="update-details">
      <dl className="space-y-1 text-label text-muted">
        {details.bundleId ? <div className="flex justify-between gap-3"><dt>Identificador</dt><dd className="break-all text-right">{details.bundleId}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt>Canal</dt><dd>{enabled ? details.channel : 'sin canal'}</dd></div>
        <div className="flex justify-between gap-3"><dt>Servidor</dt><dd className="break-all text-right">{enabled && details.manifestHost ? details.manifestHost : 'ninguno'}</dd></div>
        <div className="flex justify-between gap-3"><dt>Clave de firma</dt><dd className="break-all text-right">{enabled && details.keyIds.length ? details.keyIds.join(', ') : 'ninguna'}</dd></div>
      </dl>
    </Disclosure>
  )
  return (
    <>
      <PageHeader title="Actualizaciones" back="/ajustes" />
      <Card>
        <div className="flex items-center gap-2">
          <Icon name="download" size={20} />
          <h2 className="text-heading font-semibold">Versión instalada</h2>
        </div>
        <dl className="mt-2 space-y-1 text-sm" data-testid="update-versions">
          <div className="flex justify-between gap-3"><dt className="text-muted">Interfaz</dt><dd data-testid="version-web">{version ? version.webVersion : versionFailed ? 'no disponible' : '…'}</dd></div>
          {native ? (
            <div className="flex justify-between gap-3"><dt className="text-muted">App nativa</dt><dd data-testid="version-native">{version && version.nativeVersionName ? `${version.nativeVersionName} (${version.nativeVersionCode})` : versionFailed ? 'no disponible' : '…'}</dd></div>
          ) : null}
        </dl>
        <div className="mt-4 border-t border-line pt-4">{body}</div>
      </Card>
      {installedNotes ? (
        <Card className="mt-3">
          <h2 className="text-heading font-semibold">Novedades de esta versión</h2>
          {/* Plain text only: signed release notes are never rendered as HTML. */}
          <p className="mt-2 whitespace-pre-line break-words text-sm text-muted" data-testid="installed-notes">{installedNotes}</p>
        </Card>
      ) : null}
      <div className="mt-3">{tech}</div>
    </>
  )
}

/** Ajustes → Actualizaciones. `service` is injectable for tests; the app uses the shared one. */
export function UpdatesPage({ service }: { service?: UpdateService }) {
  const u = useUpdates(service)
  return (
    <UpdatesView state={u.state} version={u.version} versionFailed={u.versionFailed} enabled={OTA_BUILD.enabled} native={service ? true : isNativeShell()}
      details={u.details} installedNotes={u.installedNotes} onCheck={u.check} onDownload={u.download} onApply={u.apply} />
  )
}
