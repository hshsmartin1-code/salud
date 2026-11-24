/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Content-Security-Policy for the web build (GitHub Pages / PWA). Injected at build time so the allowed hosts follow
 * the build's own configuration: Open Food Facts always; Firebase (Auth popup + Firestore) only when a real project is
 * configured. Not applied to `--mode android` (the APK has its own trust boundary and OTA flow, not testable here) nor
 * to the dev server (HMR needs ws: and inline modules).
 */
export function cspContent(env: Record<string, string>): string {
  const connect = ["'self'", 'https://world.openfoodfacts.org']
  const script = ["'self'", "'wasm-unsafe-eval'"]
  const frame: string[] = []
  const authDomain = env.VITE_SYNC_DISABLED === '1' ? '' : (env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim()
  if (authDomain) {
    connect.push('https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com')
    script.push('https://apis.google.com')
    frame.push(`https://${authDomain}`, 'https://accounts.google.com', 'https://apis.google.com')
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.openfoodfacts.org",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    `frame-src ${frame.length ? frame.join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

function csp(mode: string): Plugin {
  return {
    name: 'salud-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (mode === 'android') return html
      const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))) } as Record<string, string>
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${cspContent(env)}" />`)
    },
  }
}

// GitHub Pages serves the site under /salud/. `vite build --mode android` builds the same app for the
// Capacitor shell: relative base and no service worker (the APK already ships every file).
export default defineConfig(({ mode }) => ({
  base: mode === 'android' ? './' : '/salud/',
  // node_modules may be a junction to another checkout; allow its real directory and nothing next to it.
  server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url)))] } },
  plugins: [
    react(),
    csp(mode),
    VitePWA({
      disable: mode === 'android',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png', 'THIRD_PARTY_NOTICES.txt'],
      manifest: {
        id: '/salud/',
        name: 'Salud — Personal Health OS',
        short_name: 'Salud',
        description: 'Registro de comida, entrenamiento y cuerpo, sin conexión.',
        lang: 'es-CO',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0c0e',
        theme_color: '#0b0c0e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}', 'muscle-figure/*.webp'],
        // OCR engine (≈ 6 MB used per device) and exercise illustrations are cached on first use instead.
        globIgnores: ['ocr/**', 'exercise-media/**'],
        maximumFileSizeToCacheInBytes: 14 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 12 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/exercise-media/'),
            handler: 'CacheFirst',
            options: { cacheName: 'exercise-media', expiration: { maxEntries: 2500 } },
          },
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app releases do not invalidate React or the database layer in the cache.
        // Firebase is intentionally not grouped: it stays in the lazy chunks of src/sync.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\/](?:react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\/]/, priority: 20 },
            { name: 'vendor-db', test: /node_modules[\/](?:dexie|dexie-react-hooks)[\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    passWithNoTests: true,
  },
}))
