import { existsSync } from 'node:fs'
import type { CapacitorConfig } from '@capacitor/cli'

// Android shell for the same web app. Build the web part with `npm run build:android`
// (relative asset paths, no service worker) before syncing. Data stays in the WebView's own
// IndexedDB: it is separate from the browser/PWA install — move it with Respaldo → exportar/importar
// or with the optional Google account sync (V2.2).
//
// The native Firebase Authentication plugin initialises Firebase when the app starts and needs the
// developer's own android/app/google-services.json (never committed). Without that file the plugin
// is left out of the Android build, so an unconfigured APK keeps working exactly like 2.1 (local only).
//
// SALUD_DEV=1 (set only by the Dev build tooling) produces the side-by-side "Salud Dev" test app:
// another application id, no Firebase plugin at all, so a missing client for that package cannot matter.
const saludDev = process.env.SALUD_DEV === '1'
const firebaseConfigured = !saludDev && existsSync('android/app/google-services.json')

const config: CapacitorConfig = {
  appId: saludDev ? 'app.salud.personal.dev' : 'app.salud.personal',
  appName: saludDev ? 'Salud Dev' : 'Salud',
  webDir: 'dist',
  android: {
    // No remote content is loaded into the WebView.
    allowMixedContent: false,
    // The allow-list is explicit, so every native plugin the app uses must be named here or it is left
    // out of the APK: back button (app), backup export (filesystem, share), rest-timer alert
    // (local-notifications). Firebase Authentication is added only when its config file exists.
    includePlugins: [
      '@capacitor/app',
      '@capacitor/filesystem',
      '@capacitor/share',
      '@capacitor/local-notifications',
      '@capgo/capacitor-updater',
      ...(firebaseConfigured ? ['@capacitor-firebase/authentication'] : []),
    ],
  },
  plugins: {
    CapacitorUpdater: {
      // Installed 8.54 README.md:383-394, 398, 406-415, 422-424, 650-677, 756-769.
      // Manual/self-hosted: no checks, statistics, channels or remotely configured endpoints.
      autoUpdate: false,
      statsUrl: '',
      channelUrl: '',
      updateUrl: '',
      // The native plugin floors the wait for a PENDING (just installed, not yet healthy) bundle at 30 s (PENDING_BUNDLE_APP_READY_MIN_TIMEOUT_MS),
      // so a smaller value changes nothing for the rollback case. Measured healthy cold start on the tablet: 5.2 s at worst (the project notes).
      appReadyTimeout: 30000,
      responseTimeout: 20,
      autoDeleteFailed: false, // Retain failure evidence to block retries after a restart.
      autoDeletePrevious: false,
      resetWhenUpdate: true, // A native upgrade always starts its own built-in schema-compatible UI.
      directUpdate: false,
      periodCheckDelay: 0,
      // DEV escape must match Vite's DEV build; production remains HTTPS-only.
      httpsOnly: !(process.env.NODE_ENV === 'development' && process.env.VITE_OTA_DEV_HTTP === '1'),
      allowHttpsToHttpRedirect: false,
      allowModifyUrl: false,
      persistModifyUrl: false,
      allowSetDefaultChannel: false,
      allowPreview: false,
      shakeMenu: false,
      allowShakeChannelSelector: false,
    },
    FirebaseAuthentication: {
      // Native Google sign-in only returns a credential; the Firebase JS SDK owns the session so
      // each local profile can keep its own account (see src/sync/auth.ts).
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
}

export default config
