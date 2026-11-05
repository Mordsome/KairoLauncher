import { basename } from 'node:path'
import { KairoError } from '../errors'
import { fetchJson } from '../net/http'

// Modrinth's public API (no token needed). The launcher sends its own
// User-Agent, as Modrinth requires, and asks for very little: one request per
// mod per Play, cached for a few minutes.

const API = 'https://api.modrinth.com/v2'
const MAX_AGE = 10 * 60 * 1000

export interface ModrinthFile {
  project: string
  /** Modrinth's version label, e.g. "0.165.2+26.3". */
  versionNumber: string
  filename: string
  url: string
  sha512: string
  size: number
  /** Projects this version needs (Modrinth project ids). */
  requires: string[]
}

interface ModrinthVersion {
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  date_published: string
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha512?: string; sha1?: string } }[]
  dependencies?: { project_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded' }[]
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
}

const projects = new Map<string, ModrinthProject>()

/** A project's id, slug and name, by either id or slug. */
export async function modrinthProject(idOrSlug: string, signal?: AbortSignal): Promise<ModrinthProject> {
  const hit = projects.get(idOrSlug)
  if (hit) return hit
  if (!/^[\w.-]{1,64}$/.test(idOrSlug)) throw new KairoError('http-status', 'Unexpected Modrinth project')
  const p = await fetchJson<ModrinthProject>(`${API}/project/${encodeURIComponent(idOrSlug)}`, { signal })
  const project = { id: p.id, slug: p.slug, title: p.title }
  projects.set(p.id, project)
  projects.set(p.slug, project)
  return project
}

const cache = new Map<string, { at: number; files: ModrinthFile[] }>()

function toFile(project: string, v: ModrinthVersion): ModrinthFile | null {
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file?.hashes.sha512) return null
  const name = basename(file.filename)
  if (name !== file.filename || !name.endsWith('.jar')) return null
  if (!file.url.startsWith('https://cdn.modrinth.com/data/')) return null
  const requires = (v.dependencies ?? []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id!)
  return { project, versionNumber: v.version_number, filename: name, url: file.url, sha512: file.hashes.sha512.toLowerCase(), size: file.size, requires }
}

/**
 * Versions of a project for one Minecraft version and loader, best first:
 * releases newest first, then betas (alphas are never used).
 */
export async function modrinthCandidates(project: string, mc: string, loader: string, signal?: AbortSignal): Promise<ModrinthFile[]> {
  const key = `${project}|${mc}|${loader}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE) return hit.files
  const query = `loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`
  const versions = await fetchJson<ModrinthVersion[]>(`${API}/project/${encodeURIComponent(project)}/version?${query}`, { signal })
  const byDate = [...versions].sort((a, b) => b.date_published.localeCompare(a.date_published))
  const ordered = [...byDate.filter((v) => v.version_type === 'release'), ...byDate.filter((v) => v.version_type === 'beta')]
  const files = ordered.map((v) => toFile(project, v)).filter((f): f is ModrinthFile => f !== null)
  if (files.length === 0) {
    throw new KairoError('http-status', `Modrinth has no ${project} for Minecraft ${mc} yet.`)
  }
  cache.set(key, { at: Date.now(), files })
  return files
}
