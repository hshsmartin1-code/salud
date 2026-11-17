/**
 * Android: the only place that touches `@capacitor/filesystem` and `@capacitor/share`. Everything else
 * talks to the small `NativeFilesApi` below, which tests replace with a fake (no plugins needed in node).
 * The plugin packages are imported lazily so the web bundle never loads them.
 */
export type NativeDir = 'documents' | 'cache'

export interface NativeFilesApi {
  /** Creates or overwrites a UTF-8 text file (creating missing folders) and returns its `file://` uri. */
  writeText(dir: NativeDir, path: string, text: string): Promise<{ uri: string }>
  /** Appends UTF-8 text to an existing file. */
  appendText(dir: NativeDir, path: string, text: string): Promise<void>
  /** Best effort; never throws. */
  remove(dir: NativeDir, path: string): Promise<void>
  /** Asks the system for storage permission where the OS still requires it (Android 9 and older). */
  requestStoragePermission(): Promise<void>
  /** Opens the system share sheet for a file. Rejects when the person cancels. */
  shareFile(options: { title: string; uri: string; dialogTitle: string }): Promise<void>
}

let api: Promise<NativeFilesApi> | null = null

export function nativeFiles(): Promise<NativeFilesApi> {
  api ??= (async (): Promise<NativeFilesApi> => {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const directory = (d: NativeDir) => (d === 'documents' ? Directory.Documents : Directory.Cache)
    return {
      writeText: async (dir, path, text) => {
        const r = await Filesystem.writeFile({ path, data: text, directory: directory(dir), encoding: Encoding.UTF8, recursive: true })
        return { uri: r.uri }
      },
      appendText: (dir, path, text) => Filesystem.appendFile({ path, data: text, directory: directory(dir), encoding: Encoding.UTF8 }),
      remove: async (dir, path) => {
        try {
          await Filesystem.deleteFile({ path, directory: directory(dir) })
        } catch {
          /* nothing to remove */
        }
      },
      requestStoragePermission: async () => {
        await Filesystem.requestPermissions()
      },
      shareFile: async ({ title, uri, dialogTitle }) => {
        await Share.share({ title, url: uri, dialogTitle })
      },
    }
  })()
  return api
}
