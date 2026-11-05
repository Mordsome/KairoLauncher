import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import {
  createModernForgeInstallWorkflow,
  resolveLibraryInstallFiles,
  resolveNeoForgedInstallerFile,
  type InstallFile,
  type InstallForgeOptions
} from '@xmcl/installer'
import { filterEntries, open, readEntry } from '@xmcl/unzip'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { KairoError } from '../errors'
import type { Stage } from '../game/runtime'
import { fetchOk, httpFetch } from '../net/http'

// Forge and NeoForge both ship an installer jar whose processors patch the
// game. NeoForge's installer is downloaded from its maven (checked against
// the .sha1 it publishes). Forge asks launchers not to auto-download it, so
// the player downloads it from Forge's own page and picks the file; it's
// checked against the SHA-1 Forge publishes before it's used.

export const FORGE_MAVEN = 'https://maven.minecraftforge.net/'

const installOptions = (): InstallForgeOptions =>
  ({ fetch: httpFetch as typeof fetch, mavenHost: [FORGE_MAVEN] }) as unknown as InstallForgeOptions

export function sha1Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** Old Forge versions list some libraries over plain http; the guard only allows https. */
export function httpsOnly(files: InstallFile[]): InstallFile[] {
  return files.map((f) => ({ ...f, urls: f.urls.map((u) => u.replace(/^http:\/\//, 'https://')) }))
}

export interface ForgeInstallerInfo {
  mc: string
  /** e.g. "1.20.1-47.4.0" */
  artifactVersion: string
  /** e.g. "47.4.0" */
  forgeVersion: string
}

/** Reads which Forge a picked installer jar is, from its install_profile.json. */
export async function inspectForgeInstaller(jar: string): Promise<ForgeInstallerInfo> {
  let profileText: string
  try {
    const zip = await open(jar, { lazyEntries: true, autoClose: false })
    try {
      const [entry] = await filterEntries(zip, ['install_profile.json'])
      if (!entry) throw new Error('no install_profile.json')
      profileText = (await readEntry(zip, entry)).toString('utf8')
    } finally {
      zip.close()
    }
  } catch {
    throw new KairoError('unknown-version', "This file isn't a Forge installer. Pick the file named forge-…-installer.jar.")
  }
  const coordinate = /net\.minecraftforge:forge:([\w.+-]+?)(?=[:"])/.exec(profileText)?.[1]
  const profile = JSON.parse(profileText) as { minecraft?: string; install?: { minecraft?: string } }
  const mc = profile.minecraft ?? profile.install?.minecraft
  if (!coordinate || !mc || !coordinate.startsWith(`${mc}-`)) {
    throw new KairoError('unknown-version', "This doesn't look like an official Forge installer.")
  }
  return { mc, artifactVersion: coordinate, forgeVersion: coordinate.slice(mc.length + 1).replace(new RegExp(`-${mc.replace(/\./g, '\\.')}$`), '') }
}

/** The SHA-1 Forge publishes for an installer, checked against the picked file. */
export async function verifyForgeInstaller(jar: string, info: ForgeInstallerInfo): Promise<string> {
  const av = info.artifactVersion
  const url = `${FORGE_MAVEN}net/minecraftforge/forge/${av}/forge-${av}-installer.jar.sha1`
  let expected: string
  try {
    expected = (await (await fetchOk(url)).text()).trim().slice(0, 40).toLowerCase()
  } catch {
    throw new KairoError('checksum', "Couldn't get Forge's checksum for this installer, so it wasn't used. Check your connection and try again.")
  }
  const actual = await sha1Of(jar)
  if (!/^[0-9a-f]{40}$/.test(expected) || actual !== expected) {
    throw new KairoError('checksum', "This installer doesn't match the one Forge publishes, so it wasn't used. Download it again from Forge's page.")
  }
  return actual
}

/** Runs a Forge or NeoForge installer and downloads the libraries it needs. Returns the version. */
async function runInstaller(
  project: 'forge' | 'neoforge',
  installer: InstallFile,
  artifactVersion: string,
  mc: string,
  javaPath: string,
  folder: MinecraftFolder,
  stage: Stage,
  signal: AbortSignal
): Promise<ResolvedVersion> {
  const result = await stage.runWorkflow(
    createModernForgeInstallWorkflow({
      id: project,
      minecraft: folder,
      minecraftVersion: mc,
      installer,
      artifactVersion,
      java: javaPath,
      installOptions: installOptions()
    }),
    signal
  )
  const version = await Version.parse(folder, result.version)
  const libraries = httpsOnly(resolveLibraryInstallFiles(version.libraries, folder, { mavenHost: [FORGE_MAVEN] }))
  await stage.run({ schemaVersion: 1, tasks: [{ id: `${project}-libraries`, type: 'files', files: libraries }] }, signal)
  return version
}

export async function installNeoForge(
  version: string,
  mc: string,
  javaPath: string,
  folder: MinecraftFolder,
  stage: Stage,
  signal: AbortSignal
): Promise<ResolvedVersion> {
  const { file } = await resolveNeoForgedInstallerFile('neoforge', version, folder, installOptions())
  if (!file.checksum?.value) throw new KairoError('checksum', "NeoForge's maven gave no checksum for this installer, so it wasn't used.")
  return runInstaller('neoforge', file, version, mc, javaPath, folder, stage, signal)
}

export async function installForge(
  installerPath: string,
  installerSha1: string,
  artifactVersion: string,
  mc: string,
  javaPath: string,
  folder: MinecraftFolder,
  stage: Stage,
  signal: AbortSignal
): Promise<ResolvedVersion> {
  // The player's verified copy; never downloaded by the launcher.
  if ((await sha1Of(installerPath).catch(() => '')) !== installerSha1) {
    throw new KairoError('checksum', "This install's Forge installer is missing or changed. Create the install again with the installer from Forge's page.")
  }
  const installer: InstallFile = { path: installerPath, urls: [], checksum: { algorithm: 'sha1', value: installerSha1 }, validator: 'zip' }
  return runInstaller('forge', installer, artifactVersion, mc, javaPath, folder, stage, signal)
}
