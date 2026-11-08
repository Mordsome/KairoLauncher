import { open, openEntryReadStream, readEntry, walkEntriesGenerator } from '@xmcl/unzip'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { CustomLoader } from '../../shared/api'
import { KairoError } from '../errors'
import type { ManagedMod } from '../installs/record'

// Modrinth modpacks (.mrpack): a zip with modrinth.index.json (files to
// download, with hashes) and overrides/ (configs, resource packs...).
// A modpack is untrusted input: every path must stay inside the install
// folder, every download must come from a service the launcher already
// talks to, and extracted files have size limits.

interface MrFile {
  path: string
  hashes: { sha1?: string; sha512?: string }
  env?: { client?: 'required' | 'optional' | 'unsupported' }
  downloads: string[]
  fileSize?: number
}

interface MrIndex {
  formatVersion: number
  game: string
  versionId?: string
  name: string
  files: MrFile[]
  dependencies: Record<string, string>
}

export interface Modpack {
  name: string
  version: string
  mc: string
  loader: CustomLoader
  loaderVersion: string
  files: ManagedMod[]
}

const MAX_ENTRY = 256 * 1024 * 1024
const MAX_TOTAL = 1024 * 1024 * 1024
const MAX_FILES = 5000

/** A relative path that stays inside the install folder, or null. */
export function safeRelative(raw: string): string | null {
  if (!raw || raw.includes('\0') || isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return null
  const norm = normalize(raw.replace(/\\/g, '/'))
  if (norm === '.' || norm.startsWith('..') || norm.split(sep).includes('..') || isAbsolute(norm)) return null
  return norm
}

/** Modpack files may only come from Modrinth's CDN, over HTTPS. */
export function isModrinthCdn(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'cdn.modrinth.com' && url.pathname.startsWith('/data/')
  } catch {
    return false
  }
}

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

function loaderOf(deps: Record<string, string>): { loader: CustomLoader; version: string } {
  if (deps['fabric-loader']) return { loader: 'fabric', version: deps['fabric-loader'] }
  if (deps['neoforge']) return { loader: 'neoforge', version: deps['neoforge'] }
  if (deps['forge']) return { loader: 'forge', version: deps['forge'] }
  if (deps['quilt-loader']) throw new KairoError('unknown-version', "This modpack uses Quilt, which Kairo Launcher doesn't support.")
  throw new KairoError('unknown-version', 'This modpack names no mod loader the launcher knows.')
}

/** Reads and checks a .mrpack without extracting anything. */
export async function readModpack(file: string): Promise<Modpack> {
  let index: MrIndex
  const zip = await open(file, { lazyEntries: true, autoClose: false }).catch(() => {
    throw new KairoError('unknown-version', "This file isn't a modpack. Pick a .mrpack file.")
  })
  try {
    let found = null
    for await (const entry of walkEntriesGenerator(zip)) {
      if (entry.fileName === 'modrinth.index.json') {
        found = entry
        break
      }
    }
    if (!found || found.uncompressedSize > 16 * 1024 * 1024) throw new KairoError('unknown-version', "This modpack has no modrinth.index.json.")
    index = JSON.parse((await readEntry(zip, found)).toString('utf8')) as MrIndex
  } catch (error) {
    if (error instanceof KairoError) throw error
    throw new KairoError('unknown-version', "This modpack's archive is damaged or unsafe, so it wasn't imported.")
  } finally {
    zip.close()
  }

  if (index.formatVersion !== 1 || index.game !== 'minecraft' || !Array.isArray(index.files)) {
    throw new KairoError('unknown-version', "This modpack's format isn't supported.")
  }
  const mc = index.dependencies?.['minecraft']
  if (!mc) throw new KairoError('unknown-version', 'This modpack names no Minecraft version.')
  const { loader, version: loaderVersion } = loaderOf(index.dependencies)
  if (index.files.length > MAX_FILES) throw new KairoError('unknown-version', 'This modpack lists too many files.')

  const files: ManagedMod[] = []
  for (const f of index.files) {
    if (f.env?.client === 'unsupported') continue
    const path = safeRelative(f.path)
    if (!path) throw new KairoError('unknown-version', `This modpack tries to put a file outside its folder (${f.path.slice(0, 60)}), so it wasn't imported.`)
    const sha512 = f.hashes?.sha512?.toLowerCase()
    if (!sha512 || !/^[0-9a-f]{128}$/.test(sha512)) throw new KairoError('checksum', `This modpack gives no SHA-512 for ${path}.`)
    const url = f.downloads?.find((u) => isModrinthCdn(u))
    if (!url) {
      const where = f.downloads?.[0] ? host(f.downloads[0]) : 'nowhere'
      throw new KairoError('blocked-host', `This modpack downloads ${path} from ${where}, and Kairo Launcher only downloads modpack files from Modrinth.`)
    }
    files.push({ project: 'modpack', name: path.split(sep).pop() ?? path, version: '', filename: path, url, hash: { algorithm: 'sha512', value: sha512 } })
  }
  return { name: index.name || 'Modpack', version: index.versionId ?? '', mc, loader, loaderVersion, files }
}

/** Copies overrides/ and client-overrides/ into the install folder, safely. */
export async function extractOverrides(file: string, dir: string): Promise<void> {
  try {
    await extract(file, dir)
  } catch (error) {
    if (error instanceof KairoError) throw error
    // The zip reader also refuses unsafe paths; say so plainly.
    throw new KairoError('unknown-version', "This modpack's archive is damaged or tries to put files outside its folder, so it wasn't imported.")
  }
}

async function extract(file: string, dir: string): Promise<void> {
  const zip = await open(file, { lazyEntries: true, autoClose: false })
  let total = 0
  try {
    for await (const entry of walkEntriesGenerator(zip)) {
      const name = entry.fileName
      const prefix = name.startsWith('overrides/') ? 'overrides/' : name.startsWith('client-overrides/') ? 'client-overrides/' : null
      if (!prefix || name.endsWith('/')) continue
      const rel = safeRelative(name.slice(prefix.length))
      if (!rel) throw new KairoError('unknown-version', `This modpack tries to put a file outside its folder (${name.slice(0, 60)}).`)
      total += entry.uncompressedSize
      if (entry.uncompressedSize > MAX_ENTRY || total > MAX_TOTAL) throw new KairoError('unknown-version', 'This modpack is too large to unpack.')
      const target = join(dir, rel)
      if (!normalize(target).startsWith(normalize(dir) + sep)) throw new KairoError('unknown-version', 'This modpack tries to put a file outside its folder.')
      await mkdir(dirname(target), { recursive: true })
      await pipeline(await openEntryReadStream(zip, entry), createWriteStream(target))
    }
  } finally {
    zip.close()
  }
}
