import { protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { InstalledMod, InstallLoader, ModSearch } from '../../shared/api'
import { KairoError } from '../errors'
import { Stage } from '../game/runtime'
import { sniffImage } from '../imageSniff'
import { readFabricModJson } from '../kairo/modjson'
import { modrinthProject } from '../kairo/modrinth'
import { resolveModrinthMods } from '../loaders/extras'
import { fetchJson, fetchOk } from '../net/http'
import { customDir, getCustom, writeCustom, type CustomRecord } from './custom'

// The mod browser: Modrinth search for one install (its loader and Minecraft
// version only), installs with required dependencies (each file checked
// against Modrinth's SHA-512), turning mods off (.jar.disabled, which loaders
// skip) and removing them. Mods added here are remembered with the install,
// so they follow it to a new Minecraft version.

const API = 'https://api.modrinth.com/v2'
export const ICON_SCHEME = 'kairo-icon'
const PROJECT_ID = /^[A-Za-z0-9]{8}$/
/** A plain jar name in mods/: no folders, nothing odd. */
const JAR = /^[^\\/:*?"<>|\0]{1,200}\.jar$/
const OFF = '.disabled'

export type ModLoader = 'fabric' | 'neoforge' | 'forge'

export function modLoader(loader: InstallLoader): ModLoader | null {
  return loader === 'fabric' || loader === 'neoforge' || loader === 'forge' ? loader : null
}

async function need(id: string): Promise<{ record: CustomRecord; loader: ModLoader; dir: string }> {
  const record = await getCustom(id)
  if (!record) throw new KairoError('unknown-version', 'This install no longer exists.')
  const loader = modLoader(record.loader)
  if (!loader) throw new KairoError('unknown-version', 'Only Fabric, NeoForge and Forge installs can have mods.')
  return { record, loader, dir: join(customDir(record), 'mods') }
}

function jarName(file: unknown): string {
  if (typeof file !== 'string' || !JAR.test(file) || file === '.jar') throw new KairoError('unknown-version', 'Unexpected mod file.')
  return file
}

/** Every jar in the install's mods folder, on or off, the launcher's and the player's own. */
export async function listMods(id: string): Promise<InstalledMod[]> {
  const { record, dir } = await need(id)
  const managed = new Map(record.mods.filter((m) => /^mods[\\/]/.test(m.filename)).map((m) => [basename(m.filename), m]))
  const names = await readdir(dir).catch(() => [] as string[])
  const out: InstalledMod[] = []
  for (const name of names) {
    const off = name.endsWith(`.jar${OFF}`)
    if (!off && !name.endsWith('.jar')) continue
    const file = off ? name.slice(0, -OFF.length) : name
    const mine = managed.get(file)
    let label = mine?.name ?? file.replace(/\.jar$/, '')
    let version: string | null = mine?.version ?? null
    if (!mine) {
      const info = await readFabricModJson(join(dir, name)).catch(() => null)
      if (info) {
        label = info.name ?? info.id
        version = info.version
      }
    }
    out.push({ file, name: label, version, enabled: !off, managed: !!mine, project: mine?.project ?? null })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Icon addresses Modrinth gave in search results, by project id. The icon
// protocol only ever fetches these, so the page can't make the launcher fetch
// anything else.
const iconUrls = new Map<string, string>()
const icons = new Map<string, { bytes: Buffer; mime: string }>()

interface SearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url?: string | null
}

export async function searchMods(id: string, query: string, offset: number): Promise<ModSearch> {
  const { record, loader } = await need(id)
  const facets = JSON.stringify([['project_type:mod'], [`categories:${loader}`], [`versions:${record.mc}`]])
  const q = query.trim().slice(0, 100)
  const params = `query=${encodeURIComponent(q)}&facets=${encodeURIComponent(facets)}&limit=20&offset=${offset}&index=${q ? 'relevance' : 'downloads'}`
  const res = await fetchJson<{ hits: SearchHit[]; total_hits: number }>(`${API}/search?${params}`)
  const installed = new Set(record.mods.map((m) => m.project))
  return {
    total: res.total_hits,
    hits: res.hits
      .filter((h) => PROJECT_ID.test(h.project_id))
      .map((h) => {
        if (h.icon_url && h.icon_url.startsWith('https://cdn.modrinth.com/data/')) iconUrls.set(h.project_id, h.icon_url)
        return {
          id: h.project_id,
          slug: h.slug,
          title: h.title,
          description: (h.description ?? '').slice(0, 200),
          author: h.author ?? '',
          downloads: h.downloads ?? 0,
          hasIcon: iconUrls.has(h.project_id),
          installed: installed.has(h.slug)
        }
      })
  }
}

/** Installs a project and whatever it requires that isn't there yet. */
export async function installMod(id: string, projectId: string): Promise<InstalledMod[]> {
  if (!PROJECT_ID.test(projectId)) throw new KairoError('unknown-version', 'Unexpected Modrinth project.')
  const { record, loader } = await need(id)
  const project = await modrinthProject(projectId)
  const wanted = [...new Set([...record.wanted, project.slug])]
  const signal = new AbortController().signal
  const installDir = customDir(record)
  let mods
  if (record.mods.length === 0) {
    // Never played yet: choose everything wanted (the builder's extras too) now.
    mods = await resolveModrinthMods(wanted, record.mc, loader, installDir, new Stage(), signal)
  } else {
    const have = new Set(record.mods.map((m) => m.project))
    mods = [...record.mods, ...(await resolveModrinthMods([project.slug], record.mc, loader, installDir, new Stage(), signal, have))]
  }
  await writeCustom({ ...record, wanted, mods })
  return listMods(id)
}

/** Turns a mod on or off by renaming it (x.jar <-> x.jar.disabled). Play keeps it that way. */
export async function setModEnabled(id: string, rawFile: unknown, enabled: boolean): Promise<InstalledMod[]> {
  const file = jarName(rawFile)
  const { record, dir } = await need(id)
  const on = join(dir, file)
  const off = join(dir, file + OFF)
  const from = enabled ? off : on
  const to = enabled ? on : off
  if (existsSync(from)) await rename(from, to)
  else if (!existsSync(to)) throw new KairoError('unknown-version', 'That mod is no longer there.')
  const mods = record.mods.map((m) => (basename(m.filename) === file ? { ...m, disabled: !enabled } : m))
  await writeCustom({ ...record, mods })
  return listMods(id)
}

/** The launcher's own mods are deleted (they can be downloaded again); the player's go to the Recycle Bin. */
export async function removeMod(id: string, rawFile: unknown): Promise<InstalledMod[]> {
  const file = jarName(rawFile)
  const { record, dir } = await need(id)
  const path = existsSync(join(dir, file)) ? join(dir, file) : join(dir, file + OFF)
  const mine = record.mods.find((m) => basename(m.filename) === file)
  if (mine) {
    await rm(path, { force: true })
    await writeCustom({ ...record, mods: record.mods.filter((m) => m !== mine), wanted: record.wanted.filter((w) => w !== mine.project) })
  } else if (existsSync(path)) {
    await shell.trashItem(path)
  }
  return listMods(id)
}

/** kairo-icon://modrinth/<project id>: icons from Modrinth search results, checked to be real pictures. */
export function serveModIcons(): void {
  protocol.handle(ICON_SCHEME, async (request) => {
    const none = () => new Response(null, { status: 404 })
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.host !== 'modrinth' || !PROJECT_ID.test(id)) return none()
    let icon = icons.get(id)
    if (!icon) {
      const source = iconUrls.get(id)
      if (!source) return none()
      try {
        const bytes = Buffer.from(await (await fetchOk(source)).arrayBuffer())
        const info = bytes.length <= 512 * 1024 ? sniffImage(bytes) : null
        if (!info) return none() // SVGs and anything else that isn't a plain picture
        icon = { bytes, mime: info.mime }
        if (icons.size > 300) icons.delete(icons.keys().next().value!)
        icons.set(id, icon)
      } catch {
        return none()
      }
    }
    return new Response(new Uint8Array(icon.bytes), {
      status: 200,
      headers: { 'Content-Type': icon.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'max-age=3600' }
    })
  })
}
