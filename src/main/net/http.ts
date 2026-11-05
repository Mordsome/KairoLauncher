import { app } from 'electron'
import { createHash } from 'node:crypto'
import { Agent, fetch as undiciFetch, interceptors, setGlobalDispatcher, type Dispatcher } from 'undici'
import { KairoError } from '../errors'

// Every request the main process makes goes through this agent. It only
// talks HTTPS to the services listed on the Privacy tab, and always sends
// the launcher's own User-Agent. Keep ALLOWED_HOSTS and the Privacy tab in step.

export const USER_AGENT = `KairoLauncher/${app.getVersion()} (github.com/Mordsome/KairoLauncher)`

// Host, and optionally the only path prefixes allowed on it.
const ALLOWED: Record<string, string[] | null> = {
  // Microsoft and Xbox: sign-in, then the Minecraft login and profile
  'login.microsoftonline.com': null,
  'login.live.com': null,
  'user.auth.xboxlive.com': ['/user/authenticate'],
  'xsts.auth.xboxlive.com': ['/xsts/authorize'],
  'api.minecraftservices.com': null,
  // Mojang: version lists, game files, Java runtimes
  'launchermeta.mojang.com': null,
  'piston-meta.mojang.com': null,
  'piston-data.mojang.com': null,
  'launcher.mojang.com': null,
  'libraries.minecraft.net': null,
  'resources.download.minecraft.net': null,
  // Fabric: loader versions and libraries
  'meta.fabricmc.net': null,
  'maven.fabricmc.net': null,
  // NeoForge and Forge: version lists, installers' checksums and libraries
  'maven.neoforged.net': null,
  'maven.minecraftforge.net': null,
  'files.minecraftforge.net': ['/net/minecraftforge/forge/promotions_slim.json'],
  // Modrinth: Fabric API, Sodium and other mods
  'api.modrinth.com': ['/v2/'],
  'cdn.modrinth.com': ['/data/'],
  // GitHub: Kairo releases (and later, launcher updates). Mordsome's repos only.
  'api.github.com': ['/repos/Mordsome/'],
  'github.com': ['/Mordsome/'],
  // Where GitHub release downloads redirect to.
  'release-assets.githubusercontent.com': null,
  'objects.githubusercontent.com': null
}

function hostAllowed(hostname: string, path: string): boolean {
  if (!Object.hasOwn(ALLOWED, hostname)) return false
  const prefixes = ALLOWED[hostname]
  return !prefixes || prefixes.some((p) => path.startsWith(p))
}

export function isAllowedUrl(raw: string, path?: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    return hostAllowed(url.hostname, path ?? url.pathname)
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
    if (!isAllowedUrl(origin, String(options.path ?? '/'))) {
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

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

/** GET with one polite retry when a service says "too many requests" (Modrinth, GitHub). */
export async function fetchOk(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
  let response = await httpFetch(url, init)
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    const seconds = Number(response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset') ?? 0)
    // Modrinth sends seconds until reset; GitHub sends a Unix time. Only wait for short resets.
    const delay = seconds > 1e9 ? seconds * 1000 - Date.now() : seconds * 1000
    if (delay > 0 && delay <= 60_000) {
      await wait(delay + 250, init.signal ?? undefined)
      response = await httpFetch(url, init)
    }
  }
  if (!response.ok) {
    const limited = response.status === 429 || response.status === 403
    throw new KairoError(
      'http-status',
      limited ? `${safeHost(url)} asked the launcher to slow down. Try again in a minute.` : `${safeHost(url)} answered ${response.status}.`
    )
  }
  return response
}

/** Downloads and parses JSON. With sha1, the raw bytes must match it. */
export async function fetchJson<T>(
  url: string,
  options: { sha1?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<T> {
  const response = await fetchOk(url, { signal: options.signal, headers: options.headers })
  const body = Buffer.from(await response.arrayBuffer())
  if (options.sha1 && createHash('sha1').update(body).digest('hex') !== options.sha1) {
    throw new KairoError('checksum', `The file from ${safeHost(url)} didn't match its checksum.`)
  }
  return JSON.parse(body.toString('utf8')) as T
}
