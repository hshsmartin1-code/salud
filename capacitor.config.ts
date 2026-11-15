import type { CapacitorConfig } from '@capacitor/cli'

// Android shell for the same web app. Build the web part with `npm run build:android`
// (relative asset paths, no service worker) before syncing. Data stays in the WebView's own
// IndexedDB: it is separate from the browser/PWA install — move it with Respaldo → exportar/importar.
const config: CapacitorConfig = {
  appId: 'app.salud.personal',
  appName: 'Salud',
  webDir: 'dist',
  android: {
    // Photos for label OCR are processed on the device; no remote content is loaded.
    allowMixedContent: false,
  },
}

export default config
