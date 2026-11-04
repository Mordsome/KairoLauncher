import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import {
  resolveAssetMetadataInstallManifest,
  resolveAssetObjectInstallFiles,
  resolveLibraryInstallFiles,
  resolveMinecraftJarInstallFile,
  resolveMinecraftVersionJsonInstallFile,
  type InstallFile
} from '@xmcl/installer'
import { httpFetch } from '../net/http'
import { dataPaths } from '../paths'
import { validatedMarker, type ManifestEntry } from './manifest'
import { readMarker, writeMarker, type Stage } from './runtime'

export interface InstallStages {
  meta: Stage
  game: Stage
  assets: Stage
}

/**
 * Downloads a vanilla version into the shared game folder: version JSON,
 * client jar, libraries (with natives for this OS), asset index, log config
 * and asset objects. Every file is checked against Mojang's SHA-1.
 */
export async function installVersion(
  entry: ManifestEntry,
  stages: InstallStages,
  signal: AbortSignal,
  /** Called as soon as the version JSON is parsed, so Java can start downloading alongside. */
  onParsed?: (version: ResolvedVersion) => void
): Promise<ResolvedVersion> {
  const folder = MinecraftFolder.from(dataPaths().game)
  const marker = validatedMarker(entry.id)
  const trustedSince = await readMarker(marker, entry.sha1)

  // 1. The version JSON, checked against the SHA-1 in Mojang's version list.
  const json: InstallFile = {
    ...resolveMinecraftVersionJsonInstallFile(entry, folder),
    replace: false,
    checksum: { algorithm: 'sha1', value: entry.sha1 }
  }
  await stages.meta.run({ schemaVersion: 1, tasks: [{ id: 'version-json', type: 'files', files: [json] }] }, signal)
  stages.meta.done = true

  const version = await Version.parse(folder, entry.id)
  onParsed?.(version)

  // 2. Client jar, libraries, asset index and log config.
  const jar = resolveMinecraftJarInstallFile(version)
  const libraries = resolveLibraryInstallFiles(version.libraries, folder)
  const metadata = resolveAssetMetadataInstallManifest(version, folder)
  await stages.game.run(
    {
      schemaVersion: 1,
      tasks: [{ id: 'client', type: 'files', files: jar ? [jar, ...libraries] : libraries }, ...metadata.tasks]
    },
    signal,
    trustedSince
  )
  stages.game.done = true

  // 3. Asset objects (sounds, languages, textures), listed by the asset index.
  const assets = await resolveAssetObjectInstallFiles(version, folder, { fetch: httpFetch as typeof fetch })
  await stages.assets.run({ schemaVersion: 1, tasks: [{ id: 'assets', type: 'files', files: assets }] }, signal, trustedSince)
  stages.assets.done = true

  await writeMarker(marker, entry.sha1)
  return version
}
