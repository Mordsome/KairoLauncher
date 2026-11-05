import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthError } from './errors'

// The browser comes back to http://localhost:<port>/ with the sign-in code.
// Listens on this PC only (127.0.0.1 and ::1), answers one valid request,
// then shuts down. Cancel or a 10 minute timeout also shut it down.

const TIMEOUT_MS = 10 * 60 * 1000

function page(title: string, text: string): string {
  // Self-contained: no scripts, no remote content.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Kairo Launcher</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1322;color:#eaf4fb;font:17px system-ui,sans-serif}
main{max-width:30rem;padding:2rem;text-align:center}h1{font-size:1.6rem;margin:0 0 .6rem}p{color:#b3c4d4;line-height:1.5;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`
}

export interface Loopback {
  redirectUri: string
  waitForCode(state: string, signal: AbortSignal): Promise<string>
  close(): void
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port))
  })
}

export async function startLoopback(): Promise<Loopback> {
  let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(404).end()
  }
  const route = (req: IncomingMessage, res: ServerResponse) => handler(req, res)
  const v4 = createServer(route)
  const port = await listen(v4, 0, '127.0.0.1')
  // Browsers may resolve "localhost" to ::1 first. Same port there if we can get it.
  const v6 = createServer(route)
  await listen(v6, port, '::1').catch(() => undefined)

  const close = () => {
    v4.close()
    v6.close()
    v4.closeAllConnections?.()
    v6.closeAllConnections?.()
  }

  return {
    redirectUri: `http://localhost:${port}`,
    close,
    waitForCode: (state, signal) =>
      new Promise<string>((resolve, reject) => {
        const finish = (error: AuthError | null, code?: string) => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          setTimeout(close, 500) // let the browser receive the page first
          if (error) reject(error)
          else resolve(code!)
        }
        const onAbort = () => finish(new AuthError('cancelled'))
        const timer = setTimeout(() => finish(new AuthError('timeout')), TIMEOUT_MS)
        signal.addEventListener('abort', onAbort)

        handler = (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (req.method !== 'GET' || url.pathname !== '/') {
            res.writeHead(404).end()
            return
          }
          const send = (status: number, title: string, text: string) =>
            res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page(title, text))

          // Anything without our exact state value is not our sign-in: ignore it.
          if (url.searchParams.get('state') !== state) {
            send(400, 'Not this sign-in', 'This page belongs to a different sign-in attempt. You can close it.')
            return
          }
          const error = url.searchParams.get('error')
          if (error) {
            send(200, 'Sign-in cancelled', 'Nothing was changed. You can close this tab and go back to Kairo Launcher.')
            finish(new AuthError(error === 'access_denied' ? 'cancelled' : 'unknown', `Microsoft returned ${error}`))
            return
          }
          const code = url.searchParams.get('code')
          if (!code) {
            send(400, 'Something went wrong', 'Microsoft sent no sign-in code. Go back to Kairo Launcher and try again.')
            finish(new AuthError('unknown', 'No code in redirect'))
            return
          }
          send(200, 'You can close this tab', 'You’re signed in. Go back to Kairo Launcher to finish.')
          finish(null, code)
        }
      })
  }
}
