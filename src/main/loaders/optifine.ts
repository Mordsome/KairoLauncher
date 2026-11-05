import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import { resolveLibraryInstallFiles, resolveOptifineInstallManifest } from '@xmcl/installer'
import { KairoError } from '../errors'
import type { Stage } from '../game/runtime'
import { httpsOnly, sha1Of } from './forge'

// OptiFine's licence forbids redistributing it or downloading it
// automatically. The launcher only opens optifine.net in the browser; the
// player downloads the jar and picks it, and the launcher installs that file.

export const OPTIFINE_DOWNLOADS = 'https://optifine.net/downloads'

/** Checks a picked file is an OptiFine installer and reads which Minecraft it's for. */
export async function inspectOptifine(jar: string, folder: MinecraftFolder): Promise<{ mc: string; versionId: string }> {
  try {
    const { version } = await resolveOptifineInstallManifest(jar, folder)
    const mc = /^(\d[\w.]*)-OptiFine/i.exec(version)?.[1]
    if (!mc) throw new Error('no Minecraft version')
    return { mc, versionId: version }
  } catch {
    throw new KairoError('unknown-version', "This file isn't an OptiFine installer. Pick the OptiFine_….jar you downloaded from optifine.net.")
  }
}

export async function installOptifine(
  jar: string,
  expectedSha1: string,
  javaPath: string,
  folder: MinecraftFolder,
  stage: Stage,
  signal: AbortSignal
): Promise<ResolvedVersion> {
  if ((await sha1Of(jar).catch(() => '')) !== expectedSha1) {
    throw new KairoError('checksum', "This install's OptiFine file is missing or changed. Create the install again with the file from optifine.net.")
  }
  const { version: id, plan } = await resolveOptifineInstallManifest(jar, folder, { java: javaPath })
  await stage.run(plan, signal)
  const version = await Version.parse(folder, id)
  const libraries = httpsOnly(resolveLibraryInstallFiles(version.libraries, folder))
  await stage.run({ schemaVersion: 1, tasks: [{ id: 'optifine-libraries', type: 'files', files: libraries }] }, signal)
  return version
}
