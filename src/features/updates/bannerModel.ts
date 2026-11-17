import type { OtaErrorCode } from '../../ota/manifest'
import type { UpdateState } from './state'

/**
 * Where the global notice must not appear: the live training session owns the screen, the updates page already says it all,
 * and the "new profile" flow is the onboarding form (the welcome/first-run screens are outside the app shell and never mount it).
 */
export function bannerHiddenOn(pathname: string): boolean {
  return pathname.startsWith('/entreno/sesion/') || pathname === '/ajustes/actualizaciones' || pathname === '/perfiles/nuevo'
}

export type BannerKind = 'available' | 'native' | 'progress' | 'ready' | 'error' | 'applied' | 'rolled-back'
export type BannerActionId = 'download' | 'apply' | 'retry' | 'settings' | 'notes'
export type BannerTone = 'info' | 'good' | 'warn' | 'bad'

export interface BannerContext {
  /** Android shell. The browser keeps its own service-worker prompt. */
  native: boolean
  /** OTA enabled in this build. */
  enabled: boolean
  /** The route, an open keyboard or any other reason to stay out of the way. */
  hidden: boolean
  /** Code of the last error produced by an operation started from THIS banner; other errors (a failed manual check) are not announced here. */
  failureCode: OtaErrorCode | null
}

export interface BannerModel {
  kind: BannerKind
  tone: BannerTone
  text: string
  /** Second, smaller line: the version. */
  detail?: string
  /** 0-100, only while downloading. */
  progress?: number
  /** Text for screen readers; changes only at quarter steps while downloading so a live region does not read every percent. */
  announce: string
  action?: { id: BannerActionId; label: string }
  dismissible: boolean
  /** Identity for «dismissed until restart»: the version (or app build) the notice is about. */
  key: string
}

const SHORT_ERRORS: Partial<Record<OtaErrorCode, string>> = {
  download: 'No se pudo descargar. Revisa la conexión.',
  network: 'No hay conexión con el servidor de actualizaciones.',
  integrity: 'La descarga no es válida. No se instaló nada.',
  installer: 'No se pudo preparar el reinicio.',
  storage: 'No se pudo guardar el estado de la actualización.',
  host: 'La dirección de descarga no está permitida.',
}

/**
 * Everything the banner shows, derived from the update state. Pure: no React, no service.
 * `dismissed` is the key of the notice the person closed in this run of the app (or null).
 */
export function bannerModel(state: UpdateState, dismissed: string | null, ctx: BannerContext): BannerModel | null {
  if (!ctx.native || !ctx.enabled || ctx.hidden) return null
  const model = build(state, ctx)
  if (!model || (model.dismissible && model.key === dismissed)) return null
  return model
}

function build(state: UpdateState, ctx: BannerContext): BannerModel | null {
  switch (state.status) {
    case 'available':
      if (state.kind === 'native') {
        const text = 'Hay una versión nueva de la app'
        return { kind: 'native', tone: 'info', text, detail: state.native.versionName ? `Versión ${state.native.versionName}` : undefined, announce: text,
          action: { id: 'settings', label: 'Ver' }, dismissible: true, key: `app-${state.native.versionCode}` }
      }
      return { kind: 'available', tone: 'info', text: 'Actualización disponible', detail: `Versión ${state.manifest.version}`, announce: `Actualización disponible, versión ${state.manifest.version}`,
        action: { id: 'download', label: 'Actualizar' }, dismissible: true, key: state.manifest.version }
    case 'downloading': {
      const percent = Math.round(Math.max(0, Math.min(100, state.progress)))
      return { kind: 'progress', tone: 'info', text: `Descargando… ${percent} %`, progress: percent, announce: `Descargando la actualización, ${Math.floor(percent / 25) * 25} %`, dismissible: false, key: 'downloading' }
    }
    case 'ready-to-restart':
      return { kind: 'ready', tone: 'good', text: 'Lista. Reiniciar para aplicar', detail: `Versión ${state.version}`, announce: `Lista. Reiniciar para aplicar la versión ${state.version}`,
        action: { id: 'apply', label: 'Reiniciar' }, dismissible: true, key: state.version }
    case 'error':
      if (ctx.failureCode !== state.code) return null
      return { kind: 'error', tone: 'bad', text: SHORT_ERRORS[state.code] ?? state.reason, announce: SHORT_ERRORS[state.code] ?? state.reason,
        action: { id: 'retry', label: 'Reintentar' }, dismissible: true, key: `error-${state.code}` }
    case 'applied':
      return { kind: 'applied', tone: 'good', text: `Actualizado a la versión ${state.version}`, announce: `Actualizado a la versión ${state.version}`,
        action: { id: 'notes', label: 'Ver novedades' }, dismissible: true, key: `applied-${state.version}` }
    case 'rolled-back': {
      const text = `No se pudo aplicar la versión ${state.failedVersions.join(', ')}; sigues en la anterior.`
      return { kind: 'rolled-back', tone: 'warn', text, announce: text, dismissible: true, key: `rolled-back-${state.failedVersions.join('+')}` }
    }
    case 'idle':
    case 'checking':
    case 'none':
    case 'incompatible':
      return null
  }
}
