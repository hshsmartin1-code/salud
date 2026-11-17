import { defineConfig } from '@playwright/test'

// Account/sync end-to-end tests. Run with `npm run test:e2e:emulator` (starts the Firebase emulators).
const PORT = Number(process.env.PW_PORT ?? 4191)

export default defineConfig({
  testDir: './e2e-emulator',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/salud/`,
    channel: 'msedge',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    viewport: { width: 412, height: 915 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --mode emulator --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/salud/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
