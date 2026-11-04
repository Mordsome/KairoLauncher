import { app } from 'electron'
import { createHash } from 'node:crypto'
import { Agent, fetch as undiciFetch, interceptors, setGlobalDispatcher, type Dispatcher } from 'undici'
import { KairoError } from '../errors'

// Every request the main process makes goes through this agent. It only
// talks HTTPS to the services listed on the Privacy tab, and always sends
// the launcher's own User-Agent. Keep ALLOWED_HOSTS and the Privacy tab in step.

export const USER_AGENT = `KairoLauncher/${app.getVersion()} (github.com/Mordsome/KairoLauncher)`

const ALLOWED_HOSTS = new Set([
  // Mojang: version lists, game files, Java runtimes
  'launchermeta.mojang.com',
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launcher.mojang.com',
  'libraries.minecraft.net',
  'resources.download.minecraft.net'
])

export function isAllowedUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

type Headers = Dispatcher.DispatchOptions['headers']

function withUserAgent(headers: Headers): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  const add = (key: unknown, value: unknown) => {
    const name = String(key).toLowerCase()
    if (name !== 'user-agent') out[name] = value as string | string[] | undefined
  }
  if (Array.isArray(headers)) {
    if (headers.length > 0 && Array.isArray(headers[0])) {
      for (const pair of headers as unknown as [string, string][]) add(pair[0], pair[1])
    } else {
      for (let i = 0; i + 1 < headers.length; i += 2) add(headers[i], headers[i + 1])
    }
  } else if (headers && typeof (headers as Iterable<unknown>)[Symbol.iterator] === 'function') {
    for (const [key, value] of headers as Iterable<[string, string]>) add(key, value)
  } else if (headers) {
    for (const [key, value] of Object.entries(headers)) add(key, value)
  }
  out['user-agent'] = USER_AGENT
  return out
}

class GuardedAgent extends Agent {
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin = String(options.origin ?? '')
    if (!isAllowedUrl(origin)) {
      throw new KairoError('blocked-host', `Refused to connect to ${safeHost(origin)}: not an allowed service.`)
    }
    return super.dispatch({ ...options, headers: withUserAgent(options.headers) }, handler)
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).host || 'an unknown address'
  } catch {
    return 'an unknown address'
  }
}

// Redirects and retries sit on top, so every hop goes back through the guard.
export const dispatcher: Dispatcher = new GuardedAgent({ connections: 32, connect: { timeout: 20_000 } }).compose(
  interceptors.retry({ maxRetries: 3, minTimeout: 500, maxTimeout: 4000 }),
  interceptors.redirect({ maxRedirections: 5 })
)

/** fetch() bound to the guarded agent. */
export const httpFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as (
  url: string,
  init?: RequestInit
) => Promise<Response>

/** Also route Node's global fetch through the guard, in case a library uses it. */
export function installGlobalGuard(): void {
  setGlobalDispatcher(dispatcher)
}

/** Downloads and parses JSON. With sha1, the raw bytes must match it. */
export async function fetchJson<T>(url: string, options: { sha1?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await httpFetch(url, { signal: options.signal })
  if (!response.ok) throw new KairoError('http-status', `${safeHost(url)} answered ${response.status}.`)
  const body = Buffer.from(await response.arrayBuffer())
  if (options.sha1 && createHash('sha1').update(body).digest('hex') !== options.sha1) {
    throw new KairoError('checksum', `The file from ${safeHost(url)} didn't match its checksum.`)
  }
  return JSON.parse(body.toString('utf8')) as T
}
