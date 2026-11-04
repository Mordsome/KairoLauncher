import { defineConfig } from '@playwright/test'

// Real game launches. Downloads several GB the first time, so it runs on its
// own: `npm run test:launch` (builds with the dev offline account).
export default defineConfig({
  testDir: 'tests/launch',
  outputDir: 'test-results/launch-output',
  timeout: 45 * 60_000,
  workers: 1,
  reporter: 'list'
})
