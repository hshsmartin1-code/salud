/**
 * Hands a backup file to the platform and says honestly whether that happened.
 *
 * - Web (browser or installed PWA): Blob + `<a download>` hands the file to the browser's download
 *   manager. That is the most the page can know, so it counts as saved.
 * - Android (Capacitor WebView): the WebView has no DownloadListener, so `<a download>` does nothing.
 *   The JSON is written with the Filesystem plugin to Documents/Salud/<name> (in chunks, so a backup with
 *   photos never travels through the bridge as one message). If Documents is not writable (scoped
 *   storage), it is written to the app cache and the system share sheet is opened so the person can save
 *   it to Files or Drive. `ok: true` only when the write (or the share) resolved.
 *
 * Plugin calls go through `src/integrations/files/native.ts` (injectable, so tests run in node).
 */
import { Capacitor } from '@capacitor/core'
import { nativeFiles, type NativeFilesApi } from '../../integrations/files/native'

export type SaveMethod = 'download' | 'native'

export type SaveOutcome =
  | { ok: true; method: 'download' }
  | { ok: true; method: 'documents'; path: string; uri: string; fileName: string }
  | { ok: true; method: 'share'; path: string; fileName: string }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error' | 'too-large'; message: string }

export interface SaveEnv {
  isNative: () => boolean
  files: () => Promise<NativeFilesApi>
  download: (blob: Blob, fileName: string) => void
}

export const UNSUPPORTED_MESSAGE =
  'En esta versión de Android no se puede guardar el archivo desde la app. No se registró ningún respaldo. Para proteger tus datos, vincula el perfil a tu cuenta en «Cuenta y sincronización» o exporta desde la app web en un navegador con estos mismos datos.'
export const CANCELLED_MESSAGE = 'No se guardó el respaldo: se canceló antes de elegir dónde guardarlo.'
export const ERROR_MESSAGE = 'No se pudo entregar el archivo del respaldo. Inténtalo de nuevo.'
export const TOO_LARGE_MESSAGE =
  'El respaldo es demasiado grande para guardarlo desde el teléfono de una sola vez. No se registró ningún respaldo. Vuelve a exportar sin fotos (desmarca «Incluir fotos») o exporta cada perfil por separado.'

/** Folder inside Documents, and the plain-words place shown to the person. */
export const NATIVE_FOLDER = 'Salud'
/** Characters per bridge message. A backup with photos can be tens of MB; each plugin call stays small. */
export const CHUNK_CHARS = 1 << 20
/** Above this the backup is refused with a warning instead of risking the WebView running out of memory. */
export const MAX_NATIVE_CHARS = 150_000_000

/** Pure choice of how to hand over a file. */
export function chooseSaveMethod(native: boolean): SaveMethod {
  return native ? 'native' : 'download'
}

/** Splits text in pieces of at most `size` characters, never between the halves of a surrogate pair. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; ) {
    let end = Math.min(i + size, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
    out.push(text.slice(i, end))
    i = end
  }
  return out.length ? out : ['']
}

function browserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const defaultSaveEnv: SaveEnv = {
  isNative: () => {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  },
  files: nativeFiles,
  download: browserDownload,
}

async function writeChunked(files: NativeFilesApi, dir: 'documents' | 'cache', path: string, text: string, size: number): Promise<string> {
  const [first, ...rest] = chunkText(text, size)
  try {
    const { uri } = await files.writeText(dir, path, first!)
    for (const piece of rest) await files.appendText(dir, path, piece)
    return uri
  } catch (e) {
    await files.remove(dir, path) // never leave a truncated backup behind
    throw e
  }
}

const isCancel = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /cancel/i.test(e.message))

async function saveNative(text: string, fileName: string, env: SaveEnv, chunk: number): Promise<SaveOutcome> {
  if (text.length > MAX_NATIVE_CHARS) return { ok: false, reason: 'too-large', message: TOO_LARGE_MESSAGE }
  let files: NativeFilesApi
  try {
    files = await env.files()
  } catch {
    return { ok: false, reason: 'unsupported', message: UNSUPPORTED_MESSAGE }
  }
  const path = `${NATIVE_FOLDER}/${fileName}`
  // 1) Documents/Salud. Android 9 and older ask for storage permission; Android 10+ may refuse (scoped storage).
  try {
    let uri: string
    try {
      uri = await writeChunked(files, 'documents', path, text, chunk)
    } catch {
      await files.requestStoragePermission().catch(() => undefined)
      uri = await writeChunked(files, 'documents', path, text, chunk)
    }
    return { ok: true, method: 'documents', path: `Documentos/${path}`, uri, fileName }
  } catch {
    /* Documents is not writable on this device: fall back to share */
  }
  // 2) App cache + system share sheet, so the person saves it to Files / Drive.
  try {
    const uri = await writeChunked(files, 'cache', path, text, chunk)
    await files.shareFile({ title: fileName, uri, dialogTitle: 'Guardar respaldo de Salud' })
    return { ok: true, method: 'share', path: fileName, fileName }
  } catch (e) {
    if (isCancel(e)) return { ok: false, reason: 'cancelled', message: CANCELLED_MESSAGE }
    return { ok: false, reason: 'error', message: ERROR_MESSAGE }
  }
}

/** Serialises `data` and hands it to the platform. Resolves `ok: true` only when a file was really written or shared. */
export async function saveJsonFile(data: unknown, fileName: string, env: SaveEnv = defaultSaveEnv, chunk = CHUNK_CHARS): Promise<SaveOutcome> {
  const native = chooseSaveMethod(env.isNative()) === 'native'
  let text: string
  try {
    text = JSON.stringify(data)
  } catch {
    return { ok: false, reason: 'error', message: ERROR_MESSAGE }
  }
  if (native) return saveNative(text, fileName, env, chunk)
  try {
    env.download(new Blob([text], { type: 'application/json' }), fileName)
    return { ok: true, method: 'download' }
  } catch {
    return { ok: false, reason: 'error', message: ERROR_MESSAGE }
  }
}

/** Offers the file written to Documents to other apps ("Compartir"). Never automatic. */
export async function shareSavedFile(uri: string, fileName: string, env: SaveEnv = defaultSaveEnv): Promise<{ ok: boolean; message?: string }> {
  try {
    await (await env.files()).shareFile({ title: fileName, uri, dialogTitle: 'Compartir respaldo de Salud' })
    return { ok: true }
  } catch (e) {
    return isCancel(e) ? { ok: false } : { ok: false, message: 'No se pudo abrir el menú para compartir.' }
  }
}

/** Plain-words sentence for a successful save, shown next to the "último respaldo" date. */
export function savedMessage(out: Extract<SaveOutcome, { ok: true }>): string {
  if (out.method === 'documents') return `Guardado en ${out.path}.`
  if (out.method === 'share') return 'Respaldo entregado a la app que elegiste. Comprueba que se guardó donde querías.'
  return 'Respaldo descargado. Búscalo en la carpeta de descargas.'
}
