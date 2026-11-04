import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { CSP_DEV, CSP_META } from './src/shared/csp'

// Puts the right Content Security Policy into index.html: strict for builds,
// relaxed only for the dev server.
function csp(): Plugin {
  let policy = CSP_META
  return {
    name: 'kairo-csp',
    configResolved(config) {
      policy = config.command === 'serve' ? CSP_DEV : CSP_META
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('%KAIRO_CSP%', policy)
    }
  }
}

export default defineConfig(({ mode }) => ({
  main: {
    define: {
      // The dev-only offline account exists only in `--mode offline` builds.
      __KAIRO_DEV_OFFLINE__: JSON.stringify(mode === 'offline')
    },
    // @xmcl/unzip 2.2.0 was published with "main": "./index.ts" (a file it
    // doesn't ship). Bundle the xmcl packages that use it and point it at its
    // built file. Remove once upstream publishes a fixed version.
    resolve: {
      alias: { '@xmcl/unzip': resolve('node_modules/@xmcl/unzip/dist/index.js') }
    },
    build: {
      externalizeDeps: { exclude: ['@xmcl/core', '@xmcl/installer'] }
    }
  },
  preload: {},
  renderer: {
    root: 'src/renderer',
    plugins: [react(), csp()],
    build: {
      minify: true,
      // No data: URIs, so the CSP can stay at 'self'.
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false }
    }
  }
}))
