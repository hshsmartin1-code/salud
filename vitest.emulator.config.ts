import { defineConfig } from 'vitest/config'

// Tests that need the local Firebase emulators (run with `npm run test:emulator`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['emulator-tests/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' },
  },
})
