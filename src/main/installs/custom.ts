import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CustomInstallInfo, CustomLoader, ModInfo } from '../../shared/api'
import { dataPaths } from '../paths'
import { RECORD_FILE, type ManagedMod } from './record'

// Installs built in "Other" (and modpacks): one folder each under installs/,
// with a kairo-launcher.json record. Versions are chosen on the first Play
// and then kept, so an install doesn't change under the player.

export interface CustomRecord {
  schema: 1
  kind: 'custom'
  id: string
  /** Also the folder name. */
  name: string
  createdAt: number
  mc: string
  loader: CustomLoader
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
  lastPlayed: number | null
  playMinutes: number
}

const ID = /^[0-9a-f]{12}$/

function isCustom(x: unknown): x is CustomRecord {
  const r = x as CustomRecord
  return (
    !!r &&
    r.schema === 1 &&
    r.kind === 'custom' &&
    typeof r.id === 'string' &&
    ID.test(r.id) &&
    typeof r.name === 'string' &&
    typeof r.mc === 'string' &&
    ['fabric', 'neoforge', 'forge', 'optifine'].includes(r.loader) &&
    Array.isArray(r.mods) &&
    Array.isArray(r.wanted)
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
  const dir = join(installsDir(), record.name)
  await mkdir(dir, { recursive: true })
  const file = join(dir, RECORD_FILE)
  await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2))
  await rename(`${file}.tmp`, file)
}

export async function listCustom(): Promise<CustomRecord[]> {
  const names = await readdir(installsDir()).catch(() => [] as string[])
  const records = await Promise.all(names.map((n) => readCustom(join(installsDir(), n))))
  return records.filter((r): r is CustomRecord => r !== null && r.name === r.name.trim()).sort((a, b) => a.createdAt - b.createdAt)
}

export async function getCustom(id: string): Promise<CustomRecord | null> {
  if (!ID.test(id)) return null
  return (await listCustom()).find((r) => r.id === id) ?? null
}

export function customDir(record: CustomRecord): string {
  return join(installsDir(), record.name)
}

/** A folder name nobody uses yet: "Fabric 1.20.1", then "Fabric 1.20.1 (2)"... */
export function freeName(base: string): string {
  const clean = base.replace(/[^\w .+()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Install'
  let name = clean
  for (let n = 2; existsSync(join(installsDir(), name)); n++) name = `${clean} (${n})`
  return name
}

export function newRecord(fields: Pick<CustomRecord, 'name' | 'mc' | 'loader'> & Partial<CustomRecord>): CustomRecord {
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
    ...fields
  }
}

const LOADER_NAME: Record<CustomLoader, string> = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge', optifine: 'OptiFine' }

export function loaderName(loader: CustomLoader): string {
  return LOADER_NAME[loader]
}

export function toInfo(r: CustomRecord): CustomInstallInfo {
  const mods: ModInfo[] = []
  if (r.loaderVersion) mods.push({ name: loaderName(r.loader) + (r.loader === 'fabric' ? ' Loader' : ''), version: r.loaderVersion })
  for (const m of r.mods) mods.push({ name: m.name, version: m.version.split('+')[0] ?? m.version })
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
    modpack: r.modpack
  }
}
