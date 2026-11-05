import type { CustomLoader, LoaderVersions } from '../../shared/api'
import { listVersions } from '../game/manifest'
import { fetchJson, fetchOk } from '../net/http'
import { compareVersions } from '../kairo/semver'

// Which Minecraft versions each loader supports, read live from its official
// source. OptiFine has no public metadata the launcher may use (the launcher
// never contacts optifine.net), so it offers Mojang's releases from 1.8 up.

const MAX_AGE = 10 * 60 * 1000
const cache = new Map<CustomLoader, { at: number; value: LoaderVersions }>()

async function cached(loader: CustomLoader, load: () => Promise<LoaderVersions>): Promise<LoaderVersions> {
  const hit = cache.get(loader)
  if (hit && Date.now() - hit.at < MAX_AGE) return hit.value
  const value = await load()
  cache.set(loader, { at: Date.now(), value })
  return value
}

/** Sorts Minecraft versions newest first, using Mojang's order. */
async function mojangOrder(ids: Iterable<string>): Promise<string[]> {
  const order = (await listVersions()).releases
  const wanted = new Set(ids)
  return order.filter((id) => wanted.has(id))
}

async function fabric(): Promise<LoaderVersions> {
  const games = await fetchJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/game')
  return { mcs: await mojangOrder(games.filter((g) => g.stable).map((g) => g.version)), loaderVersions: {} }
}

/**
 * NeoForge versions encode the Minecraft version:
 * 21.1.265 is for 1.21.1, 21.0.x for 1.21, and from 26.x on
 * 26.3.0.101 is for 26.3 and 26.1.2.126 for 26.1.2.
 */
export function neoForgeMinecraft(version: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-beta)?$/.exec(version)
  if (!m) return null
  const [, major, minor, third, fourth] = m
  if (Number(major) >= 26) {
    if (fourth === undefined) return null
    return third === '0' ? `${major}.${minor}` : `${major}.${minor}.${third}`
  }
  if (Number(major) < 20) return null
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`
}

async function neoforge(): Promise<LoaderVersions> {
  const xml = await (await fetchOk('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml')).text()
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]!)
  const best: Record<string, string> = {}
  for (const v of versions) {
    const mc = neoForgeMinecraft(v)
    if (!mc) continue
    const current = best[mc]
    // Prefer stable over beta, then the newest build.
    const beta = v.endsWith('-beta')
    if (!current || (current.endsWith('-beta') && !beta) || (current.endsWith('-beta') === beta && compareVersions(v.replace('-beta', ''), current.replace('-beta', '')) > 0)) {
      best[mc] = v
    }
  }
  return { mcs: await mojangOrder(Object.keys(best)), loaderVersions: best }
}

async function forge(): Promise<LoaderVersions> {
  const promos = await fetchJson<{ promos: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
  const best: Record<string, string> = {}
  for (const [key, version] of Object.entries(promos.promos)) {
    const m = /^(.+)-(recommended|latest)$/.exec(key)
    if (!m) continue
    const mc = m[1]!
    // Recommended wins over latest.
    if (m[2] === 'recommended' || !best[mc]) best[mc] = version
  }
  return { mcs: await mojangOrder(Object.keys(best)), loaderVersions: best }
}

async function optifine(): Promise<LoaderVersions> {
  return { mcs: (await listVersions()).releases, loaderVersions: {} }
}

export function loaderVersions(loader: CustomLoader): Promise<LoaderVersions> {
  switch (loader) {
    case 'fabric':
      return cached(loader, fabric)
    case 'neoforge':
      return cached(loader, neoforge)
    case 'forge':
      return cached(loader, forge)
    case 'optifine':
      return cached(loader, optifine)
  }
}
