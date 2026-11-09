import { AuthError } from './errors'

// Microsoft access token -> Xbox Live -> XSTS -> Minecraft services, then the
// ownership check and the player's profile. Takes fetch as a parameter so it
// can be tested without a real account.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface MinecraftSession {
  accessToken: string
  /** Milliseconds since epoch. */
  expiresAt: number
  profile: MinecraftProfile
}

export interface MinecraftProfile {
  id: string
  name: string
  /** The texture id of the skin the player wears (textures.minecraft.net), or null. */
  skin: string | null
}

const SKIN_URL = /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{16,128})$/

/** The profile from Minecraft services: id, name, and the skin that is on now. */
export function parseProfile(raw: unknown): MinecraftProfile {
  const p = raw as { id?: unknown; name?: unknown; skins?: { state?: unknown; url?: unknown }[] }
  if (typeof p?.id !== 'string' || !/^[0-9a-f]{32}$/i.test(p.id) || typeof p.name !== 'string') throw new AuthError('unknown', 'Unexpected profile')
  const on = Array.isArray(p.skins) ? p.skins.find((s) => s?.state === 'ACTIVE') : undefined
  const match = typeof on?.url === 'string' ? SKIN_URL.exec(on.url) : null
  return { id: p.id.toLowerCase(), name: p.name, skin: match ? match[1]! : null }
}

/** The profile again with a token the launcher already has (for a new name or skin). */
export async function fetchProfile(mcAccessToken: string, fetchFn: Fetch): Promise<MinecraftProfile> {
  const res = await call(fetchFn, MC_PROFILE, { headers: { authorization: `Bearer ${mcAccessToken}`, accept: 'application/json' } })
  if (!res.ok) throw new AuthError(res.status === 401 ? 'expired' : 'unknown', `Profile lookup answered ${res.status}`)
  return parseProfile(await json<unknown>(res))
}

const XBL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_ENTITLEMENTS = 'https://api.minecraftservices.com/entitlements/mcstore'
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile'

// XSTS error codes ("XErr") and what they mean for the player.
const XERR: Record<string, AuthError['code']> = {
  '2148916233': 'no-xbox-profile',
  '2148916235': 'xbox-unavailable',
  '2148916236': 'adult-verification',
  '2148916237': 'adult-verification',
  '2148916238': 'child-account'
}

async function call(fetchFn: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init)
  } catch {
    throw new AuthError('network')
  }
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new AuthError('unknown', `Unexpected reply from ${new URL(res.url || 'https://unknown').host}`)
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body)
})

export async function minecraftFromMicrosoft(msAccessToken: string, fetchFn: Fetch): Promise<MinecraftSession> {
  // 1. Xbox Live user token. "d=" marks a token from the Microsoft identity platform.
  const xblRes = await call(
    fetchFn,
    XBL,
    post({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  )
  if (!xblRes.ok) throw new AuthError(xblRes.status === 401 ? 'expired' : 'unknown', `Xbox Live answered ${xblRes.status}`)
  const xbl = await json<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(xblRes)
  const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs
  if (!xbl.Token || !uhs) throw new AuthError('unknown', 'Xbox Live gave no user hash')

  // 2. XSTS token for Minecraft. A 401 carries an XErr code explaining why.
  const xstsRes = await call(
    fetchFn,
    XSTS,
    post({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' })
  )
  if (xstsRes.status === 401) {
    const body = await json<{ XErr?: number | string }>(xstsRes).catch(() => ({ XErr: undefined }))
    throw new AuthError(XERR[String(body.XErr)] ?? 'unknown', `XSTS error ${String(body.XErr)}`)
  }
  if (!xstsRes.ok) throw new AuthError('unknown', `XSTS answered ${xstsRes.status}`)
  const xsts = await json<{ Token: string }>(xstsRes)

  // 3. Minecraft services token. An unapproved client ID fails here.
  const mcRes = await call(fetchFn, MC_LOGIN, post({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }))
  if (!mcRes.ok) {
    const text = await mcRes.text().catch(() => '')
    if (/invalid app registration/i.test(text) || mcRes.status === 403) throw new AuthError('invalid-app')
    if (mcRes.status === 429) throw new AuthError('network', 'Minecraft services asked to slow down')
    throw new AuthError('unknown', `Minecraft services answered ${mcRes.status}`)
  }
  const mc = await json<{ access_token: string; expires_in: number }>(mcRes)
  if (!mc.access_token) throw new AuthError('unknown', 'Minecraft services gave no token')
  const auth = { headers: { authorization: `Bearer ${mc.access_token}`, accept: 'application/json' } }

  // 4. Ownership and profile. Game Pass players may have no store entitlement
  //    but do have a profile, so the profile is what finally decides.
  const [entRes, profileRes] = await Promise.all([call(fetchFn, MC_ENTITLEMENTS, auth), call(fetchFn, MC_PROFILE, auth)])
  const entitlements = entRes.ok ? await json<{ items?: { name: string }[] }>(entRes) : { items: [] }
  const owns = (entitlements.items ?? []).some((i) => i.name === 'game_minecraft' || i.name === 'product_minecraft')

  if (profileRes.status === 404) throw new AuthError(owns ? 'no-profile' : 'no-minecraft')
  if (!profileRes.ok) throw new AuthError('unknown', `Profile lookup answered ${profileRes.status}`)
  const profile = parseProfile(await json<unknown>(profileRes))

  return {
    accessToken: mc.access_token,
    expiresAt: Date.now() + Math.max(60, mc.expires_in ?? 0) * 1000,
    profile
  }
}
