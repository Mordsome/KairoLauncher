import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VersionList } from '../../shared/api'
import { fetchJson } from '../net/http'
import { dataPaths } from '../paths'

// Mojang's version list. The v2 list carries a SHA-1 for every version JSON.
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const MAX_AGE = 10 * 60 * 1000

export interface ManifestEntry {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  time: string
  releaseTime: string
  sha1: string
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: ManifestEntry[]
}

let memory: { at: number; manifest: VersionManifest } | null = null

function isManifest(value: unknown): value is VersionManifest {
  const v = value as VersionManifest
  return !!v && typeof v.latest?.release === 'string' && Array.isArray(v.versions) && v.versions.every((e) => typeof e.id === 'string' && typeof e.sha1 === 'string')
}

/** Fresh list when online; the last saved copy when Mojang can't be reached. */
export async function getVersionManifest(): Promise<VersionManifest> {
  if (memory && Date.now() - memory.at < MAX_AGE) return memory.manifest
  const cacheFile = join(dataPaths().cache, 'version_manifest_v2.json')
  try {
    const manifest = await fetchJson<unknown>(MANIFEST_URL)
    if (!isManifest(manifest)) throw new Error('Unexpected version list format')
    memory = { at: Date.now(), manifest }
    await mkdir(dataPaths().cache, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(manifest))
    return manifest
  } catch (error) {
    try {
      const saved: unknown = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (isManifest(saved)) return saved
    } catch {
      // no usable saved copy
    }
    throw error
  }
}

export async function findVersion(id: string): Promise<ManifestEntry | undefined> {
  return (await getVersionManifest()).versions.find((v) => v.id === id)
}

/** Marks a version as fully downloaded and checked, keyed by its JSON's checksum. */
export function validatedMarker(versionId: string): string {
  return join(dataPaths().game, 'versions', versionId, '.kairo-validated.json')
}

export async function listVersions(): Promise<VersionList> {
  const manifest = await getVersionManifest()
  const releases = manifest.versions.filter((v) => v.type === 'release')
  const oldest = releases.find((v) => v.id === '1.8')
  const fromOneEight = oldest ? releases.filter((v) => v.releaseTime >= oldest.releaseTime) : releases
  const latest = releases.find((v) => v.id === manifest.latest.release)
  const snapshots = manifest.versions.filter((v) => v.type === 'snapshot' && (!latest || v.releaseTime > latest.releaseTime))
  const all = [...snapshots, ...fromOneEight]
  return {
    latest: manifest.latest.release,
    releases: fromOneEight.map((v) => v.id),
    snapshots: snapshots.map((v) => v.id),
    ready: all.filter((v) => existsSync(validatedMarker(v.id))).map((v) => v.id)
  }
}
