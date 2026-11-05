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
import { minecraftFromMicrosoft, type MinecraftSession } from './xbox'

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
}

interface AccountsFile {
  schema: 1
  active: string | null
  accounts: StoredAccount[]
}

const FILE = 'accounts.json'
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const store = new SecretStore()
const sessionKey = (uuid: string) => `mc-${uuid}`

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
    if (isFile(parsed)) return parsed
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
  return { active: file.active, accounts: file.accounts.map((a) => ({ uuid: a.uuid, name: a.name })) }
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
  async add(): Promise<{ account: { uuid: string; name: string }; state: AccountsState }> {
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
      const entry: StoredAccount = { uuid: session.profile.id, name: session.profile.name, homeAccountId: ms.homeAccountId, addedAt: Date.now() }
      const others = file.accounts.filter((a) => a.uuid !== entry.uuid)
      const next: AccountsFile = { schema: 1, active: entry.uuid, accounts: [...others, entry] }
      await save(next)
      return { account: { uuid: entry.uuid, name: entry.name }, state: view(next) }
    } finally {
      if (pending === controller) pending = null
    }
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

    let session: { accessToken: string; expiresAt: number } | null = null
    try {
      const raw = await store.read(sessionKey(active.uuid))
      session = raw ? (JSON.parse(raw) as { accessToken: string; expiresAt: number }) : null
    } catch {
      session = null
    }

    if (!session || session.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      const msToken = await silentToken(active.homeAccountId)
      addSecret(msToken)
      const fresh = await minecraftFromMicrosoft(msToken, httpFetch)
      if (fresh.profile.id !== active.uuid) throw new AuthError('expired', 'The Microsoft account now has a different Minecraft profile')
      await saveSession(active.uuid, fresh)
      if (fresh.profile.name !== active.name) {
        await save({ ...file, accounts: file.accounts.map((a) => (a.uuid === active.uuid ? { ...a, name: fresh.profile.name } : a)) })
      }
      session = fresh
      active.name = fresh.profile.name
    }

    addSecret(session.accessToken)
    return { name: active.name, uuid: active.uuid, accessToken: session.accessToken, userType: 'msa', offline: false }
  }
}
