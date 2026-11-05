import {
  CryptoProvider,
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
  type ICachePlugin,
  type INetworkModule,
  type NetworkResponse
} from '@azure/msal-node'
import authConfig from '../../../config/auth.json'
import { httpFetch } from '../net/http'
import { AuthError } from './errors'
import { startLoopback } from './loopback'
import { SecretStore } from './secretStore'

// Microsoft sign-in: a public client (no secret), authorization code flow
// with PKCE, in the system browser, coming back to a localhost port.
// MSAL handles PKCE, the code exchange, the token cache and refresh; the
// cache is kept in the OS secure store.

const SCOPES = ['XboxLive.signin', 'offline_access']
const AUTHORITY = 'https://login.microsoftonline.com/consumers'
const AUTHORIZE_PREFIX = `${AUTHORITY}/oauth2/v2.0/authorize?`
const CACHE_KEY = 'msal-cache'

const clientId = typeof authConfig.clientId === 'string' && /^[0-9a-f-]{36}$/i.test(authConfig.clientId) ? authConfig.clientId : null

const store = new SecretStore()

// MSAL's HTTP calls go through the same guarded client as everything else.
async function toNetwork<T>(res: Response): Promise<NetworkResponse<T>> {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => (headers[key.toLowerCase()] = value))
  const text = await res.text()
  let body: unknown = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {}
  }
  return { headers, body: body as T, status: res.status }
}

const networkClient: INetworkModule = {
  sendGetRequestAsync: async <T>(url: string, options?: { headers?: Record<string, string> }) =>
    toNetwork<T>(await httpFetch(url, { headers: options?.headers })),
  sendPostRequestAsync: async <T>(url: string, options?: { headers?: Record<string, string>; body?: string }) =>
    toNetwork<T>(await httpFetch(url, { method: 'POST', headers: options?.headers, body: options?.body }))
}

const cachePlugin: ICachePlugin = {
  beforeCacheAccess: async (context) => {
    const data = await store.read(CACHE_KEY)
    if (data) context.tokenCache.deserialize(data)
  },
  afterCacheAccess: async (context) => {
    if (context.cacheHasChanged) await store.write(CACHE_KEY, context.tokenCache.serialize())
  }
}

let app: PublicClientApplication | null = null

function client(): PublicClientApplication {
  if (!clientId) throw new AuthError('not-configured')
  app ??= new PublicClientApplication({
    auth: { clientId, authority: AUTHORITY },
    cache: { cachePlugin },
    system: {
      networkClient,
      // No personal data in logs, and nothing at all below errors.
      loggerOptions: { piiLoggingEnabled: false, logLevel: LogLevel.Error, loggerCallback: () => undefined }
    }
  })
  return app
}

/** interactive: the failure happened during a fresh browser sign-in, not a refresh. */
function toAuthError(error: unknown, interactive = false): AuthError {
  if (error instanceof AuthError) return error
  if (error instanceof InteractionRequiredAuthError) return new AuthError('expired')
  const e = error as { errorCode?: string; code?: string; name?: string; cause?: unknown }
  const code = `${e.errorCode ?? ''} ${e.code ?? ''}`
  if (/network|ENOTFOUND|ECONN|ETIMEDOUT|UND_ERR/i.test(code)) return new AuthError('network')
  if (/invalid_client|unauthorized_client|AADSTS700016/i.test(code)) return new AuthError('not-configured', 'Microsoft does not know this client ID')
  if (/invalid_grant/i.test(code)) return new AuthError(interactive ? 'sign-in-failed' : 'expired')
  return new AuthError('unknown', e.errorCode ?? e.name ?? 'MSAL error')
}

export function isConfigured(): boolean {
  return clientId !== null
}

/**
 * Opens Microsoft's sign-in page in the system browser and waits for the
 * player to finish there. Returns the Microsoft access token and the
 * MSAL account it belongs to.
 */
export async function signInInteractive(
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal
): Promise<{ homeAccountId: string; accessToken: string }> {
  const pca = client()
  const loop = await startLoopback()
  try {
    const pkce = await new CryptoProvider().generatePkceCodes()
    const state = new CryptoProvider().createNewGuid()
    const url = await pca.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: loop.redirectUri,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account'
    })
    if (!url.startsWith(AUTHORIZE_PREFIX)) throw new AuthError('unknown', 'Unexpected sign-in address')
    await openBrowser(url)
    const code = await loop.waitForCode(state, signal)
    const result = await pca.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: loop.redirectUri, codeVerifier: pkce.verifier })
    if (!result.account || !result.accessToken) throw new AuthError('unknown', 'Microsoft returned no account')
    return { homeAccountId: result.account.homeAccountId, accessToken: result.accessToken }
  } catch (error) {
    throw toAuthError(error, true)
  } finally {
    loop.close()
  }
}

/** A fresh Microsoft access token without bothering the player (refresh token). */
export async function silentToken(homeAccountId: string): Promise<string> {
  const pca = client()
  const account = await pca.getTokenCache().getAccountByHomeId(homeAccountId)
  if (!account) throw new AuthError('expired')
  try {
    return (await pca.acquireTokenSilent({ account, scopes: SCOPES })).accessToken
  } catch (error) {
    throw toAuthError(error)
  }
}

/** Removes an account's Microsoft tokens from the cache. */
export async function forget(homeAccountId: string): Promise<void> {
  const pca = client()
  const account = await pca.getTokenCache().getAccountByHomeId(homeAccountId)
  if (account) await pca.getTokenCache().removeAccount(account)
}
