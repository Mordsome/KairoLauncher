import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests for main-process code that doesn't need a running Electron.
export default defineConfig({
  resolve: {
    // Same workaround as electron.vite.config.ts: @xmcl/unzip's package entry is broken.
    alias: { '@xmcl/unzip': resolve('node_modules/@xmcl/unzip/dist/index.js') }
  },
  // Like a release build: no dev account, no local test releases.
  define: { __KAIRO_DEV_OFFLINE__: 'false' },
  // Process the xmcl packages through Vite so the alias above reaches them too.
  ssr: { noExternal: [/@xmcl\//] },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: [/@xmcl\//] } }
  }
})
