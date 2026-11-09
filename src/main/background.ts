import { dialog, protocol, type BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackgroundFile, BackgroundFiles, BackgroundResult, BackgroundSlot } from '../shared/api'
import { accountSkin } from './auth/accounts'
import { skinPng } from './auth/skins'
import { sniffImage, type ImageInfo } from './imageSniff'
import { dataPaths } from './paths'

// The player's own pictures: the two backgrounds, one per install (shown while
// it's selected) and one per account (its picture instead of the skin head).
// A chosen file is copied into the launcher's data folder under a made-up name
// (the original may move or go away), checked by its real type and size first.
// The page shows them only through kairo-bg:// addresses that name a slot:
//   kairo-bg://current  kairo-bg://void  kairo-bg://install/<id>
//   kairo-bg://account/<uuid>  kairo-bg://skin/<uuid> (the skin it wears)
// The page never gets a path, and no address can reach any other file.

export const BG_SCHEME = 'kairo-bg'
const MAX_BYTES = 50 * 1024 * 1024
const MAX_SIDE = 8192
const NAME = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/
const INSTALL = /^install:([0-9a-f]{12})$/
const ACCOUNT = /^account:([0-9a-f]{32})$/

interface Stored {
  file: string
  mime: ImageInfo['mime']
  width: number
  height: number
  version: number
}
interface State {
  main?: Stored
  void?: Stored
  installs: Record<string, Stored>
  accounts: Record<string, Stored>
}

/** A slot the page may name: the two backgrounds, an install's or an account's picture. */
export function isSlot(v: unknown): v is BackgroundSlot {
  return v === 'main' || v === 'void' || (typeof v === 'string' && (INSTALL.test(v) || ACCOUNT.test(v)))
}

const dir = () => join(dataPaths().root, 'backgrounds')
const stateFile = () => join(dir(), 'backgrounds.json')

function valid(s: unknown): s is Stored {
  const x = s as Stored
  return !!x && typeof x.file === 'string' && NAME.test(x.file) && typeof x.mime === 'string' && Number.isInteger(x.version)
}

function validMap(raw: unknown, key: RegExp): Record<string, Stored> {
  const out: Record<string, Stored> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) if (key.test(k) && valid(v)) out[k] = v
  return out
}

async function load(): Promise<State> {
  try {
    const raw = JSON.parse(await readFile(stateFile(), 'utf8')) as Record<string, unknown>
    const out: State = { installs: validMap(raw['installs'], /^[0-9a-f]{12}$/), accounts: validMap(raw['accounts'], /^[0-9a-f]{32}$/) }
    for (const slot of ['main', 'void'] as const) if (valid(raw[slot])) out[slot] = raw[slot]
    return out
  } catch {
    return { installs: {}, accounts: {} }
  }
}

// Writes queue up, so two quick changes can't lose one another.
let writing: Promise<unknown> = Promise.resolve()
function change<T>(work: (state: State) => Promise<T>): Promise<T> {
  const next = writing.then(async () => {
    const state = await load()
    const out = await work(state)
    await mkdir(dir(), { recursive: true })
    await writeFile(`${stateFile()}.tmp`, JSON.stringify(state, null, 2))
    await rename(`${stateFile()}.tmp`, stateFile())
    return out
  })
  writing = next.catch(() => undefined)
  return next
}

function get(state: State, slot: BackgroundSlot): Stored | undefined {
  if (slot === 'main' || slot === 'void') return state[slot]
  const i = INSTALL.exec(slot)
  if (i) return state.installs[i[1]!]
  const a = ACCOUNT.exec(slot)
  return a ? state.accounts[a[1]!] : undefined
}

function put(state: State, slot: BackgroundSlot, value: Stored | undefined): void {
  const i = INSTALL.exec(slot)
  const a = ACCOUNT.exec(slot)
  const set = <K extends string>(map: Record<K, Stored>, key: K) => {
    if (value) map[key] = value
    else delete map[key]
  }
  if (slot === 'main' || slot === 'void') {
    if (value) state[slot] = value
    else delete state[slot]
  } else if (i) set(state.installs, i[1]!)
  else if (a) set(state.accounts, a[1]!)
}

function view(state: State): BackgroundFiles {
  const one = (s: Stored): BackgroundFile => ({ version: s.version, width: s.width, height: s.height })
  const many = (m: Record<string, Stored>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, one(v)]))
  return {
    main: state.main ? one(state.main) : null,
    void: state.void ? one(state.void) : null,
    installs: many(state.installs),
    accounts: many(state.accounts)
  }
}

export async function backgroundFiles(): Promise<BackgroundFiles> {
  return view(await load())
}

const problem = (title: string, message: string): BackgroundResult => ({ ok: false, cancelled: false, error: { title, message } })

/** Checks a picture and puts it in the slot, replacing (and deleting) the old one. */
export async function importBackground(slot: BackgroundSlot, bytes: Buffer): Promise<BackgroundResult> {
  if (!isSlot(slot)) return problem("That picture can't go there", 'Try again.')
  if (bytes.length > MAX_BYTES) return problem('That picture is too big', 'Pick one under 50 MB.')
  const info = sniffImage(bytes)
  if (!info) return problem("That isn't a picture the launcher can use", 'Pick a PNG, JPG, WebP or GIF file.')
  if (info.width < 1 || info.height < 1 || info.width > MAX_SIDE || info.height > MAX_SIDE) {
    return problem('That picture is too big', `Pick one no larger than ${MAX_SIDE} × ${MAX_SIDE} pixels.`)
  }
  const file = `${randomBytes(8).toString('hex')}.${info.ext}`
  await mkdir(dir(), { recursive: true })
  await writeFile(join(dir(), `${file}.tmp`), bytes)
  await rename(join(dir(), `${file}.tmp`), join(dir(), file))
  return change(async (state) => {
    const old = get(state, slot)?.file
    put(state, slot, { file, mime: info.mime, width: info.width, height: info.height, version: Date.now() })
    if (old && old !== file) await rm(join(dir(), old), { force: true })
    return { ok: true as const, files: view(state) }
  })
}

function dialogTitle(slot: BackgroundSlot): string {
  if (slot === 'void') return 'Choose a picture for Kairo Void'
  if (slot.startsWith('install:')) return 'Choose a picture for this install'
  if (slot.startsWith('account:')) return 'Choose a picture for this account'
  return 'Choose a background picture'
}

export async function pickBackground(slot: BackgroundSlot, win: BrowserWindow | null): Promise<BackgroundResult> {
  if (!isSlot(slot)) return problem("That picture can't go there", 'Try again.')
  const options = {
    title: dialogTitle(slot),
    properties: ['openFile' as const],
    filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const path = result.canceled ? null : result.filePaths[0]
  if (!path) return { ok: false, cancelled: true }
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return problem("That file couldn't be opened", 'Pick another picture.')
  if (info.size > MAX_BYTES) return problem('That picture is too big', 'Pick one under 50 MB.')
  return importBackground(slot, await readFile(path))
}

export async function removeBackground(slot: BackgroundSlot): Promise<BackgroundFiles> {
  if (!isSlot(slot)) return backgroundFiles()
  return change(async (state) => {
    const old = get(state, slot)?.file
    put(state, slot, undefined)
    if (old) await rm(join(dir(), old), { force: true })
    return view(state)
  })
}

/** A duplicated install gets its own copy of the picture. */
export async function copyInstallPicture(from: string, to: string): Promise<void> {
  const fromSlot = `install:${from}` as const
  const toSlot = `install:${to}` as const
  if (!isSlot(fromSlot) || !isSlot(toSlot)) return
  await change(async (state) => {
    const src = get(state, fromSlot)
    if (!src) return
    const file = `${randomBytes(8).toString('hex')}.${src.file.split('.').pop()}`
    await copyFile(join(dir(), src.file), join(dir(), file))
    put(state, toSlot, { ...src, file, version: Date.now() })
  })
}

/** The stored file for a kairo-bg:// address, or null. */
function slotFor(url: URL): BackgroundSlot | null {
  const id = url.pathname.replace(/^\//, '').replace(/\/$/, '')
  if (url.host === 'current') return 'main'
  if (url.host === 'void') return 'void'
  const slot = url.host === 'install' ? `install:${id}` : url.host === 'account' ? `account:${id}` : null
  return slot && isSlot(slot) ? slot : null
}

const headers = (mime: string) => ({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })

/** Serves the stored pictures and the accounts' skins, read-only, and nothing else. */
export function serveBackgrounds(): void {
  protocol.handle(BG_SCHEME, async (request) => {
    const none = () => new Response(null, { status: 404 })
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    try {
      if (url.host === 'skin') {
        const uuid = url.pathname.replace(/^\//, '').replace(/\/$/, '')
        if (!/^[0-9a-f]{32}$/.test(uuid)) return none()
        const id = await accountSkin(uuid)
        const png = id ? await skinPng(id) : null
        return png ? new Response(new Uint8Array(png), { status: 200, headers: headers('image/png') }) : none()
      }
      const slot = slotFor(url)
      const stored = slot ? get(await load(), slot) : undefined
      if (!stored) return none()
      return new Response(await readFile(join(dir(), stored.file)), { status: 200, headers: headers(stored.mime) })
    } catch {
      return none()
    }
  })
}
