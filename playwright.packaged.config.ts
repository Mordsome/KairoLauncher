import { defineConfig } from '@playwright/test'

// The packaged app, after `npm run dist:win` / `npm run dist:linux`.
export default defineConfig({
  testDir: 'tests/packaged',
  outputDir: 'test-results/packaged-output',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
