import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KairoError } from '../errors'
import { parseSha256Sums } from '../kairo/github'
import { fetchOk, httpFetch } from '../net/http'
import { dataPaths } from '../paths'
import { RELEASE_KEY, REQUIRE_KAIRO_SIGNATURE } from '../releaseKey'
import { kairoStatement, verifyStatement } from '../signature'
import { TEST_FILE, testAddonsDir, testFilePath } from '../testRelease'

// The addons catalogue: the newest release of Mordsome/KairoAddons (see
// SPEC.md in that repository, section 5). Everything in it is untrusted until
// checked: addons.json must match SHA256SUMS.txt (signed by Mordsome when the
// release has a signature), every addon's jar must be listed there with the
// same hash, and every field is checked for type, length and shape before
// anything uses it. Files are only ever fetched from that repository's own
// release downloads. When GitHub can't be reached, the last catalogue that
// checked out is used.

const RELEASES_URL = 'https://api.github.com/repos/Mordsome/KairoAddons/releases?per_page=10'
const DOWNLOAD_PREFIX = 'https://github.com/Mordsome/KairoAddons/releases/download/'
const MAX_AGE = 10 * 60 * 1000
const MAX_TEXT = 1024 * 1024
export const MAX_JAR = 20 * 1024 * 1024

export type Edition = 'kairo' | 'void'

/** An addon id: lower-case letters, digits and dashes, starting with a letter or digit, at most 40 characters. */
export const ADDON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
const HEX64 = /^[0-9a-f]{64}$/
/** A version range in Fabric's notation (">=0.3.0", "~26.3"): no other characters. */
const RANGE = /^[0-9A-Za-z.<>=~^*+ -]{1,60}$/
const ICON = /^[a-z0-9][a-z0-9-]{0,39}\.png$/
const TAG = /^addons-\d{1,6}$/

/** The only shape an addon jar's name may have. */
export function addonFile(id: string, version: string): string {
  return `kairo-addon-${id}-${version}.jar`
}

export interface CatalogueAddon {
  id: string
  name: string
  summary: string
  description: string
  version: string
  file: string
  sha256: string
  size: number
  icon: { file: string; sha256: string } | null
  editions: Edition[]
  api: number
  kairo: string
  minecraft: string
  tags: string[]
}

export interface Catalogue {
  tag: string
  addons: CatalogueAddon[]
  /** Download address of every file the catalogue uses, by name. */
  urls: Record<string, string>
}

export type CatalogueResult =
  | { status: 'ok'; catalogue: Catalogue }
  /** No catalogue yet (no repository, no release, or a schema this launcher doesn't know). */
  | { status: 'none'; catalogue: null }
  /** GitHub can't be reached and there's no catalogue from before. */
  | { status: 'offline'; catalogue: null }

const text = (v: unknown, max: number, min = 1): string | null =>
  typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v) ? v : null

/**
 * The addons in an addons.json that pass every check, against the release's
 * SHA256SUMS.txt. Null when it isn't a catalogue this launcher understands
 * (another schema, not an object): that counts as "no catalogue".
 */
export function parseCatalogue(raw: unknown, sums: Map<string, string>): CatalogueAddon[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r['schema'] !== 1 || !Array.isArray(r['addons'])) return null
  const out: CatalogueAddon[] = []
  for (const item of r['addons'].slice(0, 200)) {
    const a = parseAddon(item, sums)
    if (a && !out.some((o) => o.id === a.id)) out.push(a)
  }
  return out
}

function parseAddon(item: unknown, sums: Map<string, string>): CatalogueAddon | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const a = item as Record<string, unknown>
  const id = typeof a['id'] === 'string' && ADDON_ID.test(a['id']) ? a['id'] : null
  const version = typeof a['version'] === 'string' && VERSION.test(a['version']) ? a['version'] : null
  const name = text(a['name'], 60)
  const summary = text(a['summary'], 200)
  const description = a['description'] === undefined ? '' : text(a['description'], 2000, 0)
  const sha256 = typeof a['sha256'] === 'string' && HEX64.test(a['sha256'].toLowerCase()) ? a['sha256'].toLowerCase() : null
  const size = a['size']
  const api = a['api']
  const kairo = typeof a['kairo'] === 'string' && RANGE.test(a['kairo']) ? a['kairo'] : null
  const minecraft = typeof a['minecraft'] === 'string' && RANGE.test(a['minecraft']) ? a['minecraft'] : null
  const editions = Array.isArray(a['editions']) ? [...new Set(a['editions'])] : []
  if (!id || !version || !name || !summary || description === null || !sha256 || !kairo || !minecraft) return null
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_JAR) return null
  if (typeof api !== 'number' || !Number.isInteger(api) || api < 1 || api > 1000) return null
  if (editions.length === 0 || !editions.every((e) => e === 'kairo' || e === 'void')) return null
  // The file name must be exactly the addon's own: never a path, never anything else.
  const file = addonFile(id, version)
  if (a['file'] !== file || sums.get(file) !== sha256) return null

  let icon: CatalogueAddon['icon'] = null
  const iconName = a['icon']
  if (typeof iconName === 'string' && ICON.test(iconName) && sums.has(iconName)) icon = { file: iconName, sha256: sums.get(iconName)! }

  const tags = Array.isArray(a['tags'])
    ? a['tags'].filter((t): t is string => typeof t === 'string' && /^[a-z0-9-]{1,30}$/.test(t)).slice(0, 10)
    : []
  return { id, name, summary, description, version, file, sha256, size, icon, editions: editions as Edition[], api, kairo, minecraft, tags }
}

interface GitHubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string }[]
}

/** What a checked catalogue is made of; also what's cached, and checked again when read back. */
interface Raw {
  tag: string
  addonsJson: string
  sums: string
  urls: Record<string, string>
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** Downloads a small text file (at most 1 MB). */
async function fetchText(url: string): Promise<Buffer> {
  const local = testFilePath(url)
  const bytes = local ? await readFile(local) : Buffer.from(await (await fetchOk(url)).arrayBuffer())
  if (bytes.length > MAX_TEXT) throw new KairoError('checksum', 'A catalogue file is too big.')
  return bytes
}

/** Builds a catalogue from its files, or null if it doesn't check out. */
function fromRaw(raw: Raw): Catalogue | null {
  const sums = parseSha256Sums(raw.sums)
  if (sums.get('addons.json') !== sha256(raw.addonsJson)) return null
  let json: unknown
  try {
    json = JSON.parse(raw.addonsJson)
  } catch {
    return null
  }
  const addons = parseCatalogue(json, sums)
  if (!addons) return null
  const ok = (url: string | undefined) => typeof url === 'string' && (url.startsWith(DOWNLOAD_PREFIX) || testFilePath(url) !== null)
  // An addon whose jar isn't in the release is left out; a missing icon is just no icon.
  const listed = addons
    .filter((a) => ok(raw.urls[a.file]))
    .map((a) => (a.icon && !ok(raw.urls[a.icon.file]) ? { ...a, icon: null } : a))
  return { tag: raw.tag, addons: listed, urls: raw.urls }
}

/** The release's files, if it's a catalogue at all (both files, signature good if there is one). */
async function readRelease(r: GitHubRelease): Promise<Raw | null> {
  if (r.draft || r.prerelease || !TAG.test(r.tag_name)) return null
  const urls: Record<string, string> = {}
  for (const a of r.assets) if (a.browser_download_url.startsWith(DOWNLOAD_PREFIX + encodeURIComponent(r.tag_name) + '/')) urls[a.name] = a.browser_download_url
  const sumsUrl = urls['SHA256SUMS.txt']
  const jsonUrl = urls['addons.json']
  if (!sumsUrl || !jsonUrl) return null
  const sums = await fetchText(sumsUrl)
  const sigUrl = urls['SHA256SUMS.txt.sig']
  if (sigUrl || REQUIRE_KAIRO_SIGNATURE) {
    if (!sigUrl) return null
    const signature = (await fetchText(sigUrl)).toString('utf8')
    // The same signature as Kairo's releases, over this release's tag (addons-N) and SHA256SUMS.txt.
    if (!verifyStatement(RELEASE_KEY, kairoStatement(r.tag_name, sha256(sums)), signature)) return null
  }
  return { tag: r.tag_name, sums: sums.toString('utf8'), addonsJson: (await fetchText(jsonUrl)).toString('utf8'), urls }
}

/** Test builds only: a local folder laid out like a release. */
async function localRaw(dir: string): Promise<Raw | null> {
  const urls: Record<string, string> = {}
  for (const name of await readdir(dir)) urls[name] = `${TEST_FILE}${join(dir, name)}`
  if (!urls['addons.json'] || !urls['SHA256SUMS.txt']) return null
  return {
    tag: 'addons-0',
    sums: (await fetchText(urls['SHA256SUMS.txt'])).toString('utf8'),
    addonsJson: (await fetchText(urls['addons.json'])).toString('utf8'),
    urls
  }
}

/** The newest release that is a catalogue; null if there is none (or no repository yet). */
async function resolveLatest(): Promise<Raw | null> {
  const local = testAddonsDir()
  if (local) return localRaw(local)
  const response = await httpFetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })
  // No repository yet: the normal state until the first addons are published.
  if (response.status === 404) return null
  if (!response.ok) throw new KairoError('http-status', `GitHub answered ${response.status}.`)
  const releases = (await response.json()) as GitHubRelease[]
  if (!Array.isArray(releases)) return null
  for (const r of releases) {
    if (!r || typeof r.tag_name !== 'string' || !Array.isArray(r.assets)) continue
    const raw = await readRelease(r)
    if (raw) return raw
  }
  return null
}

let memory: { at: number; result: CatalogueResult } | null = null
const cacheFile = () => join(dataPaths().cache, 'addons-catalogue.json')

/** The catalogue now: from GitHub (at most every few minutes), else the last one that checked out. */
export async function addonCatalogue(fresh = false): Promise<CatalogueResult> {
  if (!fresh && memory && Date.now() - memory.at < MAX_AGE && !testAddonsDir()) return memory.result
  let result: CatalogueResult
  try {
    const raw = await resolveLatest()
    const catalogue = raw ? fromRaw(raw) : null
    result = catalogue ? { status: 'ok', catalogue } : { status: 'none', catalogue: null }
    await mkdir(dataPaths().cache, { recursive: true })
    if (raw && catalogue && !testAddonsDir()) await writeFile(cacheFile(), JSON.stringify(raw))
    else if (!catalogue) await rm(cacheFile(), { force: true })
  } catch {
    // GitHub can't be reached: the last catalogue that checked out, checked again.
    let cached: Catalogue | null = null
    try {
      const raw = JSON.parse(await readFile(cacheFile(), 'utf8')) as Raw
      cached = typeof raw?.addonsJson === 'string' && typeof raw.sums === 'string' && raw.urls && typeof raw.tag === 'string' ? fromRaw(raw) : null
    } catch {
      cached = null
    }
    result = cached ? { status: 'ok', catalogue: cached } : { status: 'offline', catalogue: null }
  }
  memory = { at: Date.now(), result }
  return result
}

/** Downloads one file of the catalogue's release, up to max bytes. */
export async function catalogueFile(catalogue: Catalogue, name: string, max: number): Promise<Buffer> {
  const url = catalogue.urls[name]
  if (!url) throw new KairoError('http-status', `The addons release has no ${name}.`)
  const local = testFilePath(url)
  if (!local && !url.startsWith(DOWNLOAD_PREFIX)) throw new KairoError('blocked-host', 'Unexpected download address.')
  const bytes = local ? await readFile(local) : Buffer.from(await (await fetchOk(url)).arrayBuffer())
  if (bytes.length > max) throw new KairoError('checksum', `${name} is bigger than it should be.`)
  return bytes
}

export { sha256 as sha256Hex }
