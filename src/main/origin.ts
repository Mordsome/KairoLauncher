import { app } from 'electron'

export const APP_SCHEME = 'kairo'
export const APP_HOST = 'app'
export const APP_ENTRY = `${APP_SCHEME}://${APP_HOST}/index.html`

// electron-vite sets this for `npm run dev`. A packaged build ignores it, so
// nobody can point the installed launcher at another page with an env var.
function devServer(): URL | null {
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (app.isPackaged || !raw) return null
  try {
    const url = new URL(raw)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url : null
  } catch {
    return null
  }
}

const dev = devServer()

export const isDevServer = dev !== null

export function rendererEntry(): string {
  return dev ? dev.toString() : APP_ENTRY
}

/** True for URLs that belong to the launcher's own UI. */
export function isAppUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) return true
  return dev !== null && url.origin === dev.origin
}

/** The dev server's own requests (page, modules, hot reload socket). */
export function isDevServerRequest(raw: string): boolean {
  if (!dev) return false
  try {
    const url = new URL(raw)
    return url.hostname === dev.hostname && url.port === dev.port
  } catch {
    return false
  }
}
