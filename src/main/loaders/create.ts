import { MinecraftFolder } from '@xmcl/core'
import { dialog, shell, type BrowserWindow } from 'electron'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreateCustomRequest, CreateResult, CustomLoader } from '../../shared/api'
import { describeError, KairoError } from '../errors'
import { customDir, freeName, loaderName, newRecord, toInfo, writeCustom, type CustomRecord } from '../installs/custom'
import { dataPaths } from '../paths'
import { redact } from '../redact'
import { EXTRAS } from './extras'
import { inspectForgeInstaller, verifyForgeInstaller } from './forge'
import { loaderVersions } from './meta'
import { extractOverrides, readModpack } from './mrpack'
import { inspectOptifine, OPTIFINE_DOWNLOADS } from './optifine'
import { sha1Of } from './forge'

// Creating "Other" installs and importing modpacks. File dialogs open here in
// the main process; the page never sees or chooses file paths.

const LOADERS: CustomLoader[] = ['fabric', 'neoforge', 'forge', 'optifine']

const fail = (error: unknown): CreateResult => ({ ok: false, cancelled: false, error: describeError(error, redact) })
const cancelled: CreateResult = { ok: false, cancelled: true }

async function pickFile(win: BrowserWindow | null, title: string, name: string, extensions: string[]): Promise<string | null> {
  const options = { title, properties: ['openFile' as const], filters: [{ name, extensions }] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Forge's own download page for one Minecraft version (with its ads), or optifine.net. */
export async function openDownloadPage(loader: 'forge' | 'optifine', mc: string): Promise<void> {
  if (!/^[\w.-]{1,32}$/.test(mc)) return
  const url = loader === 'forge' ? `https://files.minecraftforge.net/net/minecraftforge/forge/index_${mc}.html` : OPTIFINE_DOWNLOADS
  await shell.openExternal(url)
}

/** Asks for the Forge installer, checks it against Forge's checksum, and keeps a copy in the install. */
async function attachForge(win: BrowserWindow | null, record: CustomRecord, wantedVersion: string | null): Promise<CustomRecord | null> {
  const title = wantedVersion ? `Choose the Forge ${wantedVersion} installer you downloaded` : 'Choose the Forge installer you downloaded'
  const file = await pickFile(win, title, 'Forge installer', ['jar'])
  if (!file) return null
  const info = await inspectForgeInstaller(file)
  if (wantedVersion && info.forgeVersion !== wantedVersion) {
    throw new KairoError('unknown-version', `This modpack needs Forge ${wantedVersion}, but that file is Forge ${info.forgeVersion}.`)
  }
  const sha1 = await verifyForgeInstaller(file, info)
  const name = record.name || freeName(`Forge ${info.mc}`)
  const relative = join('.kairo', `forge-${info.artifactVersion}-installer.jar`)
  const dir = join(dataPaths().installs, name)
  await mkdir(join(dir, '.kairo'), { recursive: true })
  await copyFile(file, join(dir, relative))
  return { ...record, name, mc: info.mc, loaderVersion: info.forgeVersion, installer: { file: relative, sha1, artifactVersion: info.artifactVersion } }
}

export async function createCustom(request: CreateCustomRequest, win: BrowserWindow | null): Promise<CreateResult> {
  try {
    if (!LOADERS.includes(request.loader)) throw new KairoError('unknown-version', 'Unknown loader.')
    const versions = await loaderVersions(request.loader)
    if (!versions.mcs.includes(request.mc)) throw new KairoError('unknown-version', `${loaderName(request.loader)} has no Minecraft ${request.mc}.`)
    const extras = request.extras.filter((x) => EXTRAS.some((e) => e.id === x))

    if (request.loader === 'fabric' || request.loader === 'neoforge') {
      const record = newRecord({
        name: freeName(`${loaderName(request.loader)} ${request.mc}`),
        mc: request.mc,
        loader: request.loader,
        wanted: extras,
        loaderVersion: request.loader === 'neoforge' ? (versions.loaderVersions[request.mc] ?? null) : null
      })
      await writeCustom(record)
      return { ok: true, install: toInfo(record) }
    }

    if (request.loader === 'forge') {
      const record = await attachForge(win, newRecord({ name: '', mc: request.mc, loader: 'forge' }), null)
      if (!record) return cancelled
      await writeCustom(record)
      return { ok: true, install: toInfo(record) }
    }

    // OptiFine: the player's own download from optifine.net.
    const file = await pickFile(win, 'Choose the OptiFine file you downloaded from optifine.net', 'OptiFine', ['jar'])
    if (!file) return cancelled
    const { mc } = await inspectOptifine(file, MinecraftFolder.from(dataPaths().game))
    const name = freeName(`OptiFine ${mc}`)
    const relative = join('.kairo', 'optifine-installer.jar')
    const dir = join(dataPaths().installs, name)
    await mkdir(join(dir, '.kairo'), { recursive: true })
    await copyFile(file, join(dir, relative))
    const record = newRecord({ name, mc, loader: 'optifine', installer: { file: relative, sha1: await sha1Of(join(dir, relative)) } })
    await writeCustom(record)
    return { ok: true, install: toInfo(record) }
  } catch (error) {
    return fail(error)
  }
}

export async function importModpack(win: BrowserWindow | null): Promise<CreateResult> {
  let dir: string | null = null
  try {
    const file = await pickFile(win, 'Choose a Modrinth modpack (.mrpack)', 'Modrinth modpack', ['mrpack'])
    if (!file) return cancelled
    const pack = await readModpack(file)
    let record = newRecord({
      name: freeName(pack.name),
      mc: pack.mc,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      mods: pack.files,
      modpack: { name: pack.name, version: pack.version }
    })
    dir = customDir(record)
    await mkdir(dir, { recursive: true })
    await extractOverrides(file, dir)

    if (pack.loader === 'forge') {
      // Forge asks to be downloaded from its own page; open it, then ask for the file.
      await openDownloadPage('forge', pack.mc)
      const withForge = await attachForge(win, record, pack.loaderVersion)
      if (!withForge) {
        await rm(dir, { recursive: true, force: true })
        return cancelled
      }
      record = withForge
    }
    await writeCustom(record)
    return { ok: true, install: toInfo(record) }
  } catch (error) {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return fail(error)
  }
}
