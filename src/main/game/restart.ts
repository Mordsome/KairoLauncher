import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dataPaths } from '../paths'

// "Restart the game" in Kairo 0.4.0 and later (SPEC.md of Mordsome/KairoAddons,
// section 6). A game can't start itself again, so the launcher does it: Kairo
// installs get -Dkairo.launcher.restart=<a file that doesn't exist yet>; to
// restart, Kairo writes "restart" into it and closes normally. After the game
// has exited, the launcher reads and deletes the file, and plays the same
// install again only if the game closed normally and the file says exactly
// "restart". The file is new for every launch and gone after the check, so a
// game can never restart in a loop.

const dir = () => join(dataPaths().root, 'restart')

/** A new path for this launch, inside the launcher's own data folder, that doesn't exist. */
export async function newRestartFile(): Promise<string> {
  await mkdir(dir(), { recursive: true })
  const file = join(dir(), `${randomUUID()}.txt`)
  await rm(file, { force: true })
  return file
}

/**
 * After the game has exited: true if it asked to be started again. The file
 * is always deleted. A crash, or a game the player stopped, never restarts.
 */
export async function takeRestart(file: string, closedNormally: boolean): Promise<boolean> {
  let text: string | null = null
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return false // no file: the game was just closed
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
  return closedNormally && text.trim() === 'restart'
}
