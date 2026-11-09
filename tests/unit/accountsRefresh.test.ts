import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// No real sign-in, secure store or network: all three are stand-ins here.
const data = mkdtempSync(join(tmpdir(), 'kairo-accounts-'))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false },
  shell: { openExternal: vi.fn() }
}))
const secrets = new Map<string, string>()
vi.mock('../../src/main/auth/secretStore', () => ({
  SecretStore: class {
    read = async (k: string) => secrets.get(k) ?? null
    write = async (k: string, v: string) => void secrets.set(k, v)
    remove = async (k: string) => void secrets.delete(k)
  }
}))
const silentToken = vi.fn(async () => 'ms-token')
vi.mock('../../src/main/auth/microsoft', () => ({ silentToken, forget: vi.fn(), signInInteractive: vi.fn() }))
const profiles = new Map<string, unknown>()
const httpFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/user/authenticate')) return json({ Token: 'x', DisplayClaims: { xui: [{ uhs: 'h' }] } })
  if (url.endsWith('/xsts/authorize')) return json({ Token: 'y' })
  if (url.endsWith('/login_with_xbox')) return json({ access_token: 'mc-fresh', expires_in: 86400 })
  if (url.endsWith('/entitlements/mcstore')) return json({ items: [{ name: 'game_minecraft' }] })
  const token = String((init?.headers as Record<string, string>)?.['authorization'] ?? '').replace('Bearer ', '')
  return json(profiles.get(token))
})
vi.mock('../../src/main/net/http', () => ({ httpFetch, fetchOk: vi.fn() }))

const { accounts } = await import('../../src/main/auth/accounts')

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SKIN = 'ab'.repeat(32)
const file = () => JSON.parse(readFileSync(join(data, 'accounts.json'), 'utf8'))

describe('refreshing names and skins', () => {
  it('uses a saved token, or a silent one for accounts whose skin is unknown, and remembers "no skin"', async () => {
    writeFileSync(
      join(data, 'accounts.json'),
      JSON.stringify({
        schema: 1,
        active: A,
        accounts: [
          { uuid: A, name: 'Old', homeAccountId: 'ha', addedAt: 0 },
          { uuid: B, name: 'Bee', homeAccountId: 'hb', addedAt: 0 }
        ]
      })
    )
    // A has a good token; B's has run out, so it gets a fresh one silently.
    secrets.set(`mc-${A}`, JSON.stringify({ accessToken: 'mc-a', expiresAt: Date.now() + 3_600_000 }))
    profiles.set('mc-a', { id: A, name: 'New', skins: [{ state: 'ACTIVE', url: `http://textures.minecraft.net/texture/${SKIN}` }] })
    profiles.set('mc-fresh', { id: B, name: 'Bee' })

    const state = await accounts.refreshProfiles()
    expect(state.accounts).toEqual([
      { uuid: A, name: 'New', skin: true },
      { uuid: B, name: 'Bee', skin: false }
    ])
    expect(file().accounts.map((a: { skin: unknown }) => a.skin)).toEqual([SKIN, null])
    expect(silentToken).toHaveBeenCalledTimes(1)

    // Next start: B's "no skin" is known, so nothing is refreshed silently again.
    secrets.delete(`mc-${B}`)
    await accounts.refreshProfiles()
    expect(silentToken).toHaveBeenCalledTimes(1)
  })

  it('leaves accounts as they are when offline', async () => {
    httpFetch.mockRejectedValueOnce(new Error('offline'))
    const before = file()
    await accounts.refreshProfiles()
    expect(file()).toEqual(before)
  })
})
