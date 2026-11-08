import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { CustomInstallInfo, InstallLoader, KairoEdition, ModInfo } from '../../shared/api'
import { dataPaths } from '../paths'
import { readRecord, RECORD_FILE, type ManagedMod } from './record'

// Installs built in "Other" (and modpacks): one folder each under installs/,
// with a kairo-launcher.json record. Versions are chosen on the first Play
// and then kept, so an install doesn't change under the player.

/** The Kairo part of a Kairo install: which edition, and what the last Play chose. */
export interface KairoPart {
  edition: KairoEdition
  /** Move Kairo, Fabric API and Sodium to new matching versions on every Play. */
  keepUpdated: boolean
  /** The verified Kairo jar in mods/ (null until the first Play). */
  jar: ManagedMod | null
  /** What Kairo itself requires (Fabric API, Sodium), chosen to fit it. */
  deps: ManagedMod[]
}

export interface CustomRecord {
  schema: 1
  kind: 'custom'
  id: string
  /** What the player sees; can be renamed. */
  name: string
  /** The folder under installs/. Never changes, so renaming never moves worlds. Older records used name. */
  folder?: string
  createdAt: number
  mc: string
  loader: InstallLoader
  /** Chosen on first Play for Fabric/NeoForge; fixed by the installer file for Forge. */
  loaderVersion: string | null
  /** Forge and OptiFine: the verified installer, inside this install's folder. */
  installer: { file: string; sha1: string; artifactVersion?: string } | null
  /** The installed version id in game/versions. */
  versionId: string | null
  /** Modrinth projects the player picked (sodium, iris, lithium). */
  wanted: string[]
  /** What the launcher put in mods/. */
  mods: ManagedMod[]
  modpack: { name: string; version: string } | null
  /** Kairo installs only. */
  kairo?: KairoPart | null
  lastPlayed: number | null
  playMinutes: number
}

const ID = /^[0-9a-f]{12}$/

/** A path inside the install folder: relative, no "..", no drive letters. */
function insideFile(p: unknown): boolean {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length < 260 &&
    !isAbsolute(p) &&
    !p.includes(':') &&
    p.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function validKairo(x: unknown): boolean {
  if (x === undefined || x === null) return true
  const k = x as KairoPart
  return (
    (k.edition === 'kairo' || k.edition === 'void') &&
    typeof k.keepUpdated === 'boolean' &&
    (k.jar === null || (!!k.jar && insideFile(k.jar.filename))) &&
    Array.isArray(k.deps) &&
    k.deps.every((m) => !!m && insideFile(m.filename))
  )
}

function validInstaller(x: unknown): boolean {
  if (x === null) return true
  const i = x as CustomRecord['installer']
  return !!i && insideFile(i.file) && typeof i.sha1 === 'string' && /^[0-9a-f]{40}$/i.test(i.sha1)
}

export function isCustom(x: unknown): x is CustomRecord {
  const r = x as CustomRecord
  return (
    !!r &&
    r.schema === 1 &&
    r.kind === 'custom' &&
    typeof r.id === 'string' &&
    ID.test(r.id) &&
    typeof r.name === 'string' &&
    typeof r.mc === 'string' &&
    ['fabric', 'neoforge', 'forge', 'optifine', 'vanilla'].includes(r.loader) &&
    (r.folder === undefined || (typeof r.folder === 'string' && r.folder.length > 0 && !/[\/]/.test(r.folder))) &&
    Array.isArray(r.mods) &&
    r.mods.every((m) => !!m && insideFile(m.filename)) &&
    Array.isArray(r.wanted) &&
    validInstaller(r.installer ?? null) &&
    validKairo(r.kairo)
  )
}

export function installsDir(): string {
  return dataPaths().installs
}

async function readCustom(dir: string): Promise<CustomRecord | null> {
  const file = join(dir, RECORD_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (isCustom(parsed)) return parsed
    if ((parsed as { kind?: unknown })?.kind !== 'custom') return null // someone else's record (Kairo)
  } catch {
    // fall through
  }
  // A custom record we can't read: keep it aside, never delete it.
  await rename(file, join(dir, `${RECORD_FILE}.broken-${Date.now()}`)).catch(() => undefined)
  return null
}

export async function writeCustom(record: CustomRecord): Promise<void> {
  const dir = customDir(record)
  await mkdir(dir, { recursive: true })
  const file = join(dir, RECORD_FILE)
  await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2))
  await rename(`${file}.tmp`, file)
}

export async function listCustom(): Promise<CustomRecord[]> {
  const names = await readdir(installsDir()).catch(() => [] as string[])
  const records = await Promise.all(
    names.map(async (n) => {
      const r = await readCustom(join(installsDir(), n))
      // The folder is where the record was found, whatever the file says.
      return r ? { ...r, folder: n } : null
    })
  )
  return records.filter((r): r is CustomRecord & { folder: string } => r !== null).sort((a, b) => a.createdAt - b.createdAt)
}

export async function getCustom(id: string): Promise<CustomRecord | null> {
  if (!ID.test(id)) return null
  return (await listCustom()).find((r) => r.id === id) ?? null
}

export function customDir(record: CustomRecord): string {
  const folder = record.folder || record.name
  // Never the installs folder itself, or anything outside it.
  if (!folder || folder === '.' || folder === '..' || /[\\/]/.test(folder)) throw new Error('An install has no folder of its own.')
  return join(installsDir(), folder)
}

/** A folder name nobody uses yet: "Fabric 1.20.1", then "Fabric 1.20.1 (2)"... */
export function freeName(base: string): string {
  const clean = base.replace(/[^\w .+()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Install'
  let name = clean
  for (let n = 2; existsSync(join(installsDir(), name)); n++) name = `${clean} (${n})`
  return name
}

export function newRecord(fields: Pick<CustomRecord, 'name' | 'mc' | 'loader'> & Partial<CustomRecord>): CustomRecord {
  const folder = fields.folder ?? fields.name
  return {
    schema: 1,
    kind: 'custom',
    id: randomBytes(6).toString('hex'),
    createdAt: Date.now(),
    loaderVersion: null,
    installer: null,
    versionId: null,
    wanted: [],
    mods: [],
    modpack: null,
    lastPlayed: null,
    playMinutes: 0,
    ...fields,
    folder
  }
}

const LOADER_NAME: Record<InstallLoader, string> = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge', optifine: 'OptiFine', vanilla: 'Minecraft' }

export function loaderName(loader: InstallLoader): string {
  return LOADER_NAME[loader]
}

const shortVersion = (v: string) => v.split('+')[0] ?? v

export function toInfo(r: CustomRecord): CustomInstallInfo {
  const mods: ModInfo[] = []
  if (r.kairo?.jar) mods.push({ name: r.kairo.jar.name, version: shortVersion(r.kairo.jar.version) })
  if (r.loaderVersion) mods.push({ name: loaderName(r.loader) + (r.loader === 'fabric' ? ' Loader' : ''), version: r.loaderVersion })
  if (r.modpack) {
    // A modpack can have hundreds of files: show a count, not a list.
    const count = r.mods.filter((m) => m.filename.startsWith('mods')).length
    if (count) mods.push({ name: 'Mods from the modpack', version: String(count) })
  } else {
    for (const m of [...(r.kairo?.deps ?? []), ...r.mods]) mods.push({ name: m.name, version: shortVersion(m.version) })
  }
  return {
    id: r.id,
    name: r.name,
    mc: r.mc,
    loader: r.loader,
    loaderVersion: r.loaderVersion,
    extras: r.wanted,
    mods,
    installed: r.versionId !== null,
    lastPlayed: r.lastPlayed,
    playMinutes: r.playMinutes,
    modpack: r.modpack,
    kairo: r.kairo ? { edition: r.kairo.edition, keepUpdated: r.kairo.keepUpdated, version: r.kairo.jar ? shortVersion(r.kairo.jar.version) : null } : null
  }
}

/**
 * The record for a plain Minecraft version, created on first Play. Earlier
 * versions of the launcher made vanilla-<mc> folders without a record; those
 * are adopted as they are, worlds and all.
 */
export async function vanillaRecord(mc: string): Promise<CustomRecord> {
  const all = await listCustom()
  const folder = `vanilla-${mc.replace(/[^\w.-]/g, '_')}`
  const found =
    all.find((r) => r.loader === 'vanilla' && r.mc === mc && r.folder === folder) ?? all.find((r) => r.loader === 'vanilla' && r.mc === mc)
  if (found) return found
  const record = newRecord({ name: `Minecraft ${mc}`, folder, mc, loader: 'vanilla' })
  await writeCustom(record)
  return record
}

/** Gives every old vanilla-<mc> folder a record, so it shows in the Library. */
export async function adoptVanillaFolders(): Promise<void> {
  const names = await readdir(installsDir()).catch(() => [] as string[])
  const known = new Set((await listCustom()).map((r) => r.folder))
  for (const name of names) {
    const mc = /^vanilla-([\w.-]+)$/.exec(name)?.[1]
    if (!mc || known.has(name)) continue
    await writeCustom(newRecord({ name: `Minecraft ${mc}`, folder: name, mc, loader: 'vanilla' }))
  }
}


/** The Minecraft version Kairo is made for, until a Play reads it from the Kairo jar. */
export const KAIRO_MC = '26.3'
const KAIRO_NAME: Record<KairoEdition, string> = { kairo: 'Kairo', void: 'Kairo Void' }

/** A new Kairo or Kairo Void install. Kairo, its Minecraft version and its mods are chosen on the first Play. */
export async function createKairoInstall(edition: KairoEdition, name?: string): Promise<CustomRecord> {
  const record = newRecord({
    name: freeName(name?.trim() || KAIRO_NAME[edition]),
    mc: KAIRO_MC,
    loader: 'fabric',
    kairo: { edition, keepUpdated: true, jar: null, deps: [] }
  })
  await writeCustom(record)
  return record
}

/**
 * Kairo installs used to be two fixed folders with their own record. They
 * become regular installs (same folder, worlds and play time). New players get
 * one Kairo and one Kairo Void install, once; after that, deleting them sticks.
 */
export async function adoptKairoInstalls(): Promise<void> {
  const marker = join(installsDir(), '.kairo-installs')
  if (existsSync(marker)) return
  for (const [edition, folder] of [['kairo', 'Kairo'], ['void', 'Kairo Void']] as const) {
    const dir = join(installsDir(), folder)
    const old = existsSync(dir) ? await readRecord(dir) : null
    if (old) {
      await writeCustom({
        ...newRecord({ name: KAIRO_NAME[edition], folder, mc: old.mc ?? KAIRO_MC, loader: 'fabric' }),
        loaderVersion: old.loader,
        lastPlayed: old.lastPlayed,
        playMinutes: old.playMinutes,
        kairo: { edition, keepUpdated: old.keepUpdated, jar: old.kairo, deps: old.mods }
      })
    } else if (!(await listCustom()).some((r) => r.kairo?.edition === edition)) {
      await createKairoInstall(edition)
    }
  }
  await mkdir(installsDir(), { recursive: true })
  await writeFile(marker, 'Kairo and Kairo Void are regular installs now.\n')
}
