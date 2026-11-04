import type { MinecraftFolder, ResolvedVersion } from '@xmcl/core'
import { createFabricInstallWorkflow, getLoaderArtifactListFor, resolveLibraryInstallFiles, type InstallFile } from '@xmcl/installer'
import { KairoError } from '../errors'
import { fetchOk, httpFetch } from '../net/http'
import type { Stage } from '../game/runtime'
import { describeRange, satisfies } from './semver'

const FABRIC_MAVEN = 'https://maven.fabricmc.net/'

/** The newest stable Fabric Loader for this Minecraft version that the mod accepts. */
export async function pickFabricLoader(mc: string, range: string | string[] | undefined, pinned: string | null): Promise<string> {
  const artifacts = await getLoaderArtifactListFor(mc, { fetch: httpFetch as typeof fetch })
  const versions = artifacts.map((a) => a.loader)
  if (pinned && versions.some((v) => v.version === pinned) && satisfies(pinned, range)) return pinned
  const ok = versions.filter((v) => satisfies(v.version, range))
  const best = ok.find((v) => v.stable) ?? ok[0]
  if (!best) throw new KairoError('http-status', `Fabric has no loader ${describeRange(range)} for Minecraft ${mc} yet.`)
  return best.version
}

/** Writes Fabric's version profile (it inherits from the vanilla version). Returns its version id. */
export async function installFabricProfile(mc: string, loader: string, folder: MinecraftFolder, stage: Stage, signal: AbortSignal): Promise<string> {
  return stage.runWorkflow(
    createFabricInstallWorkflow({ minecraftVersion: mc, version: loader, minecraft: folder, fetch: httpFetch as typeof fetch }),
    signal
  )
}

/**
 * Library files for a Fabric version. Fabric's meta lists a SHA-1 for nearly
 * every library; for the rest, use the .sha1 file the Fabric maven publishes
 * next to each jar, so nothing is installed unchecked.
 */
export async function fabricLibraryFiles(version: ResolvedVersion, folder: MinecraftFolder, signal: AbortSignal): Promise<InstallFile[]> {
  const files = resolveLibraryInstallFiles(version.libraries, folder)
  return Promise.all(
    files.map(async (file) => {
      if (file.checksum?.value) return file
      const url = file.urls.find((u) => u.startsWith(FABRIC_MAVEN))
      if (!url) return file
      const text = (await (await fetchOk(`${url}.sha1`, { signal })).text()).trim().slice(0, 40).toLowerCase()
      if (!/^[0-9a-f]{40}$/.test(text)) throw new KairoError('checksum', `Fabric's maven has no checksum for ${url.split('/').pop()}.`)
      return { ...file, checksum: { algorithm: 'sha1', value: text } }
    })
  )
}
