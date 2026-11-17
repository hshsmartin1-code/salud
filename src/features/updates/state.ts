import type { NativeRelease, OtaErrorCode, OtaManifest } from '../../ota/manifest'

export const UPDATE_REASONS: Record<OtaErrorCode, string> = {
  disabled: 'Las actualizaciones están desactivadas en esta compilación.',
  format: 'El manifiesto de actualización tiene un formato inválido.',
  signature: 'La firma de la actualización no es válida.',
  'unknown-key': 'La actualización usa una clave que esta app no reconoce.',
  channel: 'La actualización pertenece a otro canal.',
  downgrade: 'La versión ofrecida no es más nueva que la instalada.',
  native: 'Esta actualización requiere una versión nativa más reciente.',
  schema: 'La actualización requiere otro esquema de datos; instala una nueva versión nativa.',
  host: 'La dirección de descarga o su destino no está permitido.',
  integrity: 'El paquete descargado no coincide con el publicado. No se instaló.',
  blocked: 'Esta versión falló al arrancar y quedó bloqueada.',
  network: 'No se pudo conectar con el servidor de actualizaciones.',
  download: 'La descarga falló o se perdió la conexión. Puedes volver a intentarlo.',
  installer: 'El instalador no pudo preparar o activar la actualización.',
  storage: 'No se pudo guardar el estado de actualización en este dispositivo.',
  busy: 'Ya hay una operación de actualización en curso.',
  'trial-in-progress': 'La versión actual todavía debe confirmar que arrancó correctamente.',
}

export type NativeOffer = Omit<NativeRelease, 'apkUrl'> & { apkUrl?: string; route: 'apk' | 'play' }
export type UpdateState =
  | { status: 'idle' | 'checking' }
  | { status: 'none'; code: 'disabled' | 'no-update' | 'browser'; reason: string }
  | { status: 'available'; kind: 'web'; manifest: OtaManifest; releaseNotes: string }
  | { status: 'available'; kind: 'native'; native: NativeOffer; releaseNotes: string }
  | { status: 'incompatible' | 'error'; code: OtaErrorCode; reason: string }
  | { status: 'downloading'; progress: number; releaseNotes: string }
  | { status: 'ready-to-restart'; version: string; releaseNotes: string }
  | { status: 'applied'; version: string }
  | { status: 'rolled-back'; version: string; failedVersions: string[]; reason: string }

export type UpdateEvent = { type: 'transition'; state: UpdateState } | { type: 'progress'; percent: number }

/** Events originate from the service after its operation/compatibility guards have passed. */
export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  if (event.type === 'transition') return event.state
  if (state.status !== 'downloading' || !Number.isFinite(event.percent)) return state
  return { ...state, progress: Math.max(state.progress, Math.max(0, Math.min(100, event.percent))) }
}
