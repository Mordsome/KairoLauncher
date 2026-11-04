import { app } from 'electron'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

// Data layout, all under the app's user data folder:
//   game/      shared Minecraft files (versions, libraries, assets), reused by every install
//   runtimes/  Java runtimes from Mojang, one folder per component
//   installs/  one folder per install: its own mods, worlds, settings and logs
//   cache/     downloaded version lists, for when the network is down

let root: string | null = null

/**
 * The data folder's real location on disk. Windows can redirect AppData for
 * programs started from a packaged (MSIX) app, so the usual path and the real
 * one differ. Java resolves jars to the real one, and Fabric Loader then
 * refuses to recognise its own jars on a classpath built from the other.
 * Using the real path everywhere keeps the two in agreement.
 */
function dataRoot(): string {
  if (root) return root
  const path = app.getPath('userData')
  try {
    mkdirSync(path, { recursive: true })
    root = realpathSync.native(path)
  } catch {
    root = path
  }
  return root
}

export function dataPaths() {
  const base = dataRoot()
  return {
    root: base,
    game: join(base, 'game'),
    runtimes: join(base, 'runtimes'),
    installs: join(base, 'installs'),
    cache: join(base, 'cache')
  }
}

/** A folder name that is safe on every OS. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 64) || '_'
}
