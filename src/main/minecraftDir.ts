import { app } from 'electron'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InstallLoader } from '../shared/api'

// Sharing Minecraft's own .minecraft folder (Settings > Game > Game folder).
//
// The rule is to never break someone's normal Minecraft:
// - Minecraft runs with .minecraft as its game folder, so worlds, resource
//   packs, shader packs and settings are shared, exactly as when the official
//   launcher starts it.
// - Mods never come from or go to .minecraft/mods: Fabric is pointed at the
//   install's own mods folder (fabric.modsFolder). So only installs whose mods
//   load that way can share: Kairo, Kairo Void, plain Minecraft and Fabric
//   (not modpacks, whose configs live in their own folder).
// - The launcher itself never writes, moves or deletes anything in .minecraft.
//   Before the first shared Play it copies the files a newer Minecraft or mod
//   could change (options, server list, configs) into its own data folder.

export function defaultMinecraftDir(platform: string, home: string, appData: string): string | null {
  if (platform === 'win32') return join(appData, '.minecraft')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'minecraft')
  if (platform === 'linux') return join(home, '.minecraft')
  return null
}

/** The official .minecraft folder, if there is one. Dev builds can point it elsewhere for tests. */
export function minecraftDir(): string | null {
  const override = app.isPackaged ? undefined : process.env['KAIRO_DEV_MINECRAFT_DIR']
  const path = override || defaultMinecraftDir(process.platform, homedir(), app.getPath('appData'))
  if (!path) return null
  try {
    return statSync(path).isDirectory() ? realpathSync.native(path) : null
  } catch {
    return null
  }
}

/** Installs whose mods load from their own folder (or that have none), and aren't modpacks. */
export function canShare(kind: 'kairo' | 'void' | InstallLoader, modpack: boolean): boolean {
  return !modpack && (kind === 'kairo' || kind === 'void' || kind === 'vanilla' || kind === 'fabric')
}

const MAX_CONFIG_BYTES = 50 * 1024 * 1024

async function sizeOf(dir: string, budget: number): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    total += entry.isDirectory() ? await sizeOf(path, budget - total) : (await stat(path)).size
    if (total > budget) return total
  }
  return total
}

/**
 * Once, before the first shared Play: copies the files that Kairo's newer
 * Minecraft or its mods could change into the launcher's own data folder
 * (backups/minecraft-<date>). Only reads from .minecraft.
 */
export async function backupMinecraftOnce(mcDir: string, dataRoot: string): Promise<string | null> {
  const root = join(dataRoot, 'backups')
  const marker = join(root, 'minecraft-backup.json')
  if (existsSync(marker)) return null
  const target = join(root, `minecraft-${new Date().toISOString().slice(0, 10)}`)
  await mkdir(target, { recursive: true })
  for (const name of ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']) {
    if (existsSync(join(mcDir, name))) await copyFile(join(mcDir, name), join(target, name))
  }
  const config = join(mcDir, 'config')
  let configCopied = false
  if (existsSync(config) && (await sizeOf(config, MAX_CONFIG_BYTES)) <= MAX_CONFIG_BYTES) {
    await cp(config, join(target, 'config'), { recursive: true, errorOnExist: false, force: false, verbatimSymlinks: true })
    configCopied = true
  }
  await writeFile(marker, JSON.stringify({ at: Date.now(), folder: target, configCopied }, null, 2))
  return target
}
