import { app } from 'electron'
import { join } from 'node:path'

// Data layout, all under the app's user data folder:
//   game/      shared Minecraft files (versions, libraries, assets), reused by every install
//   runtimes/  Java runtimes from Mojang, one folder per component
//   installs/  one folder per install: its own mods, worlds, settings and logs
//   cache/     downloaded version lists, for when the network is down

export function dataPaths() {
  const root = app.getPath('userData')
  return {
    root,
    game: join(root, 'game'),
    runtimes: join(root, 'runtimes'),
    installs: join(root, 'installs'),
    cache: join(root, 'cache')
  }
}

/** A folder name that is safe on every OS. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 64) || '_'
}
