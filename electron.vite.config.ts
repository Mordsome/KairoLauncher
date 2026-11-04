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

export default defineConfig({
  main: {},
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
})
