import { app, session, shell } from 'electron'
import { isAppUrl, isDevServerRequest } from './origin'

/**
 * Locks down the default session and every web contents the app creates:
 * no permissions, no remote content in the renderer, no new windows,
 * no navigation away from the launcher's own pages.
 */
export function hardenApp(): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)

  // The renderer never talks to the network. Downloads and sign-in run in the
  // main process with Node's own HTTP client, which this filter doesn't touch.
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: !isDevServerRequest(details.url) })
  )

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => {
      if (!isAppUrl(event.url)) event.preventDefault()
    })
    contents.on('will-redirect', (event) => {
      if (!isAppUrl(event.url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

// Links the UI may open in the system browser. Exact https prefixes only.
const EXTERNAL_PREFIXES = [
  'https://github.com/Mordsome/',
  'https://mordsome.github.io/Kairo',
  // Official help pages linked from sign-in errors
  'https://www.xbox.com/',
  'https://account.microsoft.com/family/',
  'https://www.minecraft.net/'
]

/** href is prefix itself, or continues it at a "/", "?" or "#". */
export function isUnder(href: string, prefix: string): boolean {
  if (!href.startsWith(prefix)) return false
  if (prefix.endsWith('/') || href.length === prefix.length) return true
  return ['/', '?', '#'].includes(href[prefix.length]!)
}

export async function openExternalSafe(raw: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const href = url.toString()
  if (!EXTERNAL_PREFIXES.some((prefix) => isUnder(href, prefix))) return false
  await shell.openExternal(href)
  return true
}
