import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { CSP_HEADER } from '../shared/csp'
import { APP_HOST, APP_SCHEME } from './origin'

// The UI is served from kairo://app/ instead of file://, so the page gets a
// proper origin, a CSP header and no access to the rest of the disk.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
}

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
    }
  ])
}

function plain(status: number): Response {
  return new Response(null, { status, headers: { 'Content-Type': 'text/plain' } })
}

export function serveRenderer(rendererDir: string): void {
  const root = normalize(rendererDir)

  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return plain(405)

    const url = new URL(request.url)
    if (url.host !== APP_HOST) return plain(404)

    let path: string
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return plain(400)
    }
    if (path === '/' || path === '') path = '/index.html'

    const file = normalize(join(root, path))
    if (!file.startsWith(root + sep)) return plain(403)

    const type = MIME[extname(file).toLowerCase()]
    if (!type) return plain(404)

    try {
      const body = await readFile(file)
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Security-Policy': CSP_HEADER,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cache-Control': 'no-cache'
        }
      })
    } catch {
      return plain(404)
    }
  })
}
