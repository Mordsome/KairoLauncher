import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { KairoError } from '../errors'
import { getVersionManifest } from '../game/manifest'
import type { Stage } from '../game/runtime'
import type { ManagedMod } from '../installs/record'
import { dataPaths } from '../paths'
import { isAnyKairoJar, latestKairoRelease, type KairoEdition } from './github'
import { readFabricModJson } from './modjson'
import { modrinthCandidates } from './modrinth'
import { compareVersions, describeRange, satisfies } from './semver'

// A Kairo install is Fabric + the mods Kairo's fabric.mod.json depends on
// (Fabric API and Sodium) + exactly one Kairo jar. With "Keep Kairo updated",
// every Play moves all of them to the newest versions that fit together;
// without it, the install stays on what its record says.

export const INSTALL_FOLDER: Record<KairoEdition, string> = { kairo: 'Kairo', void: 'Kairo Void' }
export const EDITION_NAME: Record<KairoEdition, string> = { kairo: 'Kairo', void: 'Kairo Void' }

export function installDir(edition: KairoEdition): string {
  return join(dataPaths().installs, INSTALL_FOLDER[edition])
}

// Dependencies handled separately, not downloaded from Modrinth.
const BUILT_IN = new Set(['minecraft', 'fabricloader', 'fabric-loader', 'java'])
// fabric.mod.json id -> Modrinth project. Anything else is looked up by its id.
const MODRINTH_PROJECT: Record<string, string> = { 'fabric-api': 'fabric-api', fabric: 'fabric-api', sodium: 'sodium' }
const DISPLAY_NAME: Record<string, string> = { 'fabric-api': 'Fabric API', sodium: 'Sodium' }

export interface KairoTarget {
  mc: string
  loaderRange: string | string[] | undefined
  kairo: ManagedMod
  mods: ManagedMod[]
}

async function download(stage: Stage, dir: string, mod: Pick<ManagedMod, 'filename' | 'url' | 'hash'>, signal: AbortSignal) {
  await stage.run(
    {
      schemaVersion: 1,
      tasks: [
        {
          id: `mod-${mod.filename}`,
          type: 'files',
          files: [{ path: join(dir, mod.filename), urls: [mod.url], checksum: { algorithm: mod.hash.algorithm, value: mod.hash.value }, validator: 'zip' }]
        }
      ]
    },
    signal
  )
  return readFabricModJson(join(dir, mod.filename))
}

/** The newest Minecraft release the mod accepts. */
async function pickMinecraft(range: string | string[] | undefined, pinned: string | null): Promise<string> {
  if (pinned && satisfies(pinned, range)) return pinned
  const releases = (await getVersionManifest()).versions.filter((v) => v.type === 'release')
  const match = releases.find((v) => satisfies(v.id, range))
  if (!match) throw new KairoError('unknown-version', `Kairo needs Minecraft ${describeRange(range)}, which Mojang doesn't have yet.`)
  return match.id
}

/** Works out (and downloads, verified) the Kairo jar and the mods it needs. */
/** What a Kairo install had last time: the pinned jar, Minecraft version and Kairo's required mods. */
export interface KairoPrevious {
  keepUpdated: boolean
  kairo: ManagedMod | null
  mc: string | null
  mods: ManagedMod[]
}

/** Mods Kairo itself requires; the mod browser never adds a second copy of these. */
export const KAIRO_REQUIRES = new Set(Object.values(MODRINTH_PROJECT))

export async function resolveKairoTarget(
  edition: KairoEdition,
  record: KairoPrevious | null,
  modsDir: string,
  stage: Stage,
  signal: AbortSignal
): Promise<KairoTarget> {
  const keepUpdated = record?.keepUpdated ?? true

  // 1. The Kairo jar: the latest verifiable release, or the recorded one.
  let kairo: ManagedMod
  const pinnedKairo = record?.kairo ?? null
  if (!keepUpdated && pinnedKairo) {
    kairo = pinnedKairo
  } else {
    try {
      const release = await latestKairoRelease(signal)
      const jar = release.jars[edition]
      kairo = { project: 'kairo', name: EDITION_NAME[edition], version: release.version, filename: jar.filename, url: jar.url, hash: { algorithm: 'sha256', value: jar.sha256 } }
    } catch (error) {
      if (!pinnedKairo) throw error
      kairo = pinnedKairo // GitHub unreachable: keep playing what's installed
    }
  }
  const meta = await download(stage, modsDir, kairo, signal)
  kairo = { ...kairo, version: meta.version, name: meta.name ?? kairo.name }
  const depends = meta.depends ?? {}

  // 2. Minecraft version, from the jar's own requirements.
  const mc = await pickMinecraft(depends['minecraft'], keepUpdated ? null : (record?.mc ?? null))

  // 3. Every other dependency, from Modrinth, checked against Kairo's range.
  const mods: ManagedMod[] = []
  for (const [id, range] of Object.entries(depends)) {
    if (BUILT_IN.has(id)) continue
    const project = MODRINTH_PROJECT[id] ?? id
    const pinned = !keepUpdated && record?.mc === mc ? record.mods.find((m) => m.project === project) : undefined
    const candidates: ManagedMod[] = pinned
      ? [pinned]
      : (await modrinthCandidates(project, mc, 'fabric', signal)).slice(0, 4).map((f) => ({
          project,
          name: DISPLAY_NAME[project] ?? project,
          version: f.versionNumber,
          filename: f.filename,
          url: f.url,
          hash: { algorithm: 'sha512' as const, value: f.sha512 }
        }))
    let chosen: ManagedMod | null = null
    for (const candidate of candidates) {
      const json = await download(stage, modsDir, candidate, signal)
      if (satisfies(json.version, range)) {
        chosen = { ...candidate, version: json.version }
        break
      }
      await rm(join(modsDir, candidate.filename), { force: true })
    }
    if (!chosen) throw new KairoError('http-status', `Kairo needs ${DISPLAY_NAME[project] ?? project} ${describeRange(range)} for Minecraft ${mc}, which isn't on Modrinth yet.`)
    mods.push(chosen)
  }

  return { mc, loaderRange: depends['fabricloader'], kairo, mods }
}

/**
 * Removes mods the launcher put there before that aren't part of this
 * install any more, and any Kairo jar but this one: never both editions
 * (or two versions) in one install. Mods the player added are left alone.
 */
export async function syncMods(modsDir: string, target: KairoTarget, previous: Pick<KairoPrevious, 'kairo' | 'mods'> | null): Promise<void> {
  const keep = new Set([target.kairo.filename, ...target.mods.map((m) => m.filename)])
  const stale = new Set<string>()
  for (const m of [...(previous?.mods ?? []), ...(previous?.kairo ? [previous.kairo] : [])]) if (!keep.has(m.filename)) stale.add(m.filename)
  for (const name of await readdir(modsDir).catch(() => [] as string[])) if (isAnyKairoJar(name) && !keep.has(name)) stale.add(name)
  await Promise.all([...stale].map((name) => rm(join(modsDir, name), { force: true })))
}

/** Short version for display: "0.165.2+26.3" -> "0.165.2". */
export function displayVersion(version: string): string {
  return version.split('+')[0] ?? version
}

/** True if b is a newer version than a. */
export function isNewer(a: string, b: string): boolean {
  return compareVersions(b, a) > 0
}
