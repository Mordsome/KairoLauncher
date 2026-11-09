import { describe, expect, it } from 'vitest'
import { AuthError, describeAuthError } from '../../src/main/auth/errors'
import { minecraftFromMicrosoft } from '../../src/main/auth/xbox'

type Route = (init?: RequestInit) => Response
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const status = (code: number, body: unknown = {}) => new Response(JSON.stringify(body), { status: code })

function fakeFetch(overrides: Partial<Record<string, Route>> = {}) {
  const seen: { url: string; body?: string }[] = []
  const routes: Record<string, Route | undefined> = {
    'https://user.auth.xboxlive.com/user/authenticate': () => ok({ Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'hash' }] } }),
    'https://xsts.auth.xboxlive.com/xsts/authorize': () => ok({ Token: 'xsts' }),
    'https://api.minecraftservices.com/authentication/login_with_xbox': () => ok({ access_token: 'mc-token', expires_in: 86400 }),
    'https://api.minecraftservices.com/entitlements/mcstore': () => ok({ items: [{ name: 'product_minecraft' }, { name: 'game_minecraft' }] }),
    'https://api.minecraftservices.com/minecraft/profile': () => ok({ id: '0123456789abcdef0123456789ABCDEF', name: 'Steve' }),
    ...overrides
  }
  const fn = async (url: string, init?: RequestInit) => {
    seen.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    const route = routes[url]
    if (!route) throw new Error(`unexpected ${url}`)
    return route(init)
  }
  return { fn, seen }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'no error'
  } catch (e) {
    return e instanceof AuthError ? e.code : `other: ${String(e)}`
  }
}

describe('minecraftFromMicrosoft', () => {
  it('goes Microsoft -> Xbox -> XSTS -> Minecraft and returns the profile', async () => {
    const { fn, seen } = fakeFetch()
    const session = await minecraftFromMicrosoft('ms-token', fn)
    expect(session.profile).toEqual({ id: '0123456789abcdef0123456789abcdef', name: 'Steve', skin: null })
    expect(session.accessToken).toBe('mc-token')
    expect(JSON.parse(seen[0]!.body!).Properties.RpsTicket).toBe('d=ms-token')
    expect(JSON.parse(seen[2]!.body!).identityToken).toBe('XBL3.0 x=hash;xsts')
  })

  it.each([
    ['2148916233', 'no-xbox-profile'],
    ['2148916238', 'child-account'],
    ['2148916235', 'xbox-unavailable'],
    ['2148916236', 'adult-verification']
  ])('maps XSTS error %s to %s', async (xerr, expected) => {
    const { fn } = fakeFetch({ 'https://xsts.auth.xboxlive.com/xsts/authorize': () => status(401, { XErr: Number(xerr) }) })
    expect(await codeOf(minecraftFromMicrosoft('t', fn))).toBe(expected)
  })

  it('reports an unapproved client ID as "invalid app registration"', async () => {
    const { fn } = fakeFetch({
      'https://api.minecraftservices.com/authentication/login_with_xbox': () =>
        status(403, { error: 'Invalid app registration, see https://aka.ms/AppRegInfo for more information' })
    })
    expect(await codeOf(minecraftFromMicrosoft('t', fn))).toBe('invalid-app')
    expect(describeAuthError(new AuthError('invalid-app')).title).toBe('Invalid app registration')
  })

  it('no ownership and no profile means the account does not own Minecraft', async () => {
    const { fn } = fakeFetch({
      'https://api.minecraftservices.com/entitlements/mcstore': () => ok({ items: [] }),
      'https://api.minecraftservices.com/minecraft/profile': () => status(404)
    })
    expect(await codeOf(minecraftFromMicrosoft('t', fn))).toBe('no-minecraft')
  })

  it('owns the game but has no player name yet', async () => {
    const { fn } = fakeFetch({ 'https://api.minecraftservices.com/minecraft/profile': () => status(404) })
    expect(await codeOf(minecraftFromMicrosoft('t', fn))).toBe('no-profile')
  })

  it('accepts a profile without a store entitlement (Game Pass)', async () => {
    const { fn } = fakeFetch({ 'https://api.minecraftservices.com/entitlements/mcstore': () => ok({ items: [] }) })
    expect((await minecraftFromMicrosoft('t', fn)).profile.name).toBe('Steve')
  })

  it('network failures become a network error', async () => {
    const fn = async (): Promise<Response> => {
      throw new TypeError('fetch failed')
    }
    expect(await codeOf(minecraftFromMicrosoft('t', fn))).toBe('network')
  })

  it('every error has a plain message, and help links only go to official sites', () => {
    const codes = [
      'cancelled',
      'timeout',
      'network',
      'no-xbox-profile',
      'child-account',
      'xbox-unavailable',
      'adult-verification',
      'no-minecraft',
      'no-profile',
      'invalid-app',
      'expired',
      'sign-in-failed',
      'not-configured',
      'unknown'
    ] as const
    for (const code of codes) {
      const info = describeAuthError(new AuthError(code))
      expect(info.title.length).toBeGreaterThan(0)
      expect(info.message.length).toBeGreaterThan(0)
      if (info.help) expect(info.help.url).toMatch(/^https:\/\/(www\.xbox\.com|account\.microsoft\.com\/family|www\.minecraft\.net)\//)
    }
  })
})
