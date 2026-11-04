import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/output',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
