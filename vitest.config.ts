import { defineConfig } from 'vitest/config'

// Unit tests for main-process code that doesn't need Electron.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' }
})
