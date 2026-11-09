import { shell } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountsState } from '../../shared/api'
import type { GameAccount } from '../account/types'
import { httpFetch } from '../net/http'
import { dataPaths } from '../paths'
import { addSecret } from '../redact'
import { AuthError } from './errors'
import { forget, signInInteractive, silentToken } from './microsoft'
import { SecretStore } from './secretStore'
import { forgetSkin } from './skins'
import { fetchProfile, minecraftFromMicrosoft, type MinecraftProfile, type MinecraftSession } from './xbox'

// Several Microsoft accounts, one active. accounts.json holds only what's
// safe to keep in a file (player names, UUIDs, which one is active); every
// token is in the OS secure store.

interface StoredAccount {
  /** Minecraft profile UUID (no dashes). */
  uuid: string
  name: string
  /** MSAL's id for the Microsoft account. */
  homeAccountId: string
  addedAt: number
  /** Texture id of the skin they wear, for the account picture. */
  skin?: string | null
}

interface AccountsFile {
  schema: 1
  active: string | null
  accounts: StoredAccount[]
}

const FILE = 'accounts.json'
const SKIN_ID = /^[0-9a-f]{16,128}$/
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const store = new SecretStore()
const sessionKey = (uuid: string) => `mc-${uuid}`

/** The stored account's texture id, for the skin cache. */
export async function accountSkin(uuid: string): Promise<string | null> {
  return (await load()).accounts.find((a) => a.uuid === uuid)?.skin ?? null
}

/** Saves a newer name or skin for one account. */
async function updateProfile(uuid: string, profile: MinecraftProfile): Promise<AccountsFile> {
  const file = await load()
  const next = { ...file, accounts: file.accounts.map((a) => (a.uuid === uuid ? { ...a, name: profile.name, skin: profile.skin } : a)) }
  await save(next)
  return next
}

async function readSession(uuid: string): Promise<{ accessToken: string; expiresAt: number } | null> {
  try {
    const raw = await store.read(sessionKey(uuid))
    const s = raw ? (JSON.parse(raw) as { accessToken: unknown; expiresAt: unknown }) : null
    return s && typeof s.accessToken === 'string' && typeof s.expiresAt === 'number' ? { accessToken: s.accessToken, expiresAt: s.expiresAt } : null
  } catch {
    return null
  }
}

function path() {
  return join(dataPaths().root, FILE)
}

function isFile(x: unknown): x is AccountsFile {
  const f = x as AccountsFile
  return (
    !!f &&
    f.schema === 1 &&
    Array.isArray(f.accounts) &&
    f.accounts.every((a) => typeof a.uuid === 'string' && typeof a.name === 'string' && typeof a.homeAccountId === 'string')
  )
}

async function load(): Promise<AccountsFile> {
  let text: string
  try {
    text = await readFile(path(), 'utf8')
  } catch {
    return { schema: 1, active: null, accounts: [] }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (isFile(parsed)) {
      // An odd skin id is dropped (it's looked up again), never a reason to lose the account.
      for (const a of parsed.accounts) if (a.skin !== undefined && a.skin !== null && !(typeof a.skin === 'string' && SKIN_ID.test(a.skin))) a.skin = undefined
      return parsed
    }
  } catch {
    // fall through
  }
  await rename(path(), `${path()}.broken-${Date.now()}`).catch(() => undefined)
  return { schema: 1, active: null, accounts: [] }
}

async function save(file: AccountsFile): Promise<void> {
  await mkdir(dataPaths().root, { recursive: true })
  const tmp = `${path()}.tmp`
  await writeFile(tmp, JSON.stringify(file, null, 2))
  await rename(tmp, path())
}

function view(file: AccountsFile): AccountsState {
  return { active: file.active, accounts: file.accounts.map((a) => ({ uuid: a.uuid, name: a.name, skin: !!a.skin })) }
}

/** Only Microsoft's own sign-in page may be opened for sign-in. */
async function openSignInPage(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'login.microsoftonline.com') throw new AuthError('unknown', 'Unexpected sign-in address')
  await shell.openExternal(parsed.toString())
}

async function saveSession(uuid: string, session: MinecraftSession): Promise<void> {
  addSecret(session.accessToken)
  await store.write(sessionKey(uuid), JSON.stringify({ accessToken: session.accessToken, expiresAt: session.expiresAt }))
}

let pending: AbortController | null = null

export const accounts = {
  async state(): Promise<AccountsState> {
    return view(await load())
  },

  /** Interactive: browser sign-in, then Xbox and Minecraft. Adds (or refreshes) the account and makes it active. */
  async add(): Promise<{ account: { uuid: string; name: string; skin: boolean }; state: AccountsState }> {
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    try {
      const ms = await signInInteractive(openSignInPage, controller.signal)
      addSecret(ms.accessToken)
      let session: MinecraftSession
      try {
        session = await minecraftFromMicrosoft(ms.accessToken, httpFetch)
      } catch (error) {
        // Not added (no Minecraft, no Xbox profile, app not approved...): don't keep its Microsoft tokens either.
        const known = (await load()).accounts.some((a) => a.homeAccountId === ms.homeAccountId)
        if (!known) await forget(ms.homeAccountId).catch(() => undefined)
        throw error
      }
      await saveSession(session.profile.id, session)
      const file = await load()
      const entry: StoredAccount = {
        uuid: session.profile.id,
        name: session.profile.name,
        homeAccountId: ms.homeAccountId,
        addedAt: Date.now(),
        skin: session.profile.skin
      }
      const others = file.accounts.filter((a) => a.uuid !== entry.uuid)
      const next: AccountsFile = { schema: 1, active: entry.uuid, accounts: [...others, entry] }
      await save(next)
      return { account: { uuid: entry.uuid, name: entry.name, skin: !!entry.skin }, state: view(next) }
    } finally {
      if (pending === controller) pending = null
    }
  },

  /**
   * Picks up new names and skins, for the account pictures. Uses each
   * account's saved Minecraft token while it's still good; an account whose
   * skin isn't known yet gets a fresh token (silently) first. Never asks the
   * player anything, and a failure just leaves the account as it was.
   */
  async refreshProfiles(): Promise<AccountsState> {
    let file = await load()
    for (const a of file.accounts) {
      try {
        const session = await readSession(a.uuid)
        let profile: MinecraftProfile | null = null
        if (session && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
          addSecret(session.accessToken)
          profile = await fetchProfile(session.accessToken, httpFetch)
        } else if (a.skin === undefined) {
          const msToken = await silentToken(a.homeAccountId)
          addSecret(msToken)
          const fresh = await minecraftFromMicrosoft(msToken, httpFetch)
          if (fresh.profile.id !== a.uuid) continue
          await saveSession(a.uuid, fresh)
          profile = fresh.profile
        }
        // "No skin" is saved too (null), so it isn't looked up again at every start.
        if (profile && profile.id === a.uuid && (profile.name !== a.name || a.skin === undefined || profile.skin !== a.skin)) {
          if (a.skin && a.skin !== profile.skin && !file.accounts.some((o) => o !== a && o.skin === a.skin)) await forgetSkin(a.skin).catch(() => undefined)
          file = await updateProfile(a.uuid, profile)
        }
      } catch {
        // offline, or the sign-in needs the player: try again next time
      }
    }
    return view(file)
  },

  cancel(): void {
    pending?.abort()
    pending = null
  },

  async switchTo(uuid: string): Promise<AccountsState> {
    const file = await load()
    if (!file.accounts.some((a) => a.uuid === uuid)) return view(file)
    const next = { ...file, active: uuid }
    await save(next)
    return view(next)
  },

  /** Signs one account out: its tokens are deleted from the secure store. */
  async signOut(uuid: string): Promise<AccountsState> {
    const file = await load()
    const gone = file.accounts.find((a) => a.uuid === uuid)
    const rest = file.accounts.filter((a) => a.uuid !== uuid)
    await store.remove(sessionKey(uuid))
    if (gone?.skin && !rest.some((a) => a.skin === gone.skin)) await forgetSkin(gone.skin).catch(() => undefined)
    if (gone && !rest.some((a) => a.homeAccountId === gone.homeAccountId)) await forget(gone.homeAccountId).catch(() => undefined)
    const next: AccountsFile = { schema: 1, accounts: rest, active: file.active === uuid ? (rest[0]?.uuid ?? null) : file.active }
    await save(next)
    return view(next)
  },

  /**
   * The active account, ready to launch with: refreshes the Minecraft token
   * silently when it's close to expiring, and picks up name changes.
   * Null when nobody is signed in.
   */
  async forLaunch(): Promise<GameAccount | null> {
    const file = await load()
    const active = file.accounts.find((a) => a.uuid === file.active)
    if (!active) return null

    let session = await readSession(active.uuid)

    if (!session || session.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      const msToken = await silentToken(active.homeAccountId)
      addSecret(msToken)
      const fresh = await minecraftFromMicrosoft(msToken, httpFetch)
      if (fresh.profile.id !== active.uuid) throw new AuthError('expired', 'The Microsoft account now has a different Minecraft profile')
      await saveSession(active.uuid, fresh)
      if (fresh.profile.name !== active.name || fresh.profile.skin !== (active.skin ?? null)) await updateProfile(active.uuid, fresh.profile)
      session = fresh
      active.name = fresh.profile.name
    }

    addSecret(session.accessToken)
    return { name: active.name, uuid: active.uuid, accessToken: session.accessToken, userType: 'msa', offline: false }
  }
}
