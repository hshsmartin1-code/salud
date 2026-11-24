import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.PW_PORT ?? 4173)
// PW_EXECUTABLE=/path/to/chromium runs the suite on a local Chromium binary (cloud containers without Edge);
// PW_CHANNEL=chromium uses Playwright's own Chromium (CI). Default: Microsoft Edge, as on the owner's machine.
const EXE = process.env.PW_EXECUTABLE
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS ?? 3),
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/salud/`,
    ...(EXE ? { launchOptions: { executablePath: EXE } } : CHANNEL === 'chromium' ? {} : { channel: CHANNEL }),
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 412, height: 915 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/salud/`,
    // Never any real Firebase config in the regular e2e build, whatever .env.local holds.
    env: { VITE_SYNC_DISABLED: '1' },
    reuseExistingServer: true,
    timeout: 240_000,
  },
})
