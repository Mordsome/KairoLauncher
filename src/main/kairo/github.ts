import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KairoError } from '../errors'
import { fetchJson, fetchOk } from '../net/http'
import { dataPaths } from '../paths'
import { RELEASE_KEY, REQUIRE_KAIRO_SIGNATURE } from '../releaseKey'
import { kairoStatement, verifyStatement } from '../signature'
import type { PatchNotes } from '../../shared/api'
import { notePoints } from './notes'

// Kairo releases on GitHub. A release counts only if it has both jars and a
// SHA256SUMS.txt that lists them: anything we can't verify is never installed.
// If the release has a SHA256SUMS.txt.sig (Mordsome's signature, see
// src/main/signature.ts) it must check out; with requireKairoSignature in
// config/release-key.json, releases without one are skipped too.

const RELEASES_URL = 'https://api.github.com/repos/Mordsome/Kairo/releases?per_page=15'
const DOWNLOAD_PREFIX = 'https://github.com/Mordsome/Kairo/releases/download/'
const MAX_AGE = 10 * 60 * 1000

export type KairoEdition = 'kairo' | 'void'

export interface KairoJar {
  filename: string
  url: string
  sha256: string
  size: number
}

export interface KairoRelease {
  tag: string
  version: string
  publishedAt: string
  jars: Record<KairoEdition, KairoJar>
  /** Missing in releases cached by older launchers. */
  notes?: PatchNotes
}

interface GitHubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string
  body?: string | null
  html_url?: string
  assets: { name: string; size: number; browser_download_url: string }[]
}

const JAR = { kairo: /^kairo-(\d[\w.+-]*)\.jar$/, void: /^kairo-void-(\d[\w.+-]*)\.jar$/ } as const

/** Parses "hex  filename" lines (sha256sum format, optional * for binary mode). */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line.trim())
    if (m) sums.set(m[2]!, m[1]!.toLowerCase())
  }
  return sums
}

let memory: { at: number; release: KairoRelease } | null = null

async function resolveLatest(signal?: AbortSignal): Promise<KairoRelease> {
  const releases = await fetchJson<GitHubRelease[]>(RELEASES_URL, {
    signal,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  })
  for (const r of releases) {
    if (r.draft || r.prerelease) continue
    const asset = (name: string) => r.assets.find((a) => a.name === name)
    const kairo = r.assets.find((a) => JAR.kairo.test(a.name))
    const voidJar = r.assets.find((a) => JAR.void.test(a.name))
    const sumsAsset = asset('SHA256SUMS.txt')
    if (!kairo || !voidJar || !sumsAsset) continue
    // Only follow download links into Mordsome's own release pages.
    if (![kairo, voidJar, sumsAsset].every((a) => a.browser_download_url.startsWith(DOWNLOAD_PREFIX))) continue

    const sumsBytes = Buffer.from(await (await fetchOk(sumsAsset.browser_download_url, { signal })).arrayBuffer())
    const sigAsset = asset('SHA256SUMS.txt.sig')
    if (sigAsset || REQUIRE_KAIRO_SIGNATURE) {
      if (!sigAsset || !sigAsset.browser_download_url.startsWith(DOWNLOAD_PREFIX)) continue
      const signature = await (await fetchOk(sigAsset.browser_download_url, { signal })).text()
      const sha256 = createHash('sha256').update(sumsBytes).digest('hex')
      if (!verifyStatement(RELEASE_KEY, kairoStatement(r.tag_name, sha256), signature)) continue
    }
    const sums = parseSha256Sums(sumsBytes.toString('utf8'))
    const k = sums.get(kairo.name)
    const v = sums.get(voidJar.name)
    if (!k || !v) continue
    const version = JAR.kairo.exec(kairo.name)?.[1] ?? r.tag_name.replace(/^v/, '')
    return {
      tag: r.tag_name,
      version,
      publishedAt: r.published_at,
      notes: {
        points: notePoints(r.body),
        // Only ever a link into Mordsome's own release pages.
        url: typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/Mordsome/Kairo/releases/') ? r.html_url : null
      },
      jars: {
        kairo: { filename: kairo.name, url: kairo.browser_download_url, sha256: k, size: kairo.size },
        void: { filename: voidJar.name, url: voidJar.browser_download_url, sha256: v, size: voidJar.size }
      }
    }
  }
  throw new KairoError('http-status', 'No Kairo release on GitHub has both jars and a SHA256SUMS.txt (with a valid signature, if it has one) yet.')
}

/** The newest verifiable release; the last one seen when GitHub can't be reached. */
export async function latestKairoRelease(signal?: AbortSignal): Promise<KairoRelease> {
  if (memory && Date.now() - memory.at < MAX_AGE) return memory.release
  const cacheFile = join(dataPaths().cache, 'kairo-release.json')
  try {
    const release = await resolveLatest(signal)
    memory = { at: Date.now(), release }
    await mkdir(dataPaths().cache, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(release))
    return release
  } catch (error) {
    try {
      return JSON.parse(await readFile(cacheFile, 'utf8')) as KairoRelease
    } catch {
      throw error
    }
  }
}

/** Matches either edition's jar name, any version. Used to keep the two apart. */
export function isAnyKairoJar(filename: string): boolean {
  return JAR.kairo.test(filename) || JAR.void.test(filename)
}
