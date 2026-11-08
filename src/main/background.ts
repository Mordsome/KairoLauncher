import { dialog, protocol, type BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackgroundFiles, BackgroundResult, BackgroundSlot } from '../shared/api'
import { sniffImage, type ImageInfo } from './imageSniff'
import { dataPaths } from './paths'

// The player's own background pictures. A chosen file is copied into the
// launcher's data folder under a made-up name (the original may move or go
// away), checked by its real type and size first. The page shows it through
// kairo-bg://current and kairo-bg://void, which serve those two files and
// nothing else: the page never gets a path or any other file.

export const BG_SCHEME = 'kairo-bg'
const MAX_BYTES = 50 * 1024 * 1024
const MAX_SIDE = 8192
const NAME = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/

interface Stored {
  file: string
  mime: ImageInfo['mime']
  width: number
  height: number
  version: number
}
type State = Partial<Record<BackgroundSlot, Stored>>

const dir = () => join(dataPaths().root, 'backgrounds')
const stateFile = () => join(dir(), 'backgrounds.json')

function valid(s: unknown): s is Stored {
  const x = s as Stored
  return !!x && typeof x.file === 'string' && NAME.test(x.file) && typeof x.mime === 'string' && Number.isInteger(x.version)
}

async function load(): Promise<State> {
  try {
    const raw = JSON.parse(await readFile(stateFile(), 'utf8')) as Record<string, unknown>
    const out: State = {}
    for (const slot of ['main', 'void'] as const) if (valid(raw[slot])) out[slot] = raw[slot]
    return out
  } catch {
    return {}
  }
}

async function save(state: State): Promise<void> {
  await mkdir(dir(), { recursive: true })
  await writeFile(`${stateFile()}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${stateFile()}.tmp`, stateFile())
}

function view(state: State): BackgroundFiles {
  const one = (s: Stored | undefined) => (s ? { version: s.version, width: s.width, height: s.height } : null)
  return { main: one(state.main), void: one(state.void) }
}

export async function backgroundFiles(): Promise<BackgroundFiles> {
  return view(await load())
}

const problem = (title: string, message: string): BackgroundResult => ({ ok: false, cancelled: false, error: { title, message } })

/** Checks a picture and makes it the slot's background, replacing (and deleting) the old one. */
export async function importBackground(slot: BackgroundSlot, bytes: Buffer): Promise<BackgroundResult> {
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
  const state = await load()
  const old = state[slot]?.file
  state[slot] = { file, mime: info.mime, width: info.width, height: info.height, version: Date.now() }
  await save(state)
  if (old && old !== file) await rm(join(dir(), old), { force: true })
  return { ok: true, files: view(state) }
}

export async function pickBackground(slot: BackgroundSlot, win: BrowserWindow | null): Promise<BackgroundResult> {
  const options = {
    title: slot === 'void' ? 'Choose a picture for Kairo Void' : 'Choose a background picture',
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
  const state = await load()
  const old = state[slot]?.file
  delete state[slot]
  await save(state)
  if (old) await rm(join(dir(), old), { force: true })
  return view(state)
}

/** Serves the two stored pictures, read-only, and nothing else. */
export function serveBackgrounds(): void {
  protocol.handle(BG_SCHEME, async (request) => {
    const none = () => new Response(null, { status: 404 })
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const host = new URL(request.url).host
    const slot: BackgroundSlot | null = host === 'current' ? 'main' : host === 'void' ? 'void' : null
    if (!slot) return none()
    const stored = (await load())[slot]
    if (!stored) return none()
    try {
      const body = await readFile(join(dir(), stored.file))
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': stored.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }
      })
    } catch {
      return none()
    }
  })
}
